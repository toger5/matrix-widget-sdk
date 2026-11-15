//! [`WidgetHostDriver`], the host side state machine for one widget.
//!
//! * this module: the driver's state, its public API and the message intake;
//! * [`requests`]: answering the widget's requests;
//! * [`access`]: the permission rules, as pure functions;
//! * [`subscriptions`]: the backend subscriptions and forwarding what they deliver.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use widget_actions::{
    Action, ActionError, Capability, ForwardOpenIdCredentialsRequest, HostRequest, JsonValue, MessageKind,
    UpdateCapabilitiesRequest, UpdateLanguageRequest, UpdateVisibilityRequest, WidgetError, WireMessage,
};
use widget_matrix_backend::MatrixBackend;

use crate::{DriverError, WidgetHostPlatform};

mod access;
mod requests;
mod subscriptions;
#[cfg(test)]
mod tests;

use subscriptions::SubscriptionSlot;

/// A read-only copy of the driver's state.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DriverSnapshot {
    /// `notify_ready` was received.
    pub ready: bool,
    /// Capabilities currently granted to the widget.
    pub approved: Vec<Capability>,
    /// Capabilities the widget requested that wait for [`WidgetHostDriver::approve_capabilities`].
    pub pending_requested: Vec<Capability>,
    /// Capabilities granted without asking the platform, see [`WidgetHostDriver::set_auto_approved`].
    pub auto_approved: Vec<Capability>,
    /// Request ids of the `get_openid` requests that wait for [`WidgetHostDriver::resolve_openid`].
    pub pending_openid_requests: Vec<String>,
    /// Whether OpenID tokens are handed out without asking, see
    /// [`WidgetHostDriver::set_openid_auto_approved`].
    pub openid_auto_approved: bool,
}

#[derive(Debug, Default)]
struct State {
    /// The widget has sent its first action. The host must not send anything before that.
    widget_spoke: bool,
    ready: bool,
    approved: Vec<Capability>,
    /// The capabilities of the open `request_capabilities`, if there is one.
    pending_requested: Option<Vec<Capability>>,
    auto_approved: Vec<Capability>,
    pending_openid: Vec<String>,
    openid_auto_approved: bool,
    /// Requests the driver sent to the widget that the widget has not acknowledged yet.
    awaiting_ack: HashMap<String, HostRequest>,
}

/// Host side state machine for one widget instance. See the crate documentation.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct WidgetHostDriver {
    backend: Arc<dyn MatrixBackend>,
    platform: Arc<dyn WidgetHostPlatform>,
    state: Mutex<State>,
    /// Follows the approved `host:…forward_event.*` / `host:…update_state` capabilities.
    room_subscription: SubscriptionSlot,
    /// Follows the approved `host:…forward_to_device` capabilities.
    to_device_subscription: SubscriptionSlot,
    /// Set while the widget watches TURN servers (MSC3846).
    turn_subscription: SubscriptionSlot,
    /// The driver itself, for the sinks it hands to the backend.
    this: Weak<WidgetHostDriver>,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl WidgetHostDriver {
    /// Create a driver for one widget. `backend` must be bound to the room the widget lives in.
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn new(backend: Arc<dyn MatrixBackend>, platform: Arc<dyn WidgetHostPlatform>) -> Arc<Self> {
        // On the web, warnings and errors reach the console without any setup.
        #[cfg(all(feature = "uniffi", target_arch = "wasm32"))]
        widget_logging::ensure_default();
        log::debug!("widget host driver created for room {}", backend.room_id());
        Arc::new_cyclic(|this| Self {
            backend,
            platform,
            state: Mutex::new(State::default()),
            room_subscription: SubscriptionSlot::default(),
            to_device_subscription: SubscriptionSlot::default(),
            turn_subscription: SubscriptionSlot::default(),
            this: this.clone(),
        })
    }

    /// Feed a message from the widget window (`event.data`, as JSON) into the driver.
    ///
    /// Replies to the widget go out through [`WidgetHostPlatform::send_to_widget`] before this
    /// returns. An error means the message does not belong to this protocol; the platform decides
    /// whether to ignore it, log it, or pass it to a legacy implementation.
    /// [`DriverError::LegacyWidgetApi`] says that the message has the legacy shape (`api` instead
    /// of `source`): the first action a widget sends tells the two formats apart.
    pub async fn handle_message_from_widget(&self, json: String) -> Result<(), DriverError> {
        let result = self.dispatch(&json).await;
        match &result {
            Ok(()) => {}
            // Hosts tend to pass every `message` event of the window, so this one is expected.
            Err(DriverError::NotAWidgetMessage { message }) => {
                log::debug!("ignored a message that is not a widget api message: {message}")
            }
            Err(DriverError::LegacyWidgetApi) => log::info!("the widget speaks the legacy widget api"),
            Err(error) => log::warn!("rejected a message from the widget: {error}"),
        }
        result
    }

    /// Set the capabilities that are granted without asking the platform.
    ///
    /// When a widget requests capabilities, these are granted at once, and only the rest reaches
    /// [`WidgetHostPlatform::on_capabilities_requested`]. If nothing is left, the platform is not
    /// called and `update_capabilities` goes out immediately.
    ///
    /// Typical use: `widget:…get_matrix_context` and `widget:…get_client_context` for a legacy
    /// widget behind the compat wrapper, because a legacy client passed the same facts as URL
    /// parameters.
    /// Replaces the previous list and affects only future requests.
    pub fn set_auto_approved(&self, capabilities: Vec<Capability>) {
        self.lock().auto_approved = capabilities;
    }

    /// Complete the capability negotiation started by
    /// [`WidgetHostPlatform::on_capabilities_requested`].
    ///
    /// * Only capabilities the widget requested are granted; the rest of `approved` is ignored.
    /// * Requested capabilities that are auto-approved are granted as well.
    /// * The widget gets `update_capabilities` with everything it holds now.
    /// * If new capabilities were granted, the driver subscribes to the backend again. The backend
    ///   then delivers the current room state, which reaches the widget as `update_state`.
    ///
    /// Does nothing if no request is pending.
    pub fn approve_capabilities(&self, approved: Vec<Capability>) {
        let (update, changed) = {
            let mut state = self.lock();
            let Some(requested) = state.pending_requested.take() else {
                return;
            };
            let before = state.approved.len();
            for capability in &requested {
                let granted = approved.contains(capability) || state.auto_approved.contains(capability);
                if granted && !state.approved.contains(capability) {
                    state.approved.push(capability.clone());
                }
            }
            // `allowed` is always the full list the widget holds, not only this round's grants.
            let update = HostRequest::UpdateCapabilities {
                request: UpdateCapabilitiesRequest { allowed: state.approved.clone() },
            };
            log::info!(
                "capabilities approved: {} of {} requested were new, the widget holds {}",
                state.approved.len() - before,
                requested.len(),
                state.approved.len()
            );
            (update, state.approved.len() != before)
        };
        self.send_request(update);
        if changed {
            self.resubscribe();
        }
    }

    /// Take capabilities away from the widget, e.g. because the user revoked a permission.
    ///
    /// * The widget gets `update_capabilities` with the reduced list.
    /// * From then on its requests for the revoked actions are answered with
    ///   `missing_capability`, and the host stops sending the revoked subscriptions.
    /// * The capabilities stay revoked until the widget requests them again.
    ///
    /// Does nothing if the widget holds none of `capabilities`.
    pub fn revoke_capabilities(&self, capabilities: Vec<Capability>) {
        let update = {
            let mut state = self.lock();
            let before = state.approved.len();
            state.approved.retain(|capability| !capabilities.contains(capability));
            if state.approved.len() == before {
                return;
            }
            log::info!(
                "capabilities revoked: {} taken away, the widget holds {}",
                before - state.approved.len(),
                state.approved.len()
            );
            HostRequest::UpdateCapabilities { request: UpdateCapabilitiesRequest { allowed: state.approved.clone() } }
        };
        self.send_request(update);
        self.resubscribe();
    }

    /// Hand out OpenID tokens without asking the platform.
    ///
    /// `get_openid` is then answered at once with `state: allowed` and a token, or with
    /// `state: blocked` if the backend fails. Off by default; affects only future requests.
    pub fn set_openid_auto_approved(&self, auto_approved: bool) {
        self.lock().openid_auto_approved = auto_approved;
    }

    /// Answer every `get_openid` reported through [`WidgetHostPlatform::on_openid_requested`].
    ///
    /// With `allowed`, the driver fetches one token from the backend. Each pending request then
    /// gets `forward_openid_credentials`: `allowed` with the token, or `blocked` if refused or if the
    /// backend failed. Does nothing if no request is pending.
    pub async fn resolve_openid(&self, allowed: bool) {
        let pending = std::mem::take(&mut self.lock().pending_openid);
        if pending.is_empty() {
            return;
        }
        log::info!("openid {} for {} pending request(s)", if allowed { "allowed" } else { "refused" }, pending.len());
        let token = if allowed {
            self.backend
                .openid_token()
                .await
                .inspect_err(|e| log::warn!("the backend gave no openid token, answering `blocked`: {}", e.reason()))
                .ok()
        } else {
            None
        };
        for original_request_id in pending {
            let request = match &token {
                Some(token) => ForwardOpenIdCredentialsRequest::allowed(original_request_id, token.clone()),
                None => ForwardOpenIdCredentialsRequest::blocked(original_request_id),
            };
            self.send_request(HostRequest::ForwardOpenIdCredentials { request });
        }
    }

    /// Tell the widget that the client's theme changed (`update_theme`, MSC2873).
    ///
    /// `theme` is a free-form object. Its `name` should be what `get_client_context` reports as
    /// `client_theme`. Nothing is sent unless the widget holds `host:…update_theme`.
    pub fn update_theme(&self, theme: JsonValue) {
        self.push(HostRequest::UpdateTheme { theme });
    }

    /// Tell the widget that the client's UI language changed (`update_language`). `lang` is a
    /// BCP 47 tag. Nothing is sent unless the widget holds `host:…update_language`.
    pub fn update_language(&self, lang: String) {
        self.push(HostRequest::UpdateLanguage { request: UpdateLanguageRequest { lang } });
    }

    /// Tell the widget that it became visible or hidden (`update_visibility`). Nothing is sent
    /// unless the widget holds `host:…update_visibility`.
    pub fn update_visibility(&self, visible: bool) {
        self.push(HostRequest::UpdateVisibility { request: UpdateVisibilityRequest { visible } });
    }

    /// The current state of the driver.
    pub fn snapshot(&self) -> DriverSnapshot {
        let s = self.lock();
        DriverSnapshot {
            ready: s.ready,
            approved: s.approved.clone(),
            pending_requested: s.pending_requested.clone().unwrap_or_default(),
            auto_approved: s.auto_approved.clone(),
            pending_openid_requests: s.pending_openid.clone(),
            openid_auto_approved: s.openid_auto_approved,
        }
    }
}

impl WidgetHostDriver {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    /// A copy of the approved capabilities, so that no lock is held while they are used.
    fn approved(&self) -> Vec<Capability> {
        self.lock().approved.clone()
    }

    fn send(&self, msg: &WireMessage) {
        log::debug!("to widget: {} {:?} ({})", msg.action, msg.kind(), msg.request_id);
        log::trace!("to widget: {}", msg.to_log_json());
        self.platform.send_to_widget(msg.to_json());
    }

    /// Send a host request that is a subscription of the widget: it goes out only if the widget
    /// holds the request's capability (see [`access::push_capability`]).
    fn push(&self, request: HostRequest) {
        if let Some(capability) = access::push_capability(&request) {
            if !self.lock().approved.contains(&capability) {
                log::debug!("not sent, the widget does not hold {capability}");
                return;
            }
        }
        self.send_request(request);
    }

    /// Send a host request to the widget and remember it until the widget acknowledges it.
    ///
    /// Nothing goes out before the widget has sent its first action (MSC4412): the widget is not
    /// listening yet, and a legacy widget would not understand it.
    fn send_request(&self, request: HostRequest) {
        let id = uuid::Uuid::new_v4().to_string();
        {
            let mut state = self.lock();
            if !state.widget_spoke {
                log::debug!("not sent, the widget has not sent its first action yet");
                return;
            }
            state.awaiting_ack.insert(id.clone(), request.clone());
        }
        self.send(&request.into_wire(id));
    }

    /// The widget answered one of our requests. Widgets only acknowledge, so all that is left is
    /// to forget the request.
    fn handle_ack(&self, msg: WireMessage) -> Result<(), DriverError> {
        match self.lock().awaiting_ack.remove(&msg.request_id) {
            Some(_) => Ok(()),
            None => Err(DriverError::UnexpectedResponse { request_id: msg.request_id }),
        }
    }

    /// [`handle_message_from_widget`](Self::handle_message_from_widget) without the logging of
    /// its result.
    async fn dispatch(&self, json: &str) -> Result<(), DriverError> {
        let msg = WireMessage::from_json(json).map_err(|e| {
            let legacy = serde_json::from_str::<serde_json::Value>(json)
                .is_ok_and(|v| v.get("api").is_some() && v.get("source").is_none());
            if legacy {
                DriverError::LegacyWidgetApi
            } else {
                DriverError::NotAWidgetMessage { message: e.to_string() }
            }
        })?;
        log::debug!("from widget: {} {:?} ({})", msg.action, msg.kind(), msg.request_id);
        log::trace!("from widget: {}", msg.to_log_json());
        if msg.kind() == MessageKind::WidgetRequest {
            self.lock().widget_spoke = true;
        }
        let action = match Action::from_wire(&msg) {
            Ok(action) => action,
            // A request with a body of the wrong shape: the widget gets an error reply.
            Err(ActionError::InvalidBody { message, .. }) if msg.kind() == MessageKind::WidgetRequest => {
                log::warn!("{} ({}) has an invalid request body: {message}", msg.action, msg.request_id);
                self.send(
                    &msg.error_response_to(WidgetError::invalid_request(format!("Invalid request body: {message}"))),
                );
                return Ok(());
            }
            // The widget rejected one of our requests. There is nothing to retry, so it counts
            // as acknowledged.
            Err(ActionError::ErrorResponse { .. }) if msg.kind() == MessageKind::HostResponse => {
                return self.handle_ack(msg);
            }
            Err(other) => return Err(other.into()),
        };
        match action {
            Action::WidgetRequest { request } => {
                self.handle_request(msg, request).await;
                Ok(())
            }
            Action::HostResponse { .. } => self.handle_ack(msg),
            other => {
                Err(DriverError::WrongDirection { message: format!("host received a {:?} message", other.kind()) })
            }
        }
    }
}

impl Drop for WidgetHostDriver {
    fn drop(&mut self) {
        self.room_subscription.cancel();
        self.to_device_subscription.cancel();
        self.turn_subscription.cancel();
    }
}
