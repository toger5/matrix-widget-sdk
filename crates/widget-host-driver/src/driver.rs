use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use widget_actions::{
    Action, ActionError, Capability, CapabilitySet, HostRequest, MatrixEvent, MessageKind, NotifyCapabilitiesRequest,
    ReadEventsResponse, SendEventResponse, UpdateStateRequest, WidgetError, WidgetRequest, WidgetResponse, WireMessage,
    API_VERSION_V1,
};
use widget_matrix_backend::MatrixBackend;

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
}

/// A read-only copy of the driver's state.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DriverSnapshot {
    /// `content_loaded` was received.
    pub content_loaded: bool,
    /// Capabilities currently granted to the widget.
    pub approved: Vec<Capability>,
    /// Capabilities requested by the widget that are still waiting for
    /// [`WidgetHostDriver::approve_capabilities`].
    pub pending_requested: Vec<Capability>,
}

#[derive(Debug, Default)]
struct State {
    content_loaded: bool,
    approved: Vec<Capability>,
    pending_requested: Option<Vec<Capability>>,
    /// Requests the host sent to the widget that have not been acknowledged yet.
    awaiting_ack: HashMap<String, HostRequest>,
}

/// Host side state machine for one widget instance. See the crate documentation.
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct WidgetHostDriver {
    backend: Arc<dyn MatrixBackend>,
    platform: Arc<dyn WidgetHostPlatform>,
    state: Mutex<State>,
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl WidgetHostDriver {
    /// Create a driver for one widget. `backend` must be bound to the room the widget lives in.
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn new(backend: Arc<dyn MatrixBackend>, platform: Arc<dyn WidgetHostPlatform>) -> Arc<Self> {
        Arc::new(Self { backend, platform, state: Mutex::new(State::default()) })
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

    /// Complete a capability negotiation started by
    /// [`WidgetHostPlatform::on_capabilities_requested`]. Only capabilities that were actually
    /// requested are granted; the rest of `approved` is ignored. Sends `notify_capabilities`.
    ///
    /// Does nothing if there is no pending request.
    pub fn approve_capabilities(&self, approved: Vec<Capability>) {
        let outgoing = {
            let mut state = self.lock();
            let Some(requested) = state.pending_requested.take() else {
                return;
            };
            let granted: Vec<Capability> = requested.iter().filter(|c| approved.contains(c)).cloned().collect();
            for cap in &granted {
                if !state.approved.contains(cap) {
                    state.approved.push(cap.clone());
                }
            }
            HostRequest::NotifyCapabilities { request: NotifyCapabilitiesRequest { requested, approved: granted } }
        };
        self.send_request(outgoing);
    }

    /// Hand an event that arrived from sync for the widget's room to the driver. It is forwarded
    /// with a `send_event` action if the widget has a matching `receive.*` capability.
    /// Returns whether it was forwarded.
    pub fn on_matrix_event(&self, event: MatrixEvent) -> bool {
        let allowed = self.lock().approved.allows_receive(&event.event_type, event.state_key.as_deref());
        if allowed {
            self.send_request(HostRequest::SendEvent { event });
        }
        allowed
    }

    /// Push (a subset of) the current room state. Only events the widget may receive are
    /// included; nothing is sent when that leaves no events. Returns the number of events sent.
    pub fn on_state_update(&self, state: Vec<MatrixEvent>) -> u32 {
        let filtered: Vec<MatrixEvent> = {
            let s = self.lock();
            state
                .into_iter()
                .filter(|e| e.is_state() && s.approved.allows_receive(&e.event_type, e.state_key.as_deref()))
                .collect()
        };
        let count = filtered.len() as u32;
        if count > 0 {
            self.send_request(HostRequest::UpdateState { request: UpdateStateRequest { state: filtered } });
        }
        count
    }

    /// Current state of the driver.
    pub fn snapshot(&self) -> DriverSnapshot {
        let s = self.lock();
        DriverSnapshot {
            content_loaded: s.content_loaded,
            approved: s.approved.clone(),
            pending_requested: s.pending_requested.clone().unwrap_or_default(),
        }
    }
}

impl WidgetHostDriver {
    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
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
                self.lock().pending_requested = Some(requested.clone());
                self.send(&msg.ack());
                self.platform.on_capabilities_requested(requested);
                return Ok(());
            }
            WidgetRequest::SendEvent { request } => {
                let allowed = self.lock().approved.allows_send(&request.event_type, request.state_key.as_deref());
                if !allowed {
                    let needed = match &request.state_key {
                        Some(k) => Capability::send_state_event(&request.event_type, Some(k.as_str())),
                        None => Capability::send_event(&request.event_type),
                    };
                    error(format!("Not allowed to send this event (missing capability {needed})"))
                } else {
                    let result = match request.state_key {
                        Some(state_key) => {
                            self.backend.send_state_event(request.event_type, state_key, request.content).await
                        }
                        None => self.backend.send_event(request.event_type, request.content).await,
                    };
                    match result {
                        Ok(sent) => Ok(WidgetResponse::SendEvent {
                            response: SendEventResponse { room_id: sent.room_id, event_id: sent.event_id },
                        }),
                        Err(e) => error(format!("Failed to send event: {e}")),
                    }
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
                    let result = match request.state_key {
                        Some(selector) => self.backend.read_state(request.event_type, selector).await,
                        None => self.backend.read_events(request.event_type, limit).await,
                    };
                    match result {
                        Ok(events) => {
                            let approved = self.lock().approved.clone();
                            let mut events: Vec<MatrixEvent> = events
                                .into_iter()
                                .filter(|e| approved.allows_receive(&e.event_type, e.state_key.as_deref()))
                                .collect();
                            events.truncate(limit as usize);
                            Ok(WidgetResponse::ReadEvents { response: ReadEventsResponse { events } })
                        }
                        Err(e) => error(format!("Failed to read events: {e}")),
                    }
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

    fn handle_response(&self, msg: WireMessage) -> Result<(), DriverError> {
        let pending = self.lock().awaiting_ack.remove(&msg.request_id);
        if pending.is_none() {
            return Err(DriverError::UnexpectedResponse { request_id: msg.request_id });
        }
        Ok(())
    }
}

fn error<T>(message: String) -> Result<T, WidgetError> {
    Err(WidgetError::new(message))
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicBool, Ordering};

    use serde_json::{json, Value};
    use widget_actions::{ReadEventsRequest, RequestCapabilitiesRequest, SendEventRequest, Source, StateKeySelector};
    use widget_matrix_backend::InMemoryBackend;

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
    }

    fn setup() -> (Arc<WidgetHostDriver>, Arc<InMemoryBackend>, Arc<RecordingPlatform>) {
        let backend = Arc::new(InMemoryBackend::new("!room:x", "@me:x"));
        let platform = Arc::new(RecordingPlatform::default());
        let driver = WidgetHostDriver::new(backend.clone(), platform.clone());
        (driver, backend, platform)
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
            request: SendEventRequest {
                event_type: "m.room.message".into(),
                state_key: None,
                content: json!({"body": "hi"}).into(),
            },
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
                assert_eq!(backend.timeline()[0].event_id, response.event_id);
            }
            other => panic!("{other:?}"),
        }
        assert_eq!(backend.timeline()[0].content["body"], "hi");

        // state event with a timeline-only capability -> denied
        block(feed(
            &driver,
            WidgetRequest::SendEvent {
                request: SendEventRequest {
                    event_type: "m.room.message".into(),
                    state_key: Some("".into()),
                    content: json!({}).into(),
                },
            },
            "s3",
        ))
        .unwrap();
        assert!(platform.drain()[0].error().is_some());

        // backend failure is relayed as an error response
        backend.set_fail_sends(Some(widget_matrix_backend::BackendError::forbidden("power level")));
        block(feed(
            &driver,
            WidgetRequest::SendEvent {
                request: SendEventRequest {
                    event_type: "m.room.message".into(),
                    state_key: None,
                    content: json!({}).into(),
                },
            },
            "s4",
        ))
        .unwrap();
        assert!(platform.drain()[0].error().unwrap().message.contains("power level"));
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

    #[test]
    fn incoming_events_are_forwarded_only_with_capability() {
        let (driver, _, platform) = setup();
        assert!(!driver.on_matrix_event(event("m.room.message", None, json!({}))));
        assert!(platform.drain().is_empty());

        grant(&driver, &platform, vec![Capability::receive_event("m.room.message")]);
        assert!(driver.on_matrix_event(event("m.room.message", None, json!({"body": "x"}))));
        assert!(!driver.on_matrix_event(event("m.reaction", None, json!({}))));
        let sent = platform.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].source, Source::Host);
        assert_eq!(sent[0].action, "send_event");
        assert!(sent[0].is_v1());
        assert_eq!(sent[0].request_body()["content"]["body"], "x");

        // Unrelated state update is dropped entirely, matching ones forwarded.
        assert_eq!(driver.on_state_update(vec![event("m.room.topic", Some(""), json!({}))]), 0);
        assert!(platform.drain().is_empty());
        grant(&driver, &platform, vec![Capability::receive_state_event("m.room.topic", None::<&str>)]);
        assert_eq!(
            driver.on_state_update(vec![
                event("m.room.topic", Some(""), json!({})),
                event("m.room.name", Some(""), json!({})),
                event("m.room.message", None, json!({})),
            ]),
            1
        );
        let sent = platform.drain();
        assert_eq!(sent[0].action, "update_state");
        assert_eq!(sent[0].request_body()["state"].as_array().unwrap().len(), 1);
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
}
