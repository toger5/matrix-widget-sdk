use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::rc::{Rc, Weak};

use futures_channel::oneshot;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use widget_actions::{
    ActionError, Capability, FromWidgetRequest, FromWidgetResponse, MatrixEvent, MessageKind, ReadEventsRequest,
    RequestCapabilitiesRequest, SendEventRequest, SendEventResponse, StateKeySelector, ToWidgetRequest, WidgetError,
    WireMessage, API_VERSION_V1,
};

use crate::WidgetClientError;

/// Callbacks from the [`WidgetClient`] into the widget application / transport.
///
/// Only [`send_to_host`](WidgetDelegate::send_to_host) is mandatory. The others have empty
/// default implementations.
pub trait WidgetDelegate {
    /// Deliver a JSON encoded message to the host, e.g. `window.parent.postMessage(...)`.
    fn send_to_host(&self, json: String);

    /// A room event the host forwarded to this widget (`send_event` from the host).
    fn on_matrix_event(&self, _event: MatrixEvent) {}

    /// The host pushed (part of) the current room state (`update_state`).
    fn on_state_update(&self, _state: Vec<MatrixEvent>) {}

    /// A capability negotiation finished. `approved` is the complete set now held.
    fn on_capabilities_changed(&self, _requested: Vec<Capability>, _approved: Vec<Capability>) {}
}

/// Snapshot of what the client knows about its session with the host.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetState {
    /// `content_loaded` was sent and acknowledged.
    pub content_loaded: bool,
    /// Capabilities of the most recent `request_capabilities` that is still unanswered.
    pub pending_requested: Vec<Capability>,
    /// All capabilities the host has approved so far.
    pub approved: Vec<Capability>,
}

#[derive(Default)]
struct Inner {
    state: WidgetState,
    pending: HashMap<String, oneshot::Sender<WireMessage>>,
}

/// The widget side state machine. See the crate documentation.
pub struct WidgetClient {
    delegate: Rc<dyn WidgetDelegate>,
    inner: Rc<RefCell<Inner>>,
    next_id: Box<dyn Fn() -> String>,
}

impl WidgetClient {
    /// Create a client that generates uuid v4 request ids.
    pub fn new(delegate: Rc<dyn WidgetDelegate>) -> Self {
        Self::with_id_generator(delegate, || uuid::Uuid::new_v4().to_string())
    }

    /// Create a client with a custom request id generator (deterministic ids in tests, ...).
    pub fn with_id_generator(delegate: Rc<dyn WidgetDelegate>, next_id: impl Fn() -> String + 'static) -> Self {
        Self { delegate, inner: Rc::new(RefCell::new(Inner::default())), next_id: Box::new(next_id) }
    }

    pub fn state(&self) -> WidgetState {
        self.inner.borrow().state.clone()
    }

    /// Whether `capability` has been approved by the host.
    pub fn has_capability(&self, capability: &Capability) -> bool {
        self.inner.borrow().state.approved.contains(capability)
    }

    // ---- outgoing ---------------------------------------------------------------------------

    /// Send any widget request. The returned future is `'static` and resolves once the host's
    /// response has been fed into [`handle_message_from_host`](Self::handle_message_from_host).
    /// The request itself is sent synchronously, before this returns.
    pub fn request(
        &self,
        request: FromWidgetRequest,
    ) -> impl Future<Output = Result<FromWidgetResponse, WidgetClientError>> + 'static {
        let id = (self.next_id)();
        let (tx, rx) = oneshot::channel();
        self.inner.borrow_mut().pending.insert(id.clone(), tx);
        self.delegate.send_to_host(request.into_wire(id).to_json());
        async move {
            let msg = rx.await.map_err(|_| WidgetClientError::Cancelled)?;
            Ok(FromWidgetResponse::from_wire(&msg)?.into_result()?)
        }
    }

    /// Tell the host the widget is ready to be shown. Required when the widget state event has
    /// `usesWidgetAPI: true`; the host shows a spinner until this arrives.
    pub fn content_loaded(&self) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        // Only a weak handle: dropping the client must cancel the future, not keep state alive.
        let inner: Weak<RefCell<Inner>> = Rc::downgrade(&self.inner);
        let fut = self.request(FromWidgetRequest::ContentLoaded);
        async move {
            fut.await?;
            if let Some(inner) = inner.upgrade() {
                inner.borrow_mut().state.content_loaded = true;
            }
            Ok(())
        }
    }

    /// Ask the host for capabilities. Resolves when the host *acknowledged* the request; the
    /// actual decision arrives later through [`WidgetDelegate::on_capabilities_changed`] and
    /// is visible in [`state`](Self::state).
    pub fn request_capabilities(
        &self,
        capabilities: Vec<Capability>,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.inner.borrow_mut().state.pending_requested = capabilities.clone();
        let fut = self
            .request(FromWidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities } });
        async move { fut.await.map(|_| ()) }
    }

    /// Send a timeline event. Needs an approved `send.event:<type>` capability.
    pub fn send_event(
        &self,
        event_type: impl Into<String>,
        content: Value,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        self.send_event_request(SendEventRequest {
            event_type: event_type.into(),
            state_key: None,
            content: content.into(),
        })
    }

    /// Send a state event. Needs an approved `send.state_event:<type>[#<state_key>]` capability.
    pub fn send_state_event(
        &self,
        event_type: impl Into<String>,
        state_key: impl Into<String>,
        content: Value,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        self.send_event_request(SendEventRequest {
            event_type: event_type.into(),
            state_key: Some(state_key.into()),
            content: content.into(),
        })
    }

    fn send_event_request(
        &self,
        request: SendEventRequest,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        let fut = self.request(FromWidgetRequest::SendEvent { request });
        async move {
            match fut.await? {
                FromWidgetResponse::SendEvent { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: widget_actions::actions::SEND_EVENT.into() }),
            }
        }
    }

    /// Read recent timeline events of a type. Needs `receive.event:<type>`.
    pub fn read_events(
        &self,
        event_type: impl Into<String>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        self.read_events_request(ReadEventsRequest { event_type: event_type.into(), state_key: None, limit })
    }

    /// Read current state events of a type. Needs `receive.state_event:<type>[#<state_key>]`.
    pub fn read_state(
        &self,
        event_type: impl Into<String>,
        state_key: StateKeySelector,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        self.read_events_request(ReadEventsRequest {
            event_type: event_type.into(),
            state_key: Some(state_key),
            limit: None,
        })
    }

    fn read_events_request(
        &self,
        request: ReadEventsRequest,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        let fut = self.request(FromWidgetRequest::ReadEvents { request });
        async move {
            match fut.await? {
                FromWidgetResponse::ReadEvents { response } => Ok(response.events),
                _ => Err(WidgetClientError::UnexpectedResponse { action: widget_actions::actions::READ_EVENTS.into() }),
            }
        }
    }

    // ---- incoming ---------------------------------------------------------------------------

    /// Feed a JSON message received from the host. Acknowledgements are sent through the
    /// delegate and pending request futures are resolved before this returns.
    pub fn handle_message_from_host(&self, json: &str) -> Result<(), WidgetClientError> {
        self.handle_message(WireMessage::from_json(json)?)
    }

    /// Like [`handle_message_from_host`](Self::handle_message_from_host) for an already parsed envelope.
    pub fn handle_message(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        match msg.version.as_deref() {
            Some(API_VERSION_V1) => {}
            other => return Err(WidgetClientError::UnsupportedVersion { version: other.unwrap_or("").to_owned() }),
        }
        match msg.kind() {
            MessageKind::FromWidgetResponse => self.resolve_response(msg),
            MessageKind::ToWidgetRequest => self.handle_host_request(msg),
            kind => Err(WidgetClientError::WrongDirection { message: format!("widget received a {kind:?} message") }),
        }
    }

    fn resolve_response(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        let sender = self.inner.borrow_mut().pending.remove(&msg.request_id);
        match sender {
            Some(tx) => {
                // The receiver may have been dropped; that is not an error.
                let _ = tx.send(msg);
                Ok(())
            }
            None => Err(WidgetClientError::UnknownRequestId { request_id: msg.request_id }),
        }
    }

    fn handle_host_request(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        let request = match ToWidgetRequest::from_wire(&msg) {
            Ok(r) => r,
            Err(ActionError::InvalidBody { message, .. }) => {
                self.send(msg.error_response_to(WidgetError::new(format!("Invalid request body: {message}"))));
                return Ok(());
            }
            Err(e) => return Err(e.into()),
        };
        match request {
            ToWidgetRequest::NotifyCapabilities { request } => {
                let approved = {
                    let mut inner = self.inner.borrow_mut();
                    inner.state.pending_requested.clear();
                    for cap in request.approved {
                        if !inner.state.approved.contains(&cap) {
                            inner.state.approved.push(cap);
                        }
                    }
                    inner.state.approved.clone()
                };
                self.send(msg.ack());
                self.delegate.on_capabilities_changed(request.requested, approved);
            }
            ToWidgetRequest::SendEvent { event } => {
                self.send(msg.ack());
                self.delegate.on_matrix_event(event);
            }
            ToWidgetRequest::UpdateState { request } => {
                self.send(msg.ack());
                self.delegate.on_state_update(request.state);
            }
            ToWidgetRequest::Unknown { action, .. } => {
                self.send(msg.error_response_to(WidgetError::new(format!("Unknown action `{action}`"))));
            }
        }
        Ok(())
    }

    fn send(&self, msg: WireMessage) {
        self.delegate.send_to_host(msg.to_json());
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use serde_json::json;
    use widget_actions::{NotifyCapabilitiesRequest, Source};

    use super::*;

    #[derive(Default)]
    struct Recorder {
        sent: RefCell<Vec<WireMessage>>,
        events: RefCell<Vec<MatrixEvent>>,
        caps_changed: Cell<u32>,
    }

    impl Recorder {
        fn drain(&self) -> Vec<WireMessage> {
            std::mem::take(&mut *self.sent.borrow_mut())
        }
    }

    impl WidgetDelegate for Recorder {
        fn send_to_host(&self, json: String) {
            self.sent.borrow_mut().push(WireMessage::from_json(&json).unwrap());
        }
        fn on_matrix_event(&self, event: MatrixEvent) {
            self.events.borrow_mut().push(event);
        }
        fn on_capabilities_changed(&self, _requested: Vec<Capability>, _approved: Vec<Capability>) {
            self.caps_changed.set(self.caps_changed.get() + 1);
        }
    }

    fn setup() -> (WidgetClient, Rc<Recorder>) {
        let rec = Rc::new(Recorder::default());
        let counter = Cell::new(0);
        let client = WidgetClient::with_id_generator(rec.clone(), move || {
            counter.set(counter.get() + 1);
            format!("req-{}", counter.get())
        });
        (client, rec)
    }

    fn block<F: Future>(f: F) -> F::Output {
        futures::executor::block_on(f)
    }

    #[test]
    fn content_loaded_roundtrip() {
        let (client, rec) = setup();
        let fut = client.content_loaded();
        let sent = rec.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, "content_loaded");
        assert_eq!(sent[0].request_id, "req-1");
        assert_eq!(sent[0].source, Source::Widget);
        assert!(sent[0].is_v1());
        assert!(!client.state().content_loaded);

        client.handle_message_from_host(&sent[0].ack().to_json()).unwrap();
        block(fut).unwrap();
        assert!(client.state().content_loaded);
    }

    #[test]
    fn send_event_and_error() {
        let (client, rec) = setup();
        let fut = client.send_event("m.room.message", json!({"body": "x"}));
        let sent = rec.drain();
        assert_eq!(sent[0].request_body()["content"]["body"], "x");
        client
            .handle_message_from_host(&sent[0].response_to(json!({"room_id": "!r", "event_id": "$e"})).to_json())
            .unwrap();
        assert_eq!(block(fut).unwrap(), SendEventResponse { room_id: "!r".into(), event_id: "$e".into() });

        let fut = client.send_state_event("m.room.topic", "", json!({"topic": "t"}));
        let sent = rec.drain();
        assert_eq!(sent[0].request_body()["state_key"], "");
        client.handle_message_from_host(&sent[0].error_response_to(WidgetError::new("denied")).to_json()).unwrap();
        assert_eq!(block(fut), Err(WidgetClientError::Host(WidgetError::new("denied"))));

        // Wrong shaped success body
        let fut = client.read_events("m.room.message", Some(3));
        let sent = rec.drain();
        assert_eq!(sent[0].request_body()["limit"], 3);
        client.handle_message_from_host(&sent[0].response_to(json!({"events": "nope"})).to_json()).unwrap();
        assert!(matches!(block(fut), Err(WidgetClientError::Protocol(ActionError::InvalidBody { .. }))));
    }

    #[test]
    fn capabilities_flow() {
        let (client, rec) = setup();
        let caps = vec![Capability::send_event("a"), Capability::receive_event("b")];
        let fut = client.request_capabilities(caps.clone());
        assert_eq!(client.state().pending_requested, caps);
        let sent = rec.drain();
        client.handle_message(sent[0].ack()).unwrap();
        block(fut).unwrap();

        let notify = ToWidgetRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest { requested: caps, approved: vec![Capability::send_event("a")] },
        }
        .into_wire("host-1");
        client.handle_message(notify.clone()).unwrap();
        let sent = rec.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].request_id, "host-1");
        assert_eq!(sent[0].source, Source::Host);
        assert_eq!(sent[0].response_body(), json!({}));
        assert_eq!(rec.caps_changed.get(), 1);
        assert!(client.has_capability(&Capability::send_event("a")));
        assert!(!client.has_capability(&Capability::receive_event("b")));
        assert!(client.state().pending_requested.is_empty());

        // Re-exchange merges.
        let notify2 = ToWidgetRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest {
                requested: vec![Capability::receive_event("b")],
                approved: vec![Capability::receive_event("b")],
            },
        }
        .into_wire("host-2");
        client.handle_message(notify2).unwrap();
        assert_eq!(client.state().approved.len(), 2);
    }

    #[test]
    fn incoming_event_is_acked_and_delivered() {
        let (client, rec) = setup();
        let event = MatrixEvent {
            event_type: "m.room.message".into(),
            sender: "@a:b".into(),
            event_id: "$1".into(),
            room_id: "!r".into(),
            origin_server_ts: 1,
            state_key: None,
            content: json!({"body": "hello"}).into(),
            unsigned: None,
        };
        client.handle_message(ToWidgetRequest::SendEvent { event: event.clone() }.into_wire("h")).unwrap();
        assert_eq!(rec.drain()[0].response_body(), json!({}));
        assert_eq!(rec.events.borrow().as_slice(), &[event]);

        let unknown = WireMessage::request(Source::Host, "org.example.x", "u", json!({}));
        client.handle_message(unknown).unwrap();
        assert!(rec.drain()[0].error().unwrap().message.contains("Unknown action"));
    }

    #[test]
    fn protocol_errors() {
        let (client, rec) = setup();
        let stray = WireMessage::request(Source::Widget, "content_loaded", "zzz", json!({})).ack();
        assert_eq!(client.handle_message(stray), Err(WidgetClientError::UnknownRequestId { request_id: "zzz".into() }));

        let widget_req = FromWidgetRequest::ContentLoaded.into_wire("w");
        assert!(matches!(client.handle_message(widget_req), Err(WidgetClientError::WrongDirection { .. })));

        let mut legacy = FromWidgetRequest::ContentLoaded.into_wire("w").ack();
        legacy.version = None;
        assert!(matches!(client.handle_message(legacy), Err(WidgetClientError::UnsupportedVersion { .. })));
        assert!(rec.drain().is_empty());

        // Dropping the client cancels outstanding futures.
        let fut = client.content_loaded();
        drop(client);
        assert_eq!(block(fut), Err(WidgetClientError::Cancelled));
    }
}
