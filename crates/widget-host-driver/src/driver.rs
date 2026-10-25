use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, Weak};

use widget_actions::{
    Action, ActionError, Capability, CapabilitySet, ClientContextResponse, HostRequest, MatrixContextResponse,
    MatrixEvent, MessageKind, NotifyCapabilitiesRequest, ReadEventsResponse, SendEventRequest, SendEventResponse,
    UpdateDelayedEventAction, UpdateStateRequest, WidgetError, WidgetRequest, WidgetResponse, WireMessage,
    API_VERSION_V1,
};
use widget_matrix_backend::{BackendError, MatrixBackend, RoomSink, RoomSubjects, Subscription};

use crate::DriverError;

/// Default number of events returned by `read_events` when the widget gives no limit.
pub const DEFAULT_READ_LIMIT: u32 = 50;
/// Hard upper bound for `read_events` regardless of what the widget asks for.
pub const MAX_READ_LIMIT: u32 = 1000;

/// What the embedding client has to provide to the driver.
///
/// All methods are called synchronously from within driver methods, never concurrently from
/// multiple threads for the same driver instance (the driver serializes its own state), but
/// possibly from whatever thread/executor the platform runs the driver on.
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
pub trait WidgetHostPlatform: Send + Sync {
    /// Deliver a JSON encoded widget API message to the widget window, e.g.
    /// `iframe.contentWindow.postMessage(JSON.parse(json), widgetOrigin)`.
    ///
    /// Never use `*` as target origin (MSC4412).
    fn send_to_widget(&self, json: String);

    /// The widget asked for `requested`. The driver has already acknowledged the request.
    /// Prompt the user (or consult a policy) and then call
    /// [`WidgetHostDriver::approve_capabilities`] with the approved subset. Calling it with an
    /// empty list denies everything but still completes the negotiation.
    fn on_capabilities_requested(&self, requested: Vec<Capability>);

    /// The widget sent `content_loaded`. Hide the loading indicator and show the iframe.
    fn on_content_loaded(&self);

    /// Identifier of the embedding client, reported by `client_context` (e.g. `io.element.web`).
    fn client_id(&self) -> Option<String>;

    /// Current theme name of the client, reported by `client_context` (e.g. `dark`).
    fn client_theme(&self) -> Option<String>;

    /// Current UI language of the client, reported by `client_context` (e.g. `en`).
    fn client_language(&self) -> Option<String>;
}

/// A read-only copy of the driver's state.
#[derive(Debug, Clone, PartialEq, Eq, Default, serde::Serialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DriverSnapshot {
    /// `content_loaded` was received.
    pub content_loaded: bool,
    /// Capabilities currently granted to the widget.
    pub approved: Vec<Capability>,
    /// Capabilities requested by the widget that are still waiting for
    /// [`WidgetHostDriver::approve_capabilities`].
    pub pending_requested: Vec<Capability>,
    /// Capabilities granted without asking the platform, see
    /// [`WidgetHostDriver::set_auto_approved`].
    pub auto_approved: Vec<Capability>,
}

#[derive(Debug, Default)]
struct State {
    content_loaded: bool,
    approved: Vec<Capability>,
    pending_requested: Option<Vec<Capability>>,
    auto_approved: Vec<Capability>,
    /// Requests the host sent to the widget that have not been acknowledged yet.
    awaiting_ack: HashMap<String, HostRequest>,
}

/// Host side state machine for one widget instance. See the crate documentation.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct WidgetHostDriver {
    backend: Arc<dyn MatrixBackend>,
    platform: Arc<dyn WidgetHostPlatform>,
    state: Mutex<State>,
    /// The backend subscription matching the approved `receive.*` capabilities. Has its own
    /// lock, which is never held while calling into the backend or the platform.
    subscription: Mutex<Option<Arc<dyn Subscription>>>,
    /// For handing a (weak) reference to the sink the backend calls back on.
    this: Weak<WidgetHostDriver>,
}

/// The [`RoomSink`] the driver registers with the backend. Weak so that
/// driver -> backend -> subscription -> sink does not keep the driver alive.
struct DriverSink(Weak<WidgetHostDriver>);

impl RoomSink for DriverSink {
    fn on_timeline_events(&self, events: Vec<MatrixEvent>) {
        if let Some(driver) = self.0.upgrade() {
            driver.on_timeline_events(events);
        }
    }

    fn on_state_events(&self, event_type: String, events: Vec<MatrixEvent>) {
        if let Some(driver) = self.0.upgrade() {
            driver.on_state_events(event_type, events);
        }
    }
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
            subscription: Mutex::new(None),
            this: this.clone(),
        })
    }

    /// Feed a message received from the widget window (`event.data`, JSON encoded) into the
    /// driver. Responses to the widget are delivered through
    /// [`WidgetHostPlatform::send_to_widget`] before this returns.
    ///
    /// Errors describe messages the driver could not attribute to this protocol; the platform
    /// decides what to do (ignore, log, or hand to a legacy implementation).
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
            Err(ActionError::InvalidBody { message, .. }) if msg.kind() == MessageKind::WidgetRequest => {
                self.send(&msg.error_response_to(WidgetError::new(format!("Invalid request body: {message}"))));
                return Ok(());
            }
            // Widgets acknowledge everything with `{}`; an error response is informational only.
            Err(ActionError::ErrorResponse { .. }) if msg.kind() == MessageKind::HostResponse => {
                return self.handle_response(msg);
            }
            Err(other) => return Err(other.into()),
        };
        match action {
            Action::WidgetRequest { request } => self.handle_request(msg, request).await,
            Action::HostResponse { .. } => self.handle_response(msg),
            other => {
                Err(DriverError::WrongDirection { message: format!("host received a {:?} message", other.kind()) })
            }
        }
    }

    /// Capabilities this driver grants without consulting the platform. When a widget requests
    /// capabilities, these are approved at once; only the remaining ones reach
    /// [`WidgetHostPlatform::on_capabilities_requested`], and if nothing remains the platform is
    /// not called at all and `notify_capabilities` is sent immediately.
    ///
    /// Typical use: `m.matrix_context` and `m.client_context` for a legacy widget embedded
    /// through the compat wrapper, since a legacy client handed the same facts over as URL
    /// template parameters. Replaces any earlier list; affects future requests only.
    pub fn set_auto_approved(&self, capabilities: Vec<Capability>) {
        self.lock().auto_approved = capabilities;
    }

    /// Complete a capability negotiation started by
    /// [`WidgetHostPlatform::on_capabilities_requested`]. Only capabilities that were actually
    /// requested are granted; the rest of `approved` is ignored. Auto-approved capabilities
    /// (see [`set_auto_approved`](Self::set_auto_approved)) are granted in addition. Sends
    /// `notify_capabilities` and, when the set of `receive.*` capabilities grew, (re)subscribes
    /// to the backend, which delivers the current room state as `update_state` right after.
    ///
    /// Does nothing if there is no pending request.
    pub fn approve_capabilities(&self, approved: Vec<Capability>) {
        let (outgoing, changed) = {
            let mut state = self.lock();
            let Some(requested) = state.pending_requested.take() else {
                return;
            };
            // only grant capabilities that were requested
            let granted: Vec<Capability> =
                requested.iter().filter(|c| approved.contains(c) || state.auto_approved.contains(c)).cloned().collect();
            let before = state.approved.len();
            for cap in &granted {
                if !state.approved.contains(cap) {
                    state.approved.push(cap.clone());
                }
            }
            // `approved` is the complete set held after this round (cumulative, like the legacy
            // API), not only what was granted in this round.
            let outgoing = HostRequest::NotifyCapabilities {
                request: NotifyCapabilitiesRequest { requested, approved: state.approved.clone() },
            };
            (outgoing, state.approved.len() != before)
        };
        self.send_request(outgoing);
        if changed {
            self.resubscribe();
        }
    }

    /// Current state of the driver.
    pub fn snapshot(&self) -> DriverSnapshot {
        let s = self.lock();
        DriverSnapshot {
            content_loaded: s.content_loaded,
            approved: s.approved.clone(),
            pending_requested: s.pending_requested.clone().unwrap_or_default(),
            auto_approved: s.auto_approved.clone(),
        }
    }
}

impl WidgetHostDriver {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn take_subscription(&self) -> Option<Arc<dyn Subscription>> {
        self.subscription.lock().unwrap_or_else(|p| p.into_inner()).take()
    }

    /// Replace the backend subscription with one matching the approved capabilities. The
    /// backend may call the sink synchronously from inside `subscribe_room`, so no driver lock
    /// is held across that call.
    fn resubscribe(&self) {
        let subjects = subjects_for(&self.lock().approved);
        if let Some(old) = self.take_subscription() {
            old.cancel();
        }
        if subjects.is_empty() {
            return;
        }
        let Some(this) = self.this.upgrade() else {
            return;
        };
        let sink: Arc<dyn RoomSink> = Arc::new(DriverSink(Arc::downgrade(&this)));
        // A refused subscription leaves the widget without live events; there is no protocol
        // message for that, so the error is dropped here.
        if let Ok(subscription) = self.backend.subscribe_room(self.backend.room_id(), subjects, sink) {
            *self.subscription.lock().unwrap_or_else(|p| p.into_inner()) = Some(subscription);
        }
    }

    /// Timeline events from the subscription: forwarded one by one as `send_event` when the
    /// widget holds a matching `receive.*` capability.
    fn on_timeline_events(&self, events: Vec<MatrixEvent>) {
        for event in events {
            let allowed =
                self.lock().approved.allows_receive(&event.event_type, event.state_key.as_deref(), msgtype_of(&event));
            if allowed {
                self.send_request(HostRequest::SendEvent { event });
            }
        }
    }

    /// The current state set of one type from the subscription: forwarded as `update_state`
    /// with the events the widget may receive; nothing is sent when that leaves none.
    fn on_state_events(&self, event_type: String, events: Vec<MatrixEvent>) {
        let state: Vec<MatrixEvent> = {
            let s = self.lock();
            events
                .into_iter()
                .filter(|e| {
                    e.is_state()
                        && e.event_type == event_type
                        && s.approved.allows_receive(&e.event_type, e.state_key.as_deref(), None)
                })
                .collect()
        };
        if !state.is_empty() {
            self.send_request(HostRequest::UpdateState { request: UpdateStateRequest { state } });
        }
    }

    fn send(&self, msg: &WireMessage) {
        self.platform.send_to_widget(msg.to_json());
    }

    fn send_request(&self, request: HostRequest) {
        let id = uuid::Uuid::new_v4().to_string();
        self.lock().awaiting_ack.insert(id.clone(), request.clone());
        self.send(&request.into_wire(id));
    }

    async fn handle_request(&self, msg: WireMessage, request: WidgetRequest) -> Result<(), DriverError> {
        let response: Result<WidgetResponse, WidgetError> = match request {
            WidgetRequest::ContentLoaded => {
                self.lock().content_loaded = true;
                self.send(&msg.ack());
                self.platform.on_content_loaded();
                return Ok(());
            }
            WidgetRequest::RequestCapabilities { request } => {
                let requested = request.capabilities;
                let to_ask: Vec<Capability> = {
                    let mut state = self.lock();
                    let to_ask = requested.iter().filter(|c| !state.auto_approved.contains(c)).cloned().collect();
                    state.pending_requested = Some(requested);
                    to_ask
                };
                self.send(&msg.ack());
                if to_ask.is_empty() {
                    // Everything is auto-approved: no need to involve the platform.
                    self.approve_capabilities(Vec::new());
                } else {
                    self.platform.on_capabilities_requested(to_ask);
                }
                return Ok(());
            }
            WidgetRequest::SendEvent { request } => self.send_event(request).await,
            WidgetRequest::UpdateDelayedEvent { request } => {
                if !self.lock().approved.has(&Capability::UpdateDelayedEvent) {
                    error(format!("Missing capability for {}", Capability::UpdateDelayedEvent))
                } else {
                    let room_id = self.backend.room_id();
                    let result = match request.action {
                        UpdateDelayedEventAction::Cancel => {
                            self.backend.cancel_delayed_event(room_id, request.delay_id).await
                        }
                        UpdateDelayedEventAction::Restart => {
                            self.backend.restart_delayed_event(room_id, request.delay_id).await
                        }
                        UpdateDelayedEventAction::Send => {
                            self.backend.send_delayed_event_now(room_id, request.delay_id).await
                        }
                    };
                    result
                        .map(|_| WidgetResponse::UpdateDelayedEvent)
                        .map_err(|e| backend_error("Failed to update delayed event", e))
                }
            }
            WidgetRequest::ReadEvents { request } => {
                let is_state = request.is_state();
                let allowed = self.lock().approved.allows_read_type(&request.event_type, is_state);
                if !allowed {
                    error(format!(
                        "Not allowed to read {} events of type {}",
                        if is_state { "state" } else { "timeline" },
                        request.event_type
                    ))
                } else {
                    let limit = request.limit.unwrap_or(DEFAULT_READ_LIMIT).clamp(1, MAX_READ_LIMIT);
                    let room_id = self.backend.room_id();
                    let result = match request.state_key {
                        Some(selector) => self.backend.read_room_state(room_id, request.event_type, selector).await,
                        None => self.backend.read_room_events(room_id, request.event_type, None, limit, None).await,
                    };
                    match result {
                        Ok(events) => {
                            let approved = self.lock().approved.clone();
                            let mut events: Vec<MatrixEvent> = events
                                .into_iter()
                                .filter(|e| {
                                    approved.allows_receive(&e.event_type, e.state_key.as_deref(), msgtype_of(e))
                                })
                                .collect();
                            events.truncate(limit as usize);
                            Ok(WidgetResponse::ReadEvents { response: ReadEventsResponse { events } })
                        }
                        Err(e) => Err(backend_error("Failed to read events", e)),
                    }
                }
            }
            WidgetRequest::MatrixContext => {
                if !self.lock().approved.contains(&Capability::MatrixContext) {
                    error("Not allowed to read the matrix context (missing capability m.matrix_context)".into())
                } else {
                    Ok(WidgetResponse::MatrixContext {
                        response: MatrixContextResponse {
                            user_id: self.backend.own_user_id(),
                            device_id: self.backend.own_device_id(),
                            room_id: self.backend.room_id(),
                            display_name: self.backend.display_name(),
                            avatar_url: self.backend.avatar_url(),
                            matrix_base_url: self.backend.base_url(),
                        },
                    })
                }
            }
            WidgetRequest::ClientContext => {
                if !self.lock().approved.contains(&Capability::ClientContext) {
                    error("Not allowed to read the client context (missing capability m.client_context)".into())
                } else {
                    Ok(WidgetResponse::ClientContext {
                        response: ClientContextResponse {
                            client_id: self.platform.client_id(),
                            client_theme: self.platform.client_theme(),
                            client_language: self.platform.client_language(),
                        },
                    })
                }
            }
            WidgetRequest::Unknown => error(format!("Unknown action `{}`", msg.action)),
        };

        self.send(&match response {
            Ok(response) => response.into_wire_reply(&msg),
            Err(error) => msg.error_response_to(error),
        });
        Ok(())
    }

    /// `send_event` from the widget: capability checks for every variant (plain, state, other
    /// room, delayed, sticky), then the matching backend call.
    async fn send_event(&self, request: SendEventRequest) -> Result<WidgetResponse, WidgetError> {
        let room_id = self.backend.room_id();
        let msgtype = request.content.get("msgtype").and_then(|m| m.as_str()).map(str::to_owned);
        {
            let approved = self.lock().approved.clone();
            if let Some(requested) = &request.room_id {
                // Like matrix-widget-api: an explicit room needs the timeline capability even
                // when it is the widget's own room, and this host only serves that one.
                if !(approved.has(&Capability::timeline(requested)) || approved.has(&Capability::timeline("*"))) {
                    return error(format!("Unable to access room timeline: {requested}"));
                }
                if *requested != room_id {
                    return error(format!("Unable to access room timeline: {requested} (this host serves {room_id})"));
                }
            }
            if request.is_delayed() && !approved.has(&Capability::SendDelayedEvent) {
                return error(format!("Missing capability for {}", Capability::SendDelayedEvent));
            }
            if request.is_sticky() && !approved.has(&Capability::SendStickyEvent) {
                return error(format!("Missing capability for {}", Capability::SendStickyEvent));
            }
            if request.is_sticky() && request.is_state() {
                return error("Cannot send a state event with a sticky duration".into());
            }
            if !approved.allows_send(&request.event_type, request.state_key.as_deref(), msgtype.as_deref()) {
                let needed = match &request.state_key {
                    Some(k) => Capability::send_state_event(&request.event_type, Some(k.as_str())),
                    None => Capability::send_event(&request.event_type),
                };
                return error(format!("Not allowed to send this event (missing capability {needed})"));
            }
        }
        let SendEventRequest { event_type, state_key, content, delay, sticky_duration_ms, .. } = request;
        let backend = &self.backend;
        let result = match (state_key, delay, sticky_duration_ms) {
            (Some(key), None, _) => backend
                .send_state_event(room_id.clone(), event_type, key, content)
                .await
                .map(|id| SendEventResponse::sent(&room_id, id)),
            (state_key, Some(delay), None) => backend
                .send_delayed_event(room_id.clone(), event_type, state_key, content, delay)
                .await
                .map(|id| SendEventResponse::delayed(&room_id, id)),
            (None, Some(delay), Some(duration)) => backend
                .send_delayed_sticky_event(room_id.clone(), event_type, content, delay, duration)
                .await
                .map(|id| SendEventResponse::delayed(&room_id, id)),
            (None, None, Some(duration)) => backend
                .send_sticky_event(room_id.clone(), event_type, content, duration)
                .await
                .map(|id| SendEventResponse::sent(&room_id, id)),
            (None, None, None) => backend
                .send_room_event(room_id.clone(), event_type, content)
                .await
                .map(|id| SendEventResponse::sent(&room_id, id)),
            (Some(_), Some(_), Some(_)) => return error("Cannot send a state event with a sticky duration".into()),
        };
        result
            .map(|response| WidgetResponse::SendEvent { response })
            .map_err(|e| backend_error("Failed to send event", e))
    }

    fn handle_response(&self, msg: WireMessage) -> Result<(), DriverError> {
        let pending = self.lock().awaiting_ack.remove(&msg.request_id);
        if pending.is_none() {
            return Err(DriverError::UnexpectedResponse { request_id: msg.request_id });
        }
        Ok(())
    }
}

impl Drop for WidgetHostDriver {
    fn drop(&mut self) {
        if let Some(subscription) = self.take_subscription() {
            subscription.cancel();
        }
    }
}

/// What to subscribe to for a set of approved capabilities: `receive.event:T` means `T` on the
/// timeline; `receive.state_event:T[#k]` means the state set of `T` *and* `T` on the timeline
/// (state events are timeline events too, and widgets expect them as `send_event` as well).
/// State keys are not part of the subjects; the driver filters them when forwarding.
fn subjects_for(approved: &[Capability]) -> RoomSubjects {
    let mut subjects = RoomSubjects::default();
    let push = |list: &mut Vec<String>, t: &str| {
        if !list.iter().any(|x| x == t) {
            list.push(t.to_owned());
        }
    };
    for cap in approved {
        match cap {
            Capability::ReceiveEvent { event_type, .. } => push(&mut subjects.timeline_event_types, event_type),
            Capability::ReceiveStateEvent { event_type, .. } => {
                push(&mut subjects.timeline_event_types, event_type);
                push(&mut subjects.state_event_types, event_type);
            }
            _ => {}
        }
    }
    subjects
}

fn error<T>(message: String) -> Result<T, WidgetError> {
    Err(WidgetError::new(message))
}

/// The widget error for a failed backend call: `context` plus the reason as the message, and the
/// Matrix error details (if the backend had any) as `matrix_api_error`.
fn backend_error(context: &str, err: BackendError) -> WidgetError {
    WidgetError::with_matrix_error(
        format!("{context}: {}", err.reason()),
        err.errcode().map(str::to_owned),
        err.status(),
        err.reason(),
    )
}

/// The `msgtype` of a message-like event, for the `m.room.message#<msgtype>` capabilities.
fn msgtype_of(event: &MatrixEvent) -> Option<&str> {
    event.content.get("msgtype").and_then(|m| m.as_str())
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

    use serde_json::{json, Value};
    use widget_actions::{ReadEventsRequest, RequestCapabilitiesRequest, SendEventRequest, Source, StateKeySelector};
    use widget_matrix_backend::{InMemoryBackend, JsonValue};

    use super::*;

    #[derive(Default)]
    struct RecordingPlatform {
        sent: Mutex<Vec<WireMessage>>,
        requested: Mutex<Vec<Vec<Capability>>>,
        loaded: AtomicBool,
    }

    impl RecordingPlatform {
        fn drain(&self) -> Vec<WireMessage> {
            std::mem::take(&mut *self.sent.lock().unwrap())
        }
    }

    impl WidgetHostPlatform for RecordingPlatform {
        fn send_to_widget(&self, json: String) {
            self.sent.lock().unwrap().push(WireMessage::from_json(&json).unwrap());
        }
        fn on_capabilities_requested(&self, requested: Vec<Capability>) {
            self.requested.lock().unwrap().push(requested);
        }
        fn on_content_loaded(&self) {
            self.loaded.store(true, Ordering::SeqCst);
        }
        fn client_id(&self) -> Option<String> {
            Some("test-client".into())
        }
        fn client_theme(&self) -> Option<String> {
            Some("dark".into())
        }
        fn client_language(&self) -> Option<String> {
            None
        }
    }

    fn setup() -> (Arc<WidgetHostDriver>, Arc<InMemoryBackend>, Arc<RecordingPlatform>) {
        let backend = InMemoryBackend::new("!room:x".into(), "@me:x".into());
        let platform = Arc::new(RecordingPlatform::default());
        let driver = WidgetHostDriver::new(backend.clone(), platform.clone());
        (driver, backend, platform)
    }

    #[derive(Default)]
    struct TestSubscription {
        cancelled: AtomicUsize,
    }

    impl Subscription for TestSubscription {
        fn cancel(&self) {
            self.cancelled.fetch_add(1, Ordering::SeqCst);
        }
    }

    /// Delegates sends and reads to an `InMemoryBackend` and records `subscribe_room` calls
    /// (without ever delivering anything).
    struct RecordingBackend {
        inner: Arc<InMemoryBackend>,
        subscribe_calls: Mutex<Vec<(String, RoomSubjects)>>,
        subscriptions: Mutex<Vec<Arc<TestSubscription>>>,
    }

    impl RecordingBackend {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                inner: InMemoryBackend::new("!room:x".into(), "@me:x".into()),
                subscribe_calls: Default::default(),
                subscriptions: Default::default(),
            })
        }
        fn calls(&self) -> Vec<(String, RoomSubjects)> {
            self.subscribe_calls.lock().unwrap().clone()
        }
        fn cancelled(&self) -> Vec<usize> {
            self.subscriptions.lock().unwrap().iter().map(|s| s.cancelled.load(Ordering::SeqCst)).collect()
        }
    }

    #[async_trait::async_trait]
    impl MatrixBackend for RecordingBackend {
        fn room_id(&self) -> String {
            self.inner.room_id()
        }
        fn own_user_id(&self) -> String {
            self.inner.own_user_id()
        }
        fn own_device_id(&self) -> String {
            self.inner.own_device_id()
        }
        fn display_name(&self) -> String {
            self.inner.display_name()
        }
        fn avatar_url(&self) -> String {
            self.inner.avatar_url()
        }
        fn base_url(&self) -> String {
            self.inner.base_url()
        }
        async fn send_room_event(
            &self,
            room_id: String,
            event_type: String,
            content: JsonValue,
        ) -> Result<String, BackendError> {
            self.inner.send_room_event(room_id, event_type, content).await
        }
        async fn send_state_event(
            &self,
            room_id: String,
            event_type: String,
            state_key: String,
            content: JsonValue,
        ) -> Result<String, BackendError> {
            self.inner.send_state_event(room_id, event_type, state_key, content).await
        }
        async fn send_sticky_event(
            &self,
            room_id: String,
            event_type: String,
            content: JsonValue,
            duration_ms: u64,
        ) -> Result<String, BackendError> {
            self.inner.send_sticky_event(room_id, event_type, content, duration_ms).await
        }
        async fn send_delayed_event(
            &self,
            room_id: String,
            event_type: String,
            state_key: Option<String>,
            content: JsonValue,
            delay_ms: u64,
        ) -> Result<String, BackendError> {
            self.inner.send_delayed_event(room_id, event_type, state_key, content, delay_ms).await
        }
        async fn send_delayed_sticky_event(
            &self,
            room_id: String,
            event_type: String,
            content: JsonValue,
            delay_ms: u64,
            duration_ms: u64,
        ) -> Result<String, BackendError> {
            self.inner.send_delayed_sticky_event(room_id, event_type, content, delay_ms, duration_ms).await
        }
        async fn restart_delayed_event(&self, room_id: String, delay_id: String) -> Result<(), BackendError> {
            self.inner.restart_delayed_event(room_id, delay_id).await
        }
        async fn cancel_delayed_event(&self, room_id: String, delay_id: String) -> Result<(), BackendError> {
            self.inner.cancel_delayed_event(room_id, delay_id).await
        }
        async fn send_delayed_event_now(&self, room_id: String, delay_id: String) -> Result<(), BackendError> {
            self.inner.send_delayed_event_now(room_id, delay_id).await
        }
        async fn read_room_events(
            &self,
            room_id: String,
            event_type: String,
            msgtype: Option<String>,
            limit: u32,
            since: Option<String>,
        ) -> Result<Vec<MatrixEvent>, BackendError> {
            self.inner.read_room_events(room_id, event_type, msgtype, limit, since).await
        }
        async fn read_room_state(
            &self,
            room_id: String,
            event_type: String,
            state_key: StateKeySelector,
        ) -> Result<Vec<MatrixEvent>, BackendError> {
            self.inner.read_room_state(room_id, event_type, state_key).await
        }
        fn subscribe_room(
            &self,
            room_id: String,
            subjects: RoomSubjects,
            _sink: Arc<dyn RoomSink>,
        ) -> Result<Arc<dyn Subscription>, BackendError> {
            self.subscribe_calls.lock().unwrap().push((room_id, subjects));
            let subscription = Arc::new(TestSubscription::default());
            self.subscriptions.lock().unwrap().push(subscription.clone());
            Ok(subscription)
        }
    }

    fn block<F: std::future::Future>(f: F) -> F::Output {
        futures::executor::block_on(f)
    }

    async fn feed(driver: &WidgetHostDriver, req: WidgetRequest, id: &str) -> Result<(), DriverError> {
        driver.handle_message_from_widget(req.into_wire(id).to_json()).await
    }

    fn event(event_type: &str, state_key: Option<&str>, content: Value) -> MatrixEvent {
        MatrixEvent {
            event_type: event_type.into(),
            sender: "@other:x".into(),
            event_id: "$in".into(),
            room_id: "!room:x".into(),
            origin_server_ts: 5,
            state_key: state_key.map(Into::into),
            content: content.into(),
            unsigned: None,
        }
    }

    #[test]
    fn content_loaded_is_acked_and_reported() {
        let (driver, _, platform) = setup();
        block(feed(&driver, WidgetRequest::ContentLoaded, "c1")).unwrap();
        let sent = platform.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].request_id, "c1");
        assert_eq!(sent[0].source, Source::Widget);
        assert_eq!(sent[0].response_body(), json!({}));
        assert!(platform.loaded.load(Ordering::SeqCst));
        assert!(driver.snapshot().content_loaded);
    }

    #[test]
    fn capability_negotiation() {
        let (driver, _, platform) = setup();
        let caps = vec![Capability::send_event("m.room.message"), Capability::receive_event("m.room.message")];
        block(feed(
            &driver,
            WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
            "cap1",
        ))
        .unwrap();

        // Immediate ack, platform asked.
        let sent = platform.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].request_id, "cap1");
        assert_eq!(platform.requested.lock().unwrap().as_slice(), std::slice::from_ref(&caps));
        assert_eq!(driver.snapshot().pending_requested, caps);
        assert!(driver.snapshot().approved.is_empty());

        // Platform approves one of them (plus something that was never requested).
        driver.approve_capabilities(vec![Capability::send_event("m.room.message"), Capability::send_event("evil")]);
        let sent = platform.drain();
        assert_eq!(sent.len(), 1);
        let notify = HostRequest::from_wire(&sent[0]).unwrap();
        assert_eq!(
            notify,
            HostRequest::NotifyCapabilities {
                request: NotifyCapabilitiesRequest {
                    requested: caps,
                    approved: vec![Capability::send_event("m.room.message")]
                }
            }
        );
        assert_eq!(driver.snapshot().approved, vec![Capability::send_event("m.room.message")]);
        assert!(driver.snapshot().pending_requested.is_empty());

        // Widget acks notify_capabilities.
        block(driver.handle_message_from_widget(sent[0].ack().to_json())).unwrap();
        // A second ack for the same id is unexpected.
        assert_eq!(
            block(driver.handle_message_from_widget(sent[0].ack().to_json())),
            Err(DriverError::UnexpectedResponse { request_id: sent[0].request_id.clone() })
        );

        // A second round: `approved` in notify_capabilities is cumulative (legacy compatible).
        let more = vec![Capability::receive_event("m.room.topic")];
        block(feed(
            &driver,
            WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: more.clone() } },
            "cap2",
        ))
        .unwrap();
        platform.drain();
        driver.approve_capabilities(more.clone());
        let sent = platform.drain();
        assert_eq!(
            HostRequest::from_wire(&sent[0]).unwrap(),
            HostRequest::NotifyCapabilities {
                request: NotifyCapabilitiesRequest {
                    requested: more,
                    approved: vec![Capability::send_event("m.room.message"), Capability::receive_event("m.room.topic")]
                }
            }
        );
        block(driver.handle_message_from_widget(sent[0].ack().to_json())).unwrap();

        // Approving again with nothing pending is a no-op.
        driver.approve_capabilities(vec![Capability::send_event("x")]);
        assert!(platform.drain().is_empty());
    }

    fn grant(driver: &WidgetHostDriver, platform: &RecordingPlatform, caps: Vec<Capability>) {
        block(feed(
            driver,
            WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
            "grant",
        ))
        .unwrap();
        driver.approve_capabilities(caps);
        platform.drain();
    }

    #[test]
    fn send_event_requires_capability() {
        let (driver, backend, platform) = setup();
        let req = WidgetRequest::SendEvent {
            request: SendEventRequest::room_event("m.room.message", json!({"body": "hi"}).into()),
        };

        block(feed(&driver, req.clone(), "s1")).unwrap();
        let sent = platform.drain();
        let err = sent[0].error().expect("should be an error");
        assert!(err.message.contains("org.matrix.msc2762.send.event:m.room.message"), "{}", err.message);
        assert!(backend.timeline().is_empty());

        grant(&driver, &platform, vec![Capability::send_event("m.room.message")]);
        block(feed(&driver, req, "s2")).unwrap();
        let sent = platform.drain();
        match WidgetResponse::from_wire(&sent[0]).unwrap() {
            WidgetResponse::SendEvent { response } => {
                assert_eq!(response.room_id, "!room:x");
                assert_eq!(Some(&backend.timeline()[0].event_id), response.event_id.as_ref());
                assert!(response.delay_id.is_none());
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(backend.timeline()[0].content["body"], "hi");

        // state event with a timeline-only capability -> denied
        block(feed(
            &driver,
            WidgetRequest::SendEvent { request: SendEventRequest::state_event("m.room.message", "", json!({}).into()) },
            "s3",
        ))
        .unwrap();
        assert!(platform.drain()[0].error().is_some());

        // backend failure is relayed as an error response
        backend.set_fail_sends(Some(BackendError::forbidden("power level")));
        block(feed(
            &driver,
            WidgetRequest::SendEvent { request: SendEventRequest::room_event("m.room.message", json!({}).into()) },
            "s4",
        ))
        .unwrap();
        let err = platform.drain()[0].error().unwrap();
        assert!(err.message.contains("power level"));
        let matrix = err.matrix_api_error.unwrap();
        assert_eq!(matrix.http_status, 403);
        assert_eq!(matrix.response.errcode, "M_FORBIDDEN");
        assert_eq!(matrix.response.error, "power level");
    }

    #[test]
    fn msgtype_capabilities_narrow_sends_and_reads() {
        let (driver, backend, platform) = setup();
        grant(&driver, &platform, vec![Capability::send_message("m.text"), Capability::receive_message("m.text")]);
        let send = |msgtype: &str, id: &str| {
            block(feed(
                &driver,
                WidgetRequest::SendEvent {
                    request: SendEventRequest::room_event(
                        "m.room.message",
                        json!({"msgtype": msgtype, "body": "x"}).into(),
                    ),
                },
                id,
            ))
            .unwrap();
        };
        send("m.text", "t1");
        send("m.image", "t2");
        let sent = platform.drain();
        // The text message is echoed through the subscription (send_event) and answered; the
        // image is refused.
        assert_eq!(
            sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(),
            ["send_event", "send_event", "send_event"]
        );
        assert!(sent[1].error().is_none());
        assert!(sent[2].error().unwrap().message.contains("m.room.message"));
        backend.inject(event("m.room.message", None, json!({"msgtype": "m.image", "body": "pic"})));
        assert!(platform.drain().is_empty());

        block(feed(
            &driver,
            WidgetRequest::ReadEvents {
                request: ReadEventsRequest { event_type: "m.room.message".into(), state_key: None, limit: None },
            },
            "r",
        ))
        .unwrap();
        let WidgetResponse::ReadEvents { response } = WidgetResponse::from_wire(&platform.drain()[0]).unwrap() else {
            panic!()
        };
        assert_eq!(response.events.len(), 1);
        assert_eq!(response.events[0].content["msgtype"], "m.text");
    }

    /// Feed a `send_event` and return the host's reply.
    fn send(driver: &WidgetHostDriver, platform: &RecordingPlatform, request: SendEventRequest) -> WireMessage {
        block(feed(driver, WidgetRequest::SendEvent { request }, "send")).unwrap();
        platform.drain().pop().unwrap()
    }

    #[test]
    fn delayed_and_sticky_sends() {
        let (driver, backend, platform) = setup();
        let mut delayed = SendEventRequest::room_event("m.room.message", json!({"body": "later"}).into());
        delayed.delay = Some(5000);
        let mut sticky = SendEventRequest::room_event("m.rtc.member", json!({}).into());
        sticky.sticky_duration_ms = Some(30000);

        // Without the MSC4157 / MSC4407 capabilities both are refused, even with send.event.
        grant(
            &driver,
            &platform,
            vec![Capability::send_event("m.room.message"), Capability::send_event("m.rtc.member")],
        );
        assert!(send(&driver, &platform, delayed.clone()).error().unwrap().message.contains("send.delayed_event"));
        assert!(send(&driver, &platform, sticky.clone()).error().unwrap().message.contains("send.sticky_event"));

        grant(
            &driver,
            &platform,
            vec![Capability::SendDelayedEvent, Capability::SendStickyEvent, Capability::UpdateDelayedEvent],
        );
        let WidgetResponse::SendEvent { response } =
            WidgetResponse::from_wire(&send(&driver, &platform, delayed)).unwrap()
        else {
            panic!()
        };
        assert!(response.event_id.is_none());
        let delay_id = response.delay_id.unwrap();
        assert_eq!(backend.delayed_events()[0].delay_id, delay_id);
        assert!(backend.timeline().is_empty());

        // A sticky state event is nonsense.
        let mut sticky_state = SendEventRequest::state_event("m.room.topic", "", json!({}).into());
        sticky_state.sticky_duration_ms = Some(1);
        assert!(send(&driver, &platform, sticky_state).error().unwrap().message.contains("sticky"));

        // Sticky send goes through the sticky method.
        let WidgetResponse::SendEvent { response } =
            WidgetResponse::from_wire(&send(&driver, &platform, sticky)).unwrap()
        else {
            panic!()
        };
        assert_eq!(backend.timeline()[0].event_id, response.event_id.unwrap());

        // update_delayed_event: restart, then fire.
        for (action, id) in [(UpdateDelayedEventAction::Restart, "u1"), (UpdateDelayedEventAction::Send, "u2")] {
            block(feed(
                &driver,
                WidgetRequest::UpdateDelayedEvent {
                    request: widget_actions::UpdateDelayedEventRequest { delay_id: delay_id.clone(), action },
                },
                id,
            ))
            .unwrap();
            assert_eq!(
                WidgetResponse::from_wire(&platform.drain().pop().unwrap()).unwrap(),
                WidgetResponse::UpdateDelayedEvent
            );
        }
        assert!(backend.delayed_events().is_empty());
        assert_eq!(backend.timeline()[1].content["body"], "later");

        // Cancelling an unknown id is a backend error with Matrix details.
        block(feed(
            &driver,
            WidgetRequest::UpdateDelayedEvent {
                request: widget_actions::UpdateDelayedEventRequest {
                    delay_id: "nope".into(),
                    action: UpdateDelayedEventAction::Cancel,
                },
            },
            "u3",
        ))
        .unwrap();
        let err = platform.drain().pop().unwrap().error().unwrap();
        assert_eq!(err.matrix_api_error.unwrap().response.errcode, "M_NOT_FOUND");
    }

    #[test]
    fn explicit_room_id_needs_the_timeline_capability_and_the_own_room() {
        let (driver, backend, platform) = setup();
        grant(&driver, &platform, vec![Capability::send_event("m.room.message")]);
        let mut req = SendEventRequest::room_event("m.room.message", json!({}).into());
        req.room_id = Some("!room:x".into());
        assert!(send(&driver, &platform, req.clone())
            .error()
            .unwrap()
            .message
            .contains("Unable to access room timeline"));

        grant(&driver, &platform, vec![Capability::timeline("!room:x")]);
        assert!(send(&driver, &platform, req.clone()).error().is_none());
        assert_eq!(backend.timeline().len(), 1);

        req.room_id = Some("!other:x".into());
        assert!(send(&driver, &platform, req.clone()).error().is_some());
        grant(&driver, &platform, vec![Capability::timeline("*")]);
        // Even with the wildcard: this host serves one room.
        assert!(send(&driver, &platform, req).error().unwrap().message.contains("this host serves"));
    }

    #[test]
    fn read_events_filters_by_capability() {
        let (driver, backend, platform) = setup();
        backend.inject(event("m.room.topic", Some(""), json!({"topic": "t"})));
        backend.inject(event("m.room.member", Some("@me:x"), json!({"membership": "join"})));
        backend.inject(event("m.room.member", Some("@other:x"), json!({"membership": "join"})));
        backend.inject(event("m.room.message", None, json!({"body": "1"})));
        backend.inject(event("m.room.message", None, json!({"body": "2"})));

        let read_members = WidgetRequest::ReadEvents {
            request: ReadEventsRequest {
                event_type: "m.room.member".into(),
                state_key: Some(StateKeySelector::Any),
                limit: None,
            },
        };
        block(feed(&driver, read_members.clone(), "r0")).unwrap();
        assert!(platform.drain()[0].error().is_some());

        grant(
            &driver,
            &platform,
            vec![
                Capability::receive_state_event("m.room.member", Some("@me:x")),
                Capability::receive_event("m.room.message"),
            ],
        );

        block(feed(&driver, read_members, "r1")).unwrap();
        let WidgetResponse::ReadEvents { response } = WidgetResponse::from_wire(&platform.drain()[0]).unwrap() else {
            panic!()
        };
        // Only the state key we are allowed to see.
        assert_eq!(response.events.len(), 1);
        assert_eq!(response.events[0].state_key.as_deref(), Some("@me:x"));

        block(feed(
            &driver,
            WidgetRequest::ReadEvents {
                request: ReadEventsRequest { event_type: "m.room.message".into(), state_key: None, limit: Some(1) },
            },
            "r2",
        ))
        .unwrap();
        let WidgetResponse::ReadEvents { response } = WidgetResponse::from_wire(&platform.drain()[0]).unwrap() else {
            panic!()
        };
        assert_eq!(response.events.len(), 1);
        assert_eq!(response.events[0].content["body"], "2");
    }

    /// Request `caps` and approve them, returning what was sent after `notify_capabilities`.
    fn grant_and_drain(
        driver: &WidgetHostDriver,
        platform: &RecordingPlatform,
        caps: Vec<Capability>,
    ) -> Vec<WireMessage> {
        block(feed(
            driver,
            WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
            "grant",
        ))
        .unwrap();
        platform.drain();
        driver.approve_capabilities(caps);
        let mut sent = platform.drain();
        assert_eq!(sent.remove(0).action, "notify_capabilities");
        sent
    }

    fn types(list: &[&str]) -> Vec<String> {
        list.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn approving_capabilities_subscribes_with_derived_subjects() {
        let backend = RecordingBackend::new();
        let platform = Arc::new(RecordingPlatform::default());
        let driver = WidgetHostDriver::new(backend.clone(), platform.clone());

        // Send-only capabilities: nothing to subscribe to.
        grant_and_drain(&driver, &platform, vec![Capability::send_event("m.room.message")]);
        assert!(backend.calls().is_empty());

        grant_and_drain(
            &driver,
            &platform,
            vec![
                Capability::receive_event("m.room.message"),
                Capability::receive_state_event("m.room.topic", None::<&str>),
                Capability::receive_state_event("m.room.topic", Some("")),
            ],
        );
        let calls = backend.calls();
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].0, "!room:x");
        assert_eq!(calls[0].1.timeline_event_types, types(&["m.room.message", "m.room.topic"]));
        assert_eq!(calls[0].1.state_event_types, types(&["m.room.topic"]));

        // Nothing new granted: no new subscription.
        grant_and_drain(&driver, &platform, vec![Capability::receive_event("m.room.message")]);
        assert_eq!(backend.calls().len(), 1);
        assert_eq!(backend.cancelled(), vec![0]);

        // A new receive capability: the old subscription is cancelled, a wider one made.
        grant_and_drain(&driver, &platform, vec![Capability::receive_event("m.reaction")]);
        let calls = backend.calls();
        assert_eq!(calls.len(), 2);
        assert_eq!(calls[1].1.timeline_event_types, types(&["m.room.message", "m.room.topic", "m.reaction"]));
        assert_eq!(backend.cancelled(), vec![1, 0]);
    }

    #[test]
    fn dropping_the_driver_cancels_the_subscription() {
        let backend = RecordingBackend::new();
        let platform = Arc::new(RecordingPlatform::default());
        let driver = WidgetHostDriver::new(backend.clone(), platform.clone());
        grant_and_drain(&driver, &platform, vec![Capability::receive_event("m.room.message")]);
        assert_eq!(backend.cancelled(), vec![0]);
        drop(driver);
        assert_eq!(backend.cancelled(), vec![1]);
    }

    #[test]
    fn initial_state_and_changes_reach_the_widget() {
        let (driver, backend, platform) = setup();
        backend.inject(event("m.room.topic", Some(""), json!({"topic": "t1"})));
        backend.inject(event("m.room.name", Some(""), json!({"name": "n"})));
        backend.inject(event("m.room.message", None, json!({"body": "old"})));

        // Approval delivers the current state the widget may see, synchronously (the in-memory
        // backend calls the sink from inside `subscribe_room`), right after `notify_capabilities`.
        let sent = grant_and_drain(
            &driver,
            &platform,
            vec![
                Capability::receive_state_event("m.room.topic", None::<&str>),
                Capability::receive_event("m.room.message"),
            ],
        );
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, "update_state");
        let state = sent[0].request_body()["state"].as_array().unwrap().clone();
        assert_eq!(state.len(), 1);
        assert_eq!(state[0]["content"]["topic"], "t1");

        // A changed topic: forwarded as a timeline event and as the new state set.
        backend.inject(event("m.room.topic", Some(""), json!({"topic": "t2"})));
        let sent = platform.drain();
        assert_eq!(sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(), ["send_event", "update_state"]);
        assert_eq!(sent[0].source, Source::Host);
        assert!(sent[0].is_v1());
        assert_eq!(sent[0].request_body()["content"]["topic"], "t2");
        let state = sent[1].request_body()["state"].as_array().unwrap().clone();
        assert_eq!(state.len(), 1);
        assert_eq!(state[0]["content"]["topic"], "t2");

        // Types without a capability are dropped.
        backend.inject(event("m.room.name", Some(""), json!({"name": "n2"})));
        backend.inject(event("m.reaction", None, json!({})));
        assert!(platform.drain().is_empty());

        // A timeline event only.
        backend.inject(event("m.room.message", None, json!({"body": "x"})));
        let sent = platform.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, "send_event");
        assert_eq!(sent[0].request_body()["content"]["body"], "x");

        // Emptied state is not pushed as an empty `update_state`.
        backend.clear();
        assert!(platform.drain().is_empty());
    }

    #[test]
    fn state_key_capability_filters_the_set() {
        let (driver, backend, platform) = setup();
        backend.inject(event("m.room.member", Some("@me:x"), json!({"membership": "join"})));
        backend.inject(event("m.room.member", Some("@other:x"), json!({"membership": "join"})));
        let sent =
            grant_and_drain(&driver, &platform, vec![Capability::receive_state_event("m.room.member", Some("@me:x"))]);
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, "update_state");
        let state = sent[0].request_body()["state"].as_array().unwrap().clone();
        assert_eq!(state.len(), 1);
        assert_eq!(state[0]["state_key"], "@me:x");

        // The other member changing: the full set is re-delivered, still filtered to `@me:x`
        // and never as `send_event` (no capability for that state key).
        backend.inject(event("m.room.member", Some("@other:x"), json!({"membership": "leave"})));
        let sent = platform.drain();
        assert_eq!(sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(), ["update_state"]);
        let state = sent[0].request_body()["state"].as_array().unwrap().clone();
        assert_eq!(state.len(), 1);
        assert_eq!(state[0]["state_key"], "@me:x");
    }

    #[test]
    fn protocol_errors() {
        let (driver, _, platform) = setup();
        assert!(matches!(
            block(driver.handle_message_from_widget("not json".into())),
            Err(DriverError::NotAWidgetMessage { .. })
        ));
        let legacy = json!({"source": "widget", "action": "content_loaded", "requestId": "1", "request": {}});
        assert_eq!(block(driver.handle_message_from_widget(legacy.to_string())), Err(DriverError::LegacyWidgetApi));
        let v2 = json!({"source": "widget", "action": "x", "requestId": "1", "request": {}, "version": "v2"});
        assert_eq!(
            block(driver.handle_message_from_widget(v2.to_string())),
            Err(DriverError::UnsupportedVersion { version: "v2".into() })
        );
        let host_req = HostRequest::SendEvent { event: event("m.x", None, json!({})) }.into_wire("h");
        assert!(matches!(
            block(driver.handle_message_from_widget(host_req.to_json())),
            Err(DriverError::WrongDirection { .. })
        ));
        assert!(platform.drain().is_empty());

        // Unknown action and malformed body get error *responses*, not driver errors.
        let unknown = WireMessage::request(Source::Widget, "org.example.nope", "u", json!({}));
        block(driver.handle_message_from_widget(unknown.to_json())).unwrap();
        let bad = WireMessage::request(Source::Widget, "send_event", "b", json!({"type": 5}));
        block(driver.handle_message_from_widget(bad.to_json())).unwrap();
        let sent = platform.drain();
        assert_eq!(sent.len(), 2);
        assert!(sent[0].error().unwrap().message.contains("Unknown action"));
        assert!(sent[1].error().unwrap().message.contains("Invalid request body"));
    }

    #[test]
    fn context_actions_need_their_capabilities() {
        let (driver, _, platform) = setup();
        block(feed(&driver, WidgetRequest::MatrixContext, "m1")).unwrap();
        block(feed(&driver, WidgetRequest::ClientContext, "c1")).unwrap();
        let sent = platform.drain();
        assert!(sent[0].error().unwrap().message.contains("m.matrix_context"));
        assert!(sent[1].error().unwrap().message.contains("m.client_context"));

        let caps = vec![Capability::MatrixContext, Capability::ClientContext];
        block(feed(
            &driver,
            WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
            "cap",
        ))
        .unwrap();
        driver.approve_capabilities(caps);
        platform.drain();

        block(feed(&driver, WidgetRequest::MatrixContext, "m2")).unwrap();
        block(feed(&driver, WidgetRequest::ClientContext, "c2")).unwrap();
        let sent = platform.drain();
        assert_eq!(
            WidgetResponse::from_wire(&sent[0]).unwrap(),
            WidgetResponse::MatrixContext {
                response: MatrixContextResponse {
                    user_id: "@me:x".into(),
                    device_id: "WIDGETTEST".into(),
                    room_id: "!room:x".into(),
                    display_name: "@me:x".into(),
                    avatar_url: String::new(),
                    matrix_base_url: "https://matrix.example.org".into(),
                }
            }
        );
        assert_eq!(
            WidgetResponse::from_wire(&sent[1]).unwrap(),
            WidgetResponse::ClientContext {
                response: ClientContextResponse {
                    client_id: Some("test-client".into()),
                    client_theme: Some("dark".into()),
                    client_language: None
                }
            }
        );
    }

    #[test]
    fn auto_approved_capabilities_skip_the_platform() {
        let (driver, _, platform) = setup();
        driver.set_auto_approved(vec![Capability::MatrixContext, Capability::ClientContext]);
        assert_eq!(driver.snapshot().auto_approved.len(), 2);

        // Only auto-approved capabilities: granted at once, platform never asked.
        block(feed(
            &driver,
            WidgetRequest::RequestCapabilities {
                request: RequestCapabilitiesRequest { capabilities: vec![Capability::MatrixContext] },
            },
            "a1",
        ))
        .unwrap();
        let sent = platform.drain();
        assert!(platform.requested.lock().unwrap().is_empty());
        assert_eq!(sent.len(), 2);
        assert_eq!(sent[0].request_id, "a1");
        assert_eq!(
            HostRequest::from_wire(&sent[1]).unwrap(),
            HostRequest::NotifyCapabilities {
                request: NotifyCapabilitiesRequest {
                    requested: vec![Capability::MatrixContext],
                    approved: vec![Capability::MatrixContext]
                }
            }
        );
        block(driver.handle_message_from_widget(sent[1].ack().to_json())).unwrap();

        // Mixed: the platform is asked only about the rest, auto-approved ones are added.
        let mixed = vec![Capability::ClientContext, Capability::send_event("m.room.message")];
        block(feed(
            &driver,
            WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: mixed } },
            "a2",
        ))
        .unwrap();
        platform.drain();
        assert_eq!(platform.requested.lock().unwrap().as_slice(), &[vec![Capability::send_event("m.room.message")]]);
        driver.approve_capabilities(vec![Capability::send_event("m.room.message")]);
        let notify = HostRequest::from_wire(&platform.drain()[0]).unwrap();
        assert_eq!(
            notify,
            HostRequest::NotifyCapabilities {
                request: NotifyCapabilitiesRequest {
                    requested: vec![Capability::ClientContext, Capability::send_event("m.room.message")],
                    approved: vec![
                        Capability::MatrixContext,
                        Capability::ClientContext,
                        Capability::send_event("m.room.message")
                    ]
                }
            }
        );
    }
}
