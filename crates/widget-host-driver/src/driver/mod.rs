//! [`WidgetHostDriver`], the host side state machine for one widget.
//!
//! * this module: the driver's state, its public API and the message intake;
//! * [`requests`]: answering the widget's requests;
//! * [`access`]: the permission rules, as pure functions;
//! * [`subscriptions`]: the backend subscriptions and forwarding what they deliver.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use widget_actions::{
    Action, ActionError, Capability, CapabilitySet, HostRequest, JsonValue, MessageKind, UpdateCapabilitiesRequest,
    UpdateLanguageRequest, UpdateVisibilityRequest, WidgetError, WireMessage,
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
    /// Without those in `approved` and `auto_approved`, this is the open question. It can hold
    /// more than the platform was asked about: a pending capability that
    /// [`WidgetHostDriver::revoke_capabilities`], [`WidgetHostDriver::set_auto_approved`] or a use
    /// ([`WidgetHostDriver::set_single_use`]) took out of those lists after the question was asked
    /// (it is granted only if the answer approves it).
    pub pending_requested: Vec<Capability>,
    /// Capabilities granted without asking the platform, see [`WidgetHostDriver::set_auto_approved`].
    pub auto_approved: Vec<Capability>,
    /// Capabilities granted for one use only, see [`WidgetHostDriver::set_single_use`].
    pub single_use: Vec<Capability>,
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
    single_use: Vec<Capability>,
    /// Requests the driver sent to the widget that the widget has not acknowledged yet.
    awaiting_ack: HashMap<String, HostRequest>,
}

impl State {
    /// A use of `capability` by a widget request: `None` if the widget does not hold it. A
    /// single-use capability is taken away here, under the same lock as the check, so that two
    /// requests cannot both use it; `Some(true)` says so.
    fn use_capability(&mut self, capability: &Capability) -> Option<bool> {
        if !self.approved.has(capability) {
            return None;
        }
        let single_use = self.single_use.contains(capability);
        if single_use {
            self.approved.retain(|held| held != capability);
        }
        Some(single_use)
    }

    /// The open question: the pending capabilities without those the widget holds already and
    /// those granted without asking. What [`WidgetHostPlatform::on_capabilities_requested`] gets
    /// when a request adds to it.
    fn question(&self) -> Vec<Capability> {
        self.pending_requested
            .iter()
            .flatten()
            .filter(|c| !self.approved.contains(c) && !self.auto_approved.contains(c))
            .cloned()
            .collect()
    }
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
            state: Mutex::new(State { single_use: vec![Capability::GetOpenId], ..State::default() }),
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
    /// When a widget requests capabilities, these are granted with the answer, and only the rest
    /// reaches [`WidgetHostPlatform::on_capabilities_requested`]. If nothing is left and no
    /// question is open, the platform is not called and `update_capabilities` goes out
    /// immediately; while a question is open, they wait for its answer.
    ///
    /// Typical use: `widget:…get_matrix_context` and `widget:…get_client_context` for a legacy
    /// widget behind the compat wrapper, because a legacy client passed the same facts as URL
    /// parameters.
    /// Replaces the previous list and affects only future requests.
    pub fn set_auto_approved(&self, capabilities: Vec<Capability>) {
        self.lock().auto_approved = capabilities;
    }

    /// Complete the capability negotiation started by
    /// [`WidgetHostPlatform::on_capabilities_requested`]: answers every request that arrived
    /// since the last answer.
    ///
    /// * Only capabilities the widget requested are granted; the rest of `approved` is ignored.
    ///   A requested capability that is not in `approved` (and not auto-approved) is denied.
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

    /// Set the capabilities that are granted for one use only. Default: `widget:…get_openid`.
    ///
    /// A widget request that needs one of them as a whole (the rule of
    /// `access::required_capability`: `get_openid`, `navigate`, `upload_file`, ...) uses it up. The
    /// driver takes the capability away when the request passes the check, whatever the request's
    /// result, and right after the reply sends `update_capabilities` with what the widget still
    /// holds (the lifetimes proposed for MSC4412 in `spec/patch/msc4412/capability-lifetimes.md`).
    /// For the next use the widget requests the capability again. It does not know in advance
    /// that a grant is limited.
    ///
    /// * Not used up: host capabilities (`host:…`, the host's pushes; they are dropped from
    ///   `capabilities`) and the capabilities a request is checked against by its body
    ///   (`send_event.*`, `read_events.*`, ...).
    /// * A single-use capability that is also auto-approved ([`set_auto_approved`](Self::set_auto_approved))
    ///   is granted again, without asking, each time the widget requests it: that is how a client
    ///   remembers "always" for it. Do not remember an approval of a single-use capability
    ///   otherwise, or it stops being single use.
    /// * The driver has no clock. To limit a grant in time, start a timer when the capability is
    ///   approved and call [`revoke_capabilities`](Self::revoke_capabilities) when it fires.
    ///
    /// Replaces the previous list. A capability the widget holds already becomes single use too:
    /// its next use ends it.
    pub fn set_single_use(&self, capabilities: Vec<Capability>) {
        let (widget, host): (Vec<_>, Vec<_>) =
            capabilities.into_iter().partition(|c| !c.to_unstable_string().starts_with("host:"));
        if !host.is_empty() {
            log::warn!("ignored {} host capabilities for single use: a push does not use a capability up", host.len());
        }
        self.lock().single_use = widget;
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
            single_use: s.single_use.clone(),
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
