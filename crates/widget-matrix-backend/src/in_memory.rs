use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::{
    BackendError, JsonValue, MatrixBackend, MatrixEvent, RoomSink, RoomSubjects, SentEvent, StateKeySelector,
    Subscription,
};

/// A [`MatrixBackend`] backed by plain vectors. Intended for tests and prototypes.
///
/// Events "sent" through it are appended to an in-memory timeline (and state map) and can be
/// inspected with [`InMemoryBackend::timeline`] / [`InMemoryBackend::state`]. Use
/// [`InMemoryBackend::inject`] to simulate events arriving from sync. Both paths notify live
/// subscriptions like a real client would, so the widget sees its own sends echoed too.
#[derive(Debug)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Object))]
pub struct InMemoryBackend {
    room_id: String,
    user_id: String,
    device_id: String,
    display_name: String,
    avatar_url: String,
    base_url: String,
    counter: AtomicU64,
    inner: Mutex<Inner>,
    subscriptions: Mutex<Vec<Arc<InMemorySubscription>>>,
}

#[derive(Debug, Default)]
struct Inner {
    timeline: Vec<MatrixEvent>,
    /// (event type, state key) -> event
    state: BTreeMap<(String, String), MatrixEvent>,
    /// When set, every send fails with this error. Handy for tests.
    fail_sends: Option<BackendError>,
}

/// One live `subscribe_room` call. Cancelling flips `active`; the backend drops cancelled
/// entries the next time it looks at the list.
#[derive(Debug)]
struct InMemorySubscription {
    subjects: RoomSubjects,
    sink: Arc<dyn RoomSink>,
    active: AtomicBool,
}

impl std::fmt::Debug for dyn RoomSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("RoomSink")
    }
}

impl Subscription for InMemorySubscription {
    fn cancel(&self) {
        self.active.store(false, Ordering::SeqCst);
    }
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
impl InMemoryBackend {
    /// A room `room_id` seen by `user_id`, with placeholder device id, display name (the user
    /// id), avatar (none) and base URL.
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn new(room_id: String, user_id: String) -> Arc<Self> {
        Self::with_context(
            room_id,
            user_id.clone(),
            "WIDGETTEST".into(),
            user_id,
            String::new(),
            "https://matrix.example.org".into(),
        )
    }

    /// Like [`new`](Self::new) but with everything `matrix_context` reports spelled out.
    #[cfg_attr(feature = "uniffi", uniffi::constructor)]
    pub fn with_context(
        room_id: String,
        user_id: String,
        device_id: String,
        display_name: String,
        avatar_url: String,
        base_url: String,
    ) -> Arc<Self> {
        Arc::new(Self {
            room_id,
            user_id,
            device_id,
            display_name,
            avatar_url,
            base_url,
            counter: AtomicU64::new(1),
            inner: Default::default(),
            subscriptions: Default::default(),
        })
    }

    /// All timeline events sent or injected so far, oldest first.
    pub fn timeline(&self) -> Vec<MatrixEvent> {
        self.inner().timeline.clone()
    }

    /// All current state events.
    pub fn state(&self) -> Vec<MatrixEvent> {
        self.inner().state.values().cloned().collect()
    }

    /// Forget all stored events. Room and user id stay. Subscribers learn that every state type
    /// they follow is now empty.
    pub fn clear(&self) {
        {
            let mut inner = self.inner();
            inner.timeline.clear();
            inner.state.clear();
        }
        for sub in self.live_subscriptions() {
            for event_type in &sub.subjects.state_event_types {
                sub.sink.on_state_events(event_type.clone(), Vec::new());
            }
        }
    }

    /// Make every subsequent send from the widget fail with `message`, or succeed again when
    /// `None`. Foreign-friendly form of [`set_fail_sends`](Self::set_fail_sends).
    pub fn fail_sends(&self, message: Option<String>) {
        self.set_fail_sends(message.map(BackendError::other));
    }

    /// Store an event as if it had arrived from sync and notify subscribers. Returns the stored
    /// event.
    pub fn inject(&self, event: MatrixEvent) -> MatrixEvent {
        self.inner().store(event.clone());
        self.notify(&event);
        event
    }

    /// This backend as the trait object `WidgetHostDriver::new` takes. Foreign code needs the
    /// explicit upcast; Rust can pass the `Arc<InMemoryBackend>` directly.
    pub fn as_backend(self: Arc<Self>) -> Arc<dyn MatrixBackend> {
        self
    }
}

impl InMemoryBackend {
    /// Make every subsequent send fail with `error` (or succeed again with `None`).
    pub fn set_fail_sends(&self, error: Option<BackendError>) {
        self.inner().fail_sends = error;
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Snapshot of the subscriptions that are still active; cancelled ones are dropped here.
    fn live_subscriptions(&self) -> Vec<Arc<InMemorySubscription>> {
        let mut subs = self.subscriptions.lock().unwrap_or_else(|p| p.into_inner());
        subs.retain(|s| s.active.load(Ordering::SeqCst));
        subs.clone()
    }

    fn state_of_type(&self, event_type: &str) -> Vec<MatrixEvent> {
        self.inner().state.iter().filter(|((t, _), _)| t == event_type).map(|(_, e)| e.clone()).collect()
    }

    /// Tell every live subscription about a stored event. Called with no lock held: the sink is
    /// the driver, which may call straight back into this backend.
    fn notify(&self, event: &MatrixEvent) {
        for sub in self.live_subscriptions() {
            if sub.subjects.timeline_event_types.contains(&event.event_type) {
                sub.sink.on_timeline_events(vec![event.clone()]);
            }
            if event.is_state() && sub.subjects.state_event_types.contains(&event.event_type) {
                sub.sink.on_state_events(event.event_type.clone(), self.state_of_type(&event.event_type));
            }
        }
    }

    fn next_event(&self, event_type: String, state_key: Option<String>, content: JsonValue) -> MatrixEvent {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        MatrixEvent {
            event_type,
            sender: self.user_id.clone(),
            event_id: format!("$event{n}"),
            room_id: self.room_id.clone(),
            origin_server_ts: n,
            state_key,
            content,
            unsigned: None,
        }
    }

    fn send(&self, event: MatrixEvent) -> Result<SentEvent, BackendError> {
        {
            let mut inner = self.inner();
            if let Some(err) = &inner.fail_sends {
                return Err(err.clone());
            }
            inner.store(event.clone());
        }
        self.notify(&event);
        Ok(SentEvent { room_id: event.room_id, event_id: event.event_id })
    }
}

impl Inner {
    fn store(&mut self, event: MatrixEvent) {
        if let Some(state_key) = &event.state_key {
            self.state.insert((event.event_type.clone(), state_key.clone()), event.clone());
        }
        self.timeline.push(event);
    }
}

#[cfg_attr(feature = "uniffi", uniffi::export)]
#[async_trait::async_trait]
impl MatrixBackend for InMemoryBackend {
    fn room_id(&self) -> String {
        self.room_id.clone()
    }

    fn user_id(&self) -> String {
        self.user_id.clone()
    }

    fn device_id(&self) -> String {
        self.device_id.clone()
    }

    fn display_name(&self) -> String {
        self.display_name.clone()
    }

    fn avatar_url(&self) -> String {
        self.avatar_url.clone()
    }

    fn base_url(&self) -> String {
        self.base_url.clone()
    }

    async fn send_event(&self, event_type: String, content: JsonValue) -> Result<SentEvent, BackendError> {
        self.send(self.next_event(event_type, None, content))
    }

    async fn send_state_event(
        &self,
        event_type: String,
        state_key: String,
        content: JsonValue,
    ) -> Result<SentEvent, BackendError> {
        self.send(self.next_event(event_type, Some(state_key), content))
    }

    async fn read_events(&self, event_type: String, limit: u32) -> Result<Vec<MatrixEvent>, BackendError> {
        let inner = self.inner();
        let mut events: Vec<MatrixEvent> = inner
            .timeline
            .iter()
            .rev()
            .filter(|e| e.event_type == event_type && e.state_key.is_none())
            .take(limit as usize)
            .cloned()
            .collect();
        events.reverse();
        Ok(events)
    }

    async fn read_state(
        &self,
        event_type: String,
        state_key: StateKeySelector,
    ) -> Result<Vec<MatrixEvent>, BackendError> {
        let inner = self.inner();
        Ok(inner
            .state
            .iter()
            .filter(|((t, k), _)| *t == event_type && state_key.matches(k))
            .map(|(_, e)| e.clone())
            .collect())
    }

    fn subscribe_room(
        &self,
        room_id: String,
        subjects: RoomSubjects,
        sink: Arc<dyn RoomSink>,
    ) -> Result<Arc<dyn Subscription>, BackendError> {
        if room_id != self.room_id {
            return Err(BackendError::not_found(format!("this backend serves {}, not {room_id}", self.room_id)));
        }
        let subscription = Arc::new(InMemorySubscription { subjects, sink, active: AtomicBool::new(true) });
        self.subscriptions.lock().unwrap_or_else(|p| p.into_inner()).push(subscription.clone());
        // Initial sets, delivered with no lock held.
        for event_type in &subscription.subjects.state_event_types {
            subscription.sink.on_state_events(event_type.clone(), self.state_of_type(event_type));
        }
        Ok(subscription)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    /// Records every sink call as `(kind, event type, events)`.
    #[derive(Default)]
    struct RecordingSink {
        calls: Mutex<Vec<(&'static str, String, Vec<MatrixEvent>)>>,
    }

    impl RecordingSink {
        fn drain(&self) -> Vec<(&'static str, String, Vec<MatrixEvent>)> {
            std::mem::take(&mut *self.calls.lock().unwrap())
        }
    }

    impl RoomSink for RecordingSink {
        fn on_timeline_events(&self, events: Vec<MatrixEvent>) {
            self.calls.lock().unwrap().push(("timeline", String::new(), events));
        }
        fn on_state_events(&self, event_type: String, events: Vec<MatrixEvent>) {
            self.calls.lock().unwrap().push(("state", event_type, events));
        }
    }

    fn event(event_type: &str, state_key: Option<&str>, body: &str) -> MatrixEvent {
        MatrixEvent {
            event_type: event_type.into(),
            sender: "@other:x".into(),
            event_id: format!("${body}"),
            room_id: "!r:x".into(),
            origin_server_ts: 7,
            state_key: state_key.map(Into::into),
            content: json!({ "body": body }).into(),
            unsigned: None,
        }
    }

    fn subjects(timeline: &[&str], state: &[&str]) -> RoomSubjects {
        RoomSubjects {
            timeline_event_types: timeline.iter().map(|s| s.to_string()).collect(),
            state_event_types: state.iter().map(|s| s.to_string()).collect(),
        }
    }

    #[test]
    fn send_and_read() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new("!r:x".into(), "@me:x".into());
            let sent = b.send_event("m.room.message".into(), json!({"body": "1"}).into()).await.unwrap();
            assert_eq!(sent.room_id, "!r:x");
            b.send_event("m.room.message".into(), json!({"body": "2"}).into()).await.unwrap();
            b.send_event("m.other".into(), json!({}).into()).await.unwrap();
            b.send_state_event("m.room.topic".into(), "".into(), json!({"topic": "a"}).into()).await.unwrap();
            b.send_state_event("m.room.topic".into(), "".into(), json!({"topic": "b"}).into()).await.unwrap();
            b.send_state_event("m.room.member".into(), "@me:x".into(), json!({}).into()).await.unwrap();

            let msgs = b.read_events("m.room.message".into(), 1).await.unwrap();
            assert_eq!(msgs.len(), 1);
            assert_eq!(msgs[0].content["body"], "2");
            assert_eq!(b.read_events("m.room.message".into(), 10).await.unwrap().len(), 2);

            let topic = b.read_state("m.room.topic".into(), StateKeySelector::Any).await.unwrap();
            assert_eq!(topic.len(), 1);
            assert_eq!(topic[0].content["topic"], "b");
            assert!(b.read_state("m.room.member".into(), StateKeySelector::key("@x:x")).await.unwrap().is_empty());
            assert_eq!(b.read_state("m.room.member".into(), StateKeySelector::key("@me:x")).await.unwrap().len(), 1);

            b.set_fail_sends(Some(BackendError::forbidden("no")));
            assert_eq!(
                b.send_event("m.x".into(), json!({}).into()).await,
                Err(BackendError::Forbidden { message: "no".into() })
            );
        });
    }

    #[test]
    fn subscription_emits_initial_sets_then_changes() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new("!r:x".into(), "@me:x".into());
            b.inject(event("m.room.topic", Some(""), "old topic"));
            let sink = Arc::new(RecordingSink::default());
            let _sub = b
                .subscribe_room(
                    "!r:x".into(),
                    subjects(&["m.room.message"], &["m.room.topic", "m.room.name"]),
                    sink.clone(),
                )
                .unwrap();

            // One call per requested state type, in order, the missing one empty.
            let calls = sink.drain();
            assert_eq!(calls.len(), 2);
            assert_eq!(calls[0].0, "state");
            assert_eq!(calls[0].1, "m.room.topic");
            assert_eq!(calls[0].2[0].content["body"], "old topic");
            assert_eq!(calls[1], ("state", "m.room.name".into(), vec![]));

            // Injected timeline event of a subscribed type: delivered once.
            b.inject(event("m.room.message", None, "hi"));
            let calls = sink.drain();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, "timeline");
            assert_eq!(calls[0].2[0].content["body"], "hi");

            // Unsubscribed type: nothing.
            b.inject(event("m.reaction", None, "x"));
            assert!(sink.drain().is_empty());

            // Own state send: state set of that type (topic is not a timeline subject here).
            b.send_state_event("m.room.topic".into(), "".into(), json!({"body": "new topic"}).into()).await.unwrap();
            let calls = sink.drain();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, "state");
            assert_eq!(calls[0].2.len(), 1);
            assert_eq!(calls[0].2[0].content["body"], "new topic");

            // A type that is both a timeline and a state subject gets both.
            let sink2 = Arc::new(RecordingSink::default());
            let _sub2 =
                b.subscribe_room("!r:x".into(), subjects(&["m.room.name"], &["m.room.name"]), sink2.clone()).unwrap();
            sink2.drain();
            b.inject(event("m.room.name", Some(""), "name"));
            let calls = sink2.drain();
            assert_eq!(calls.iter().map(|c| c.0).collect::<Vec<_>>(), ["timeline", "state"]);
            // The first subscription follows m.room.name as state only: one state call, no timeline.
            let calls = sink.drain();
            assert_eq!(calls.iter().map(|c| c.0).collect::<Vec<_>>(), ["state"]);
        });
    }

    #[test]
    fn cancel_stops_delivery_and_is_idempotent() {
        let b = InMemoryBackend::new("!r:x".into(), "@me:x".into());
        let sink = Arc::new(RecordingSink::default());
        let sub = b.subscribe_room("!r:x".into(), subjects(&["m.room.message"], &[]), sink.clone()).unwrap();
        b.inject(event("m.room.message", None, "1"));
        assert_eq!(sink.drain().len(), 1);
        sub.cancel();
        sub.cancel();
        b.inject(event("m.room.message", None, "2"));
        assert!(sink.drain().is_empty());
        assert!(b.live_subscriptions().is_empty());
    }

    #[test]
    fn clear_emits_empty_sets() {
        let b = InMemoryBackend::new("!r:x".into(), "@me:x".into());
        b.inject(event("m.room.topic", Some(""), "t"));
        let sink = Arc::new(RecordingSink::default());
        let _sub =
            b.subscribe_room("!r:x".into(), subjects(&["m.room.message"], &["m.room.topic"]), sink.clone()).unwrap();
        sink.drain();
        b.clear();
        assert_eq!(sink.drain(), vec![("state", "m.room.topic".into(), vec![])]);
        assert!(b.timeline().is_empty());
        assert!(b.state().is_empty());
    }

    #[test]
    fn other_room_is_not_found() {
        let b = InMemoryBackend::new("!r:x".into(), "@me:x".into());
        let sink = Arc::new(RecordingSink::default());
        assert!(matches!(
            b.subscribe_room("!other:x".into(), RoomSubjects::default(), sink),
            Err(BackendError::NotFound { .. })
        ));
    }
}
