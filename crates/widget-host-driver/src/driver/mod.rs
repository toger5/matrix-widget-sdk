//! [`WidgetHostDriver`], the host side state machine for one widget.
//!
//! * this module: the driver's state, its public API and the message intake;
//! * [`requests`]: answering the widget's requests;
//! * [`access`]: the permission rules, as pure functions;
//! * [`subscriptions`]: the backend subscriptions and forwarding what they deliver.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use widget_actions::{
    Action, ActionError, Capability, HostRequest, JsonValue, LanguageChangeRequest, MessageKind,
    NotifyCapabilitiesRequest, OpenIdCredentialsRequest, VisibilityRequest, WidgetError, WireMessage, API_VERSION_V1,
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
    /// `content_loaded` was received.
    pub content_loaded: bool,
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
    content_loaded: bool,
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
    /// Follows the approved `receive.event` / `receive.state_event` capabilities.
    room_subscription: SubscriptionSlot,
    /// Follows the approved `receive.to_device` capabilities.
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
    pub async fn handle_message_from_widget(&self, json: String) -> Result<(), DriverError> {
        let msg =
            WireMessage::from_json(&json).map_err(|e| DriverError::NotAWidgetMessage { message: e.to_string() })?;
        match msg.version.as_deref() {
            Some(API_VERSION_V1) => {}
            None => return Err(DriverError::LegacyWidgetApi),
            Some(other) => return Err(DriverError::UnsupportedVersion { version: other.to_owned() }),
        }
        let action = match Action::from_wire(&msg) {
            Ok(action) => action,
            // A request with a body of the wrong shape: the widget gets an error reply.
            Err(ActionError::InvalidBody { message, .. }) if msg.kind() == MessageKind::WidgetRequest => {
                self.send(&msg.error_response_to(WidgetError::new(format!("Invalid request body: {message}"))));
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

    /// Set the capabilities that are granted without asking the platform.
    ///
    /// When a widget requests capabilities, these are granted at once, and only the rest reaches
    /// [`WidgetHostPlatform::on_capabilities_requested`]. If nothing is left, the platform is not
    /// called and `notify_capabilities` goes out immediately.
    ///
    /// Typical use: `m.matrix_context` and `m.client_context` for a legacy widget behind the compat
    /// wrapper, because a legacy client passed the same facts as URL parameters.
    /// Replaces the previous list and affects only future requests.
    pub fn set_auto_approved(&self, capabilities: Vec<Capability>) {
        self.lock().auto_approved = capabilities;
    }

    /// Complete the capability negotiation started by
    /// [`WidgetHostPlatform::on_capabilities_requested`].
    ///
    /// * Only capabilities the widget requested are granted; the rest of `approved` is ignored.
    /// * Requested capabilities that are auto-approved are granted as well.
    /// * The widget gets `notify_capabilities`.
    /// * If new capabilities were granted, the driver subscribes to the backend again. The backend
    ///   then delivers the current room state, which reaches the widget as `update_state`.
    ///
    /// Does nothing if no request is pending.
    pub fn approve_capabilities(&self, approved: Vec<Capability>) {
        let (notify, changed) = {
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
            // `approved` lists everything the widget holds now, not only this round's grants
            // (as in the legacy api).
            let notify = HostRequest::NotifyCapabilities {
                request: NotifyCapabilitiesRequest { requested, approved: state.approved.clone() },
            };
            (notify, state.approved.len() != before)
        };
        self.send_request(notify);
        if changed {
            self.resubscribe();
        }
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
    /// gets `openid_credentials`: `allowed` with the token, or `blocked` if refused or if the
    /// backend failed. Does nothing if no request is pending.
    pub async fn resolve_openid(&self, allowed: bool) {
        let pending = std::mem::take(&mut self.lock().pending_openid);
        if pending.is_empty() {
            return;
        }
        let token = if allowed { self.backend.openid_token().await.ok() } else { None };
        for original_request_id in pending {
            let request = match &token {
                Some(token) => OpenIdCredentialsRequest::allowed(original_request_id, token.clone()),
                None => OpenIdCredentialsRequest::blocked(original_request_id),
            };
            self.send_request(HostRequest::OpenIdCredentials { request });
        }
    }

    /// Tell the widget that the client's theme changed (`theme_change`, MSC2873).
    ///
    /// `theme` is a free-form object. Its `name` should be what `client_context` reports as
    /// `client_theme`.
    pub fn notify_theme_change(&self, theme: JsonValue) {
        self.send_request(HostRequest::ThemeChange { theme });
    }

    /// Tell the widget that the client's UI language changed (`language_change`). `lang` is a
    /// BCP 47 tag.
    pub fn notify_language_change(&self, lang: String) {
        self.send_request(HostRequest::LanguageChange { request: LanguageChangeRequest { lang } });
    }

    /// Tell the widget that it became visible or hidden (`visibility`).
    pub fn notify_visibility(&self, visible: bool) {
        self.send_request(HostRequest::Visibility { request: VisibilityRequest { visible } });
    }

    /// The current state of the driver.
    pub fn snapshot(&self) -> DriverSnapshot {
        let s = self.lock();
        DriverSnapshot {
            content_loaded: s.content_loaded,
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
        self.platform.send_to_widget(msg.to_json());
    }

    /// Send a host request to the widget and remember it until the widget acknowledges it.
    fn send_request(&self, request: HostRequest) {
        let id = uuid::Uuid::new_v4().to_string();
        self.lock().awaiting_ack.insert(id.clone(), request.clone());
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
}

impl Drop for WidgetHostDriver {
    fn drop(&mut self) {
        self.room_subscription.cancel();
        self.to_device_subscription.cancel();
        self.turn_subscription.cancel();
    }
}
