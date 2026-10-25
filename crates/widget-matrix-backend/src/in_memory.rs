use std::collections::BTreeMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::{BackendError, JsonValue, MatrixBackend, MatrixEvent, SentEvent, StateKeySelector};

/// A [`MatrixBackend`] backed by plain vectors. Intended for tests and prototypes.
///
/// Events "sent" through it are appended to an in-memory timeline (and state map) and can be
/// inspected with [`InMemoryBackend::timeline`] / [`InMemoryBackend::state`]. Use
/// [`InMemoryBackend::inject`] to simulate events arriving from sync.
#[derive(Debug)]
pub struct InMemoryBackend {
    room_id: String,
    user_id: String,
    counter: AtomicU64,
    inner: Mutex<Inner>,
}

#[derive(Debug, Default)]
struct Inner {
    timeline: Vec<MatrixEvent>,
    /// (event type, state key) -> event
    state: BTreeMap<(String, String), MatrixEvent>,
    /// When set, every send fails with this error. Handy for tests.
    fail_sends: Option<BackendError>,
}

impl InMemoryBackend {
    pub fn new(room_id: impl Into<String>, user_id: impl Into<String>) -> Self {
        Self { room_id: room_id.into(), user_id: user_id.into(), counter: AtomicU64::new(1), inner: Default::default() }
    }

    /// All timeline events sent or injected so far, oldest first.
    pub fn timeline(&self) -> Vec<MatrixEvent> {
        self.inner.lock().unwrap().timeline.clone()
    }

    /// All current state events.
    pub fn state(&self) -> Vec<MatrixEvent> {
        self.inner.lock().unwrap().state.values().cloned().collect()
    }

    /// Forget all stored events. Room and user id stay.
    pub fn clear(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.timeline.clear();
        inner.state.clear();
    }

    /// Make every subsequent send fail with `error` (or succeed again with `None`).
    pub fn set_fail_sends(&self, error: Option<BackendError>) {
        self.inner.lock().unwrap().fail_sends = error;
    }

    /// Store an event as if it had arrived from sync. Returns the stored event.
    pub fn inject(&self, event: MatrixEvent) -> MatrixEvent {
        let mut inner = self.inner.lock().unwrap();
        inner.store(event.clone());
        event
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
        let mut inner = self.inner.lock().unwrap();
        if let Some(err) = &inner.fail_sends {
            return Err(err.clone());
        }
        let sent = SentEvent { room_id: event.room_id.clone(), event_id: event.event_id.clone() };
        inner.store(event);
        Ok(sent)
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

#[async_trait::async_trait]
impl MatrixBackend for InMemoryBackend {
    fn room_id(&self) -> String {
        self.room_id.clone()
    }

    fn user_id(&self) -> String {
        self.user_id.clone()
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
        let inner = self.inner.lock().unwrap();
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
        let inner = self.inner.lock().unwrap();
        Ok(inner
            .state
            .iter()
            .filter(|((t, k), _)| *t == event_type && state_key.matches(k))
            .map(|(_, e)| e.clone())
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn send_and_read() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new("!r:x", "@me:x");
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
}
