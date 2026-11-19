//! [`WidgetHostDriver`], the host side state machine for one widget.
//!
//! * this module: the driver's state, its public API and the message intake;
//! * [`requests`]: answering the widget's requests;
//! * [`access`]: the permission rules, as pure functions;
//! * [`subscriptions`]: the backend subscriptions and forwarding what they deliver.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use matrix_widget_actions::{
    Action, ActionError, Capability, CapabilitySet, HostRequest, JsonValue, MessageKind, UpdateCapabilitiesRequest,
    UpdateLanguageRequest, UpdateVisibilityRequest, WidgetError, WireMessage,
};
use matrix_widget_host_backend_interface::MatrixBackend;

use crate::webview::{legacy_auto_approved, webview_attributes};
use crate::widget_event::WidgetEmbed;
use crate::{
    DriverError, EmbedOptions, WebviewPolicy, WidgetDefinition, WidgetEventError, WidgetHostPlatform, WidgetIframe,
};

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
    /// Without those in `approved` and `auto_approved`, this is the open question; it can hold more
    /// than the platform was asked about (taken away by a revoke or a use after it was asked),
    /// which is granted only if the answer approves it.
    pub pending_requested: Vec<Capability>,
    /// Capabilities granted without asking the platform: [`WidgetHostDriver::set_auto_approved`],
    /// then what the driver adds itself ([`legacy_auto_approved`](crate::legacy_auto_approved) for a
    /// legacy widget, `carried`, the webview capabilities the iframe was built with).
    pub auto_approved: Vec<Capability>,
    /// Capabilities granted for one use only, see [`WidgetHostDriver::set_single_use`].
    pub single_use: Vec<Capability>,
    /// What the widget held when its iframe was last loaded again for its webview capabilities,
    /// without the single-use ones and what was revoked since: the page in the new iframe gets
    /// these without asking. A client that remembers approvals remembers `approved` and these.
    pub carried: Vec<Capability>,
    /// The widget's iframe as the platform was last told to build it
    /// ([`WidgetHostPlatform::load_iframe`]); before [`WidgetHostDriver::start`], as `start` will.
    pub iframe: WidgetIframe,
}

#[derive(Debug, Default)]
struct State {
    /// The widget has sent its first action. The host must not send anything before that.
    widget_spoke: bool,
    ready: bool,
    approved: Vec<Capability>,
    /// The capabilities of the open `request_capabilities`, if there is one.
    pending_requested: Option<Vec<Capability>>,
    /// What the client grants without asking ([`WidgetHostDriver::set_auto_approved`]).
    auto_approved: Vec<Capability>,
    /// What a legacy widget is granted without asking; empty for an MSC4411 widget. Never changes.
    legacy: Vec<Capability>,
    /// See [`DriverSnapshot::carried`].
    carried: Vec<Capability>,
    single_use: Vec<Capability>,
    /// Requests the driver sent to the widget that the widget has not acknowledged yet.
    awaiting_ack: HashMap<String, HostRequest>,
    /// [`WidgetHostDriver::start`] was called: the platform has an iframe.
    started: bool,
    /// See [`DriverSnapshot::iframe`].
    iframe: WidgetIframe,
    /// The webview capabilities `iframe` was built from.
    applied_webview: Vec<Capability>,
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

    /// The open question: the pending capabilities without those the widget holds already, those
    /// granted without asking, and the webview capabilities that are granted or refused by policy
    /// ([`WebviewPolicy`]). What [`WidgetHostPlatform::on_capabilities_requested`] gets when a
    /// request adds to it.
    fn question(&self) -> Vec<Capability> {
        self.pending_requested
            .iter()
            .flatten()
            .filter(|c| !self.approved.contains(c) && !self.unasked(c) && WebviewPolicy::asks(c))
            .cloned()
            .collect()
    }

    /// What is granted without asking the platform: the client said so, a legacy widget gets it
    /// anyway, the page before held it ([`DriverSnapshot::carried`]), or the iframe was built with it.
    fn unasked_lists(&self) -> impl Iterator<Item = &Capability> {
        self.auto_approved.iter().chain(&self.legacy).chain(&self.carried).chain(&self.applied_webview)
    }

    fn unasked(&self, capability: &Capability) -> bool {
        self.unasked_lists().any(|unasked| unasked == capability)
    }

    /// Bring `iframe` in line with the webview capabilities the widget holds or gets without
    /// asking (so a remembered grant is part of the first iframe). Returns the iframe to load when
    /// its attributes changed after the start: the page in it starts over, so everything about the
    /// old page is forgotten here, and what it held is carried over.
    fn sync_iframe(&mut self) -> Option<WidgetIframe> {
        let granted = self.legacy.iter().chain(&self.auto_approved).chain(&self.carried).chain(&self.approved);
        let wanted = unique(granted.filter(|capability| capability.is_webview()));
        let attributes = webview_attributes(wanted.clone());
        let same = attributes.sandbox == self.iframe.sandbox && attributes.allow == self.iframe.allow;
        self.applied_webview = wanted;
        if same {
            return None;
        }
        self.iframe.sandbox = attributes.sandbox;
        self.iframe.allow = attributes.allow;
        if !self.started {
            return None;
        }
        for capability in std::mem::take(&mut self.approved) {
            if !self.single_use.contains(&capability) && !self.carried.contains(&capability) {
                self.carried.push(capability);
            }
        }
        self.widget_spoke = false;
        self.ready = false;
        self.pending_requested = None;
        self.awaiting_ack.clear();
        Some(self.iframe.clone())
    }
}

/// `capabilities`, each once, in their order.
fn unique<'a>(capabilities: impl Iterator<Item = &'a Capability>) -> Vec<Capability> {
    let mut all: Vec<Capability> = Vec::new();
    for capability in capabilities {
        if !all.contains(capability) {
            all.push(capability.clone());
        }
    }
    all
}

/// Host side state machine for one widget instance. See the crate documentation.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct WidgetHostDriver {
    /// Whether the widget API is set up: the widget's `uses_widget_api`, and always for a legacy
    /// widget (the compat wrapper speaks it).
    uses_widget_api: bool,
    backend: Arc<dyn MatrixBackend>,
    platform: Arc<dyn WidgetHostPlatform>,
    state: Mutex<State>,
    /// Follows the approved `host:…forward_event.*` / `host:…update_state` capabilities.
    room_subscription: SubscriptionSlot,
    /// Follows the approved `host:…forward_to_device` capabilities.
    to_device_subscription: SubscriptionSlot,
    /// Set while the widget watches TURN servers (MSC3846).
    turn_subscription: SubscriptionSlot,
    /// Follows the approved `host:…notify_timeline_update` capability.
    timeline_subscription: SubscriptionSlot,
    /// The driver itself, for the sinks it hands to the backend.
    this: Weak<WidgetHostDriver>,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl WidgetHostDriver {
    /// Create a driver for the widget [`parse_widget_state_event`](crate::parse_widget_state_event)
    /// read from its state event; `backend` is bound to the widget's room. Nothing is loaded before
    /// [`start`](Self::start). Fails with [`WidgetEventError::Refused`] like
    /// `parse_widget_state_event` (the check is made again: a definition is plain data).
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn new(
        widget: WidgetDefinition,
        options: EmbedOptions,
        backend: Arc<dyn MatrixBackend>,
        platform: Arc<dyn WidgetHostPlatform>,
    ) -> Result<Arc<Self>, WidgetEventError> {
        // On the web, warnings and errors reach the console without any setup.
        #[cfg(all(feature = "uniffi", target_arch = "wasm32"))]
        matrix_widget_logging::ensure_default();
        let WidgetEmbed { url, uses_widget_api } = widget.embed(&options)?;
        // `embed` returns a serialised http(s) URL.
        let origin = url::Url::parse(&url).map(|url| url.origin().ascii_serialization()).unwrap_or_default();
        let mut state = State {
            single_use: vec![Capability::GetOpenId],
            legacy: if widget.legacy.is_some() { legacy_auto_approved() } else { Vec::new() },
            iframe: WidgetIframe { url, origin, ..WidgetIframe::default() },
            ..State::default()
        };
        // Not started: sets the attributes of the first iframe, strict or a legacy client's.
        state.sync_iframe();
        log::debug!(
            "widget host driver created for {} ({}) in room {}",
            widget.widget_id,
            widget.event_type,
            backend.room_id()
        );
        Ok(Arc::new_cyclic(|this| Self {
            uses_widget_api,
            backend,
            platform,
            state: Mutex::new(state),
            room_subscription: SubscriptionSlot::default(),
            to_device_subscription: SubscriptionSlot::default(),
            turn_subscription: SubscriptionSlot::default(),
            timeline_subscription: SubscriptionSlot::default(),
            this: this.clone(),
        }))
    }

    /// Load the widget ([`WidgetHostPlatform::load_iframe`]). Call it once, after
    /// [`set_auto_approved`](Self::set_auto_approved) with what the client remembers: its webview
    /// capabilities are part of the first iframe.
    pub fn start(&self) {
        let iframe = {
            let mut state = self.lock();
            if state.started {
                return;
            }
            state.started = true;
            state.iframe.clone()
        };
        self.load(iframe);
    }

    /// Feed a message from the widget window (`event.data`, as JSON) into the driver. Replies go
    /// out through [`WidgetHostPlatform::send_to_widget`] before this returns.
    ///
    /// An error means the message does not belong to this protocol; the platform ignores or logs
    /// it ([`DriverError::LegacyWidgetApi`]: the legacy shape, `api` instead of `source`).
    pub async fn handle_message_from_widget(&self, json: String) -> Result<(), DriverError> {
        if !self.uses_widget_api {
            log::debug!("ignored a message of a widget without the widget api");
            return Err(DriverError::NoWidgetApi);
        }
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

    /// Set the capabilities that are granted without asking the platform, typically what the
    /// client remembers of earlier approvals (not [`legacy_auto_approved`](crate::legacy_auto_approved):
    /// the driver adds that itself). Replaces the previous list and affects only future requests.
    ///
    /// A request is answered at once if nothing else needs a decision and no question is open;
    /// otherwise these are granted with the answer. Webview capabilities among them are part of
    /// the iframe, requested or not (a change after [`start`](Self::start) loads it again), except
    /// those that are never granted ([`WebviewPolicy::Never`]).
    pub fn set_auto_approved(&self, capabilities: Vec<Capability>) {
        self.lock().auto_approved = capabilities;
        self.sync_iframe();
    }

    /// Answer the open question of [`WidgetHostPlatform::on_capabilities_requested`], and with it
    /// every request since the last answer. Does nothing if no request is pending.
    ///
    /// * Granted: what was requested and is in `approved` or auto-approved; webview capabilities
    ///   follow [`WebviewPolicy`] (base tokens always, `allow-top-navigation` never).
    /// * The widget gets `update_capabilities` with everything it holds now.
    /// * New grants subscribe to the backend again (the current state arrives as `update_state`),
    ///   or, if they change the iframe's `sandbox` or `allow`, load the iframe again.
    pub fn approve_capabilities(&self, approved: Vec<Capability>) {
        let (update, changed) = {
            let mut state = self.lock();
            let Some(requested) = state.pending_requested.take() else {
                return;
            };
            let before = state.approved.len();
            for capability in &requested {
                let approved = approved.contains(capability) || state.unasked(capability);
                let granted = WebviewPolicy::grants(capability, approved);
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
        if !self.sync_iframe() && changed {
            self.resubscribe();
        }
    }

    /// Take capabilities away from the widget, e.g. because the user revoked a permission. The
    /// widget gets `update_capabilities` with the reduced list; its requests for them fail and their
    /// pushes stop until it requests them again. They are no longer
    /// [carried](DriverSnapshot::carried); a change of the iframe's attributes loads it again.
    pub fn revoke_capabilities(&self, capabilities: Vec<Capability>) {
        let update = {
            let mut state = self.lock();
            let before = state.approved.len();
            state.approved.retain(|capability| !capabilities.contains(capability));
            state.carried.retain(|capability| !capabilities.contains(capability));
            (state.approved.len() != before).then(|| {
                log::info!(
                    "capabilities revoked: {} taken away, the widget holds {}",
                    before - state.approved.len(),
                    state.approved.len()
                );
                HostRequest::UpdateCapabilities {
                    request: UpdateCapabilitiesRequest { allowed: state.approved.clone() },
                }
            })
        };
        let revoked = update.is_some();
        // The page is told before a reload forgets it.
        if let Some(update) = update {
            self.send_request(update);
        }
        if !self.sync_iframe() && revoked {
            self.resubscribe();
        }
    }

    /// Set the capabilities that are granted for one use only (default: `widget:…get_openid`),
    /// replacing the previous list, also for what the widget holds already
    /// (`spec/patch/msc4412/capability-lifetimes.md`).
    ///
    /// A request that needs one of them as a whole (`get_openid`, `navigate`, `upload_file`, ...)
    /// uses it up when it passes the check, whatever its result; `update_capabilities` follows the
    /// reply. Host and webview capabilities are dropped from the list (no request uses them up), and
    /// capabilities checked against a request's body (`send_event.*`, ...) are never used up.
    ///
    /// * "Always": a single-use capability that is also auto-approved is granted again, without
    ///   asking, per request. Do not remember an approval of one otherwise.
    /// * The driver has no clock: a time limit is a timer of the client that calls
    ///   [`revoke_capabilities`](Self::revoke_capabilities).
    pub fn set_single_use(&self, capabilities: Vec<Capability>) {
        let (widget, other): (Vec<_>, Vec<_>) =
            capabilities.into_iter().partition(|c| !c.to_unstable_string().starts_with("host:") && !c.is_webview());
        if !other.is_empty() {
            log::warn!("ignored {} host or webview capabilities for single use: no request uses one up", other.len());
        }
        self.lock().single_use = widget;
    }

    /// Tell the widget that the client's theme changed (`update_theme`, MSC2873). `theme` is
    /// free-form; its `name` should match `client_theme` of `get_client_context`. Nothing is sent
    /// unless the widget holds `host:…update_theme`.
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
            auto_approved: unique(s.unasked_lists()),
            single_use: s.single_use.clone(),
            carried: s.carried.clone(),
            iframe: s.iframe.clone(),
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

    /// Hand `iframe` to the platform; a widget without the widget API is ready with that.
    fn load(&self, iframe: WidgetIframe) {
        log::info!("loading the widget's iframe: sandbox \"{}\", allow \"{}\"", iframe.sandbox, iframe.allow);
        self.platform.load_iframe(iframe);
        if !self.uses_widget_api {
            self.platform.on_ready();
        }
    }

    /// [`State::sync_iframe`]; if the attributes changed, the page starts over in a new iframe:
    /// nothing is forwarded to the old one any more. Returns whether it did.
    fn sync_iframe(&self) -> bool {
        let Some(iframe) = self.lock().sync_iframe() else { return false };
        self.room_subscription.cancel();
        self.to_device_subscription.cancel();
        self.turn_subscription.cancel();
        self.timeline_subscription.cancel();
        self.load(iframe);
        true
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
        self.timeline_subscription.cancel();
    }
}
