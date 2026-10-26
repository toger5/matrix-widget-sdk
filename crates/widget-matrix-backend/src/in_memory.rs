use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};

use crate::{
    BackendError, JsonValue, MatrixBackend, MatrixEvent, MediaConfig, MediaFile, OpenIdToken, RelationDirection,
    RelationsChunk, RoomAccountData, RoomSink, RoomSubjects, StateKeySelector, Subscription, ToDeviceDelivery,
    ToDeviceEvent, ToDeviceMessage, ToDeviceSink, TurnServer, TurnServerSink, UserDirectorySearchResult,
    UserDirectoryUser,
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
    to_device_subscriptions: Mutex<Vec<Arc<InMemoryToDeviceSubscription>>>,
    turn_subscriptions: Mutex<Vec<Arc<InMemoryTurnSubscription>>>,
}

/// One live `subscribe_turn_servers` call.
#[derive(Debug)]
struct InMemoryTurnSubscription {
    sink: Arc<dyn TurnServerSink>,
    active: AtomicBool,
}

impl std::fmt::Debug for dyn TurnServerSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("TurnServerSink")
    }
}

impl Subscription for InMemoryTurnSubscription {
    fn cancel(&self) {
        self.active.store(false, Ordering::SeqCst);
    }
}

/// A delayed leave handed to a (pretend) LiveKit service (MSC4533), for inspection.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DelegatedDelayedLeave {
    pub url: String,
    pub room_id: String,
    pub slot_id: String,
    pub member_id: String,
    pub delay_id: String,
}

/// A file in [`InMemoryBackend`]'s media repository, for inspection.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct StoredMedia {
    pub content_uri: String,
    pub file: MediaFile,
}

/// A to-device message "sent" through [`InMemoryBackend`], for inspection.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SentToDeviceMessage {
    pub user_id: String,
    pub device_id: String,
    pub event_type: String,
    pub content: JsonValue,
    pub encrypted: bool,
}

#[derive(Debug, Default)]
struct Inner {
    timeline: Vec<MatrixEvent>,
    /// (event type, state key) -> event
    state: BTreeMap<(String, String), MatrixEvent>,
    /// Scheduled (MSC4140) events by delay id. Nothing fires them automatically; a test fires
    /// them through `send_delayed_event_now` or [`InMemoryBackend::fire_delayed_event`].
    delayed: BTreeMap<String, DelayedEvent>,
    /// To-device messages sent so far, oldest first.
    to_device_sent: Vec<SentToDeviceMessage>,
    /// The current TURN credentials, if the test host set any.
    turn_server: Option<TurnServer>,
    /// What `rtc_transports` answers.
    rtc_transports: JsonValue,
    /// Room account data by event type.
    room_account_data: BTreeMap<String, JsonValue>,
    /// Delayed leaves delegated through `rtc_livekit_delegate_delayed_leave`.
    delegated_leaves: Vec<DelegatedDelayedLeave>,
    /// Uploaded media by `mxc://` URI.
    media: BTreeMap<String, MediaFile>,
    /// When set, every send fails with this error. Handy for tests.
    fail_sends: Option<BackendError>,
}

/// A scheduled event as [`InMemoryBackend`] keeps it (MSC4140).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct DelayedEvent {
    pub delay_id: String,
    pub delay_ms: u64,
    /// `Some` for a sticky event.
    pub sticky_duration_ms: Option<u64>,
    /// How often the timer was restarted. For tests.
    pub restarts: u32,
    /// The event as it will be stored when it fires (`event_id` / `origin_server_ts` are
    /// assigned then).
    pub event: MatrixEvent,
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

/// One live `subscribe_to_device` call.
#[derive(Debug)]
struct InMemoryToDeviceSubscription {
    event_types: Vec<String>,
    sink: Arc<dyn ToDeviceSink>,
    active: AtomicBool,
}

impl std::fmt::Debug for dyn ToDeviceSink {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("ToDeviceSink")
    }
}

impl Subscription for InMemoryToDeviceSubscription {
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
            to_device_subscriptions: Default::default(),
            turn_subscriptions: Default::default(),
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

    /// Scheduled events that have not fired or been cancelled, oldest first.
    pub fn delayed_events(&self) -> Vec<DelayedEvent> {
        self.inner().delayed.values().cloned().collect()
    }

    /// To-device messages sent through this backend, oldest first (one entry per recipient).
    pub fn to_device_sent(&self) -> Vec<SentToDeviceMessage> {
        self.inner().to_device_sent.clone()
    }

    /// Set the TURN credentials and push them to every widget watching them.
    pub fn set_turn_server(&self, server: TurnServer) {
        self.inner().turn_server = Some(server.clone());
        let subs = {
            let mut subs = self.turn_subscriptions.lock().unwrap_or_else(|p| p.into_inner());
            subs.retain(|s| s.active.load(Ordering::SeqCst));
            subs.clone()
        };
        for sub in subs {
            sub.sink.on_turn_server(server.clone());
        }
    }

    /// What `get_rtc_transports` answers (a JSON array). Default: `[]`.
    pub fn set_rtc_transports(&self, transports: JsonValue) {
        self.inner().rtc_transports = transports;
    }

    /// Set room account data of `event_type` (the room is this backend's).
    pub fn set_room_account_data(&self, event_type: String, content: JsonValue) {
        self.inner().room_account_data.insert(event_type, content);
    }

    /// Put a file into the media repository under `content_uri`, as if someone had uploaded it
    /// (e.g. demo files a test host offers for `download_file`). Replaces an existing entry.
    pub fn add_media(&self, content_uri: String, file: MediaFile) {
        self.inner().media.insert(content_uri, file);
    }

    /// Every file in the media repository, seeded or uploaded, ordered by `mxc://` URI.
    pub fn media(&self) -> Vec<StoredMedia> {
        let inner = self.inner();
        inner
            .media
            .iter()
            .map(|(content_uri, file)| StoredMedia { content_uri: content_uri.clone(), file: file.clone() })
            .collect()
    }

    /// Delayed leaves handed over through `rtc_livekit_delegate_delayed_leave`, oldest first.
    pub fn delegated_delayed_leaves(&self) -> Vec<DelegatedDelayedLeave> {
        self.inner().delegated_leaves.clone()
    }

    /// Deliver a to-device message as if it had arrived from sync: every live to-device
    /// subscription for its type gets it.
    pub fn inject_to_device(&self, message: ToDeviceEvent) {
        let subs = {
            let mut subs = self.to_device_subscriptions.lock().unwrap_or_else(|p| p.into_inner());
            subs.retain(|s| s.active.load(Ordering::SeqCst));
            subs.clone()
        };
        for sub in subs {
            if sub.event_types.contains(&message.event_type) {
                sub.sink.on_to_device_message(message.clone());
            }
        }
    }

    /// Fire a scheduled event as if its delay had elapsed. The host side of
    /// `send_delayed_event_now`; for test hosts that want a "time passes" button.
    pub fn fire_delayed_event(&self, delay_id: String) -> Result<MatrixEvent, BackendError> {
        let delayed = self
            .inner()
            .delayed
            .remove(&delay_id)
            .ok_or_else(|| BackendError::not_found(format!("no delayed event {delay_id}")))?;
        let event = self.next_event(delayed.event.event_type, delayed.event.state_key, delayed.event.content);
        self.send(event.clone())?;
        Ok(event)
    }

    /// Forget all stored events. Room and user id stay. Subscribers learn that every state type
    /// they follow is now empty.
    pub fn clear(&self) {
        {
            let mut inner = self.inner();
            inner.timeline.clear();
            inner.state.clear();
            inner.delayed.clear();
            inner.to_device_sent.clear();
            inner.room_account_data.clear();
            inner.delegated_leaves.clear();
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
        self.set_fail_sends(message.map(BackendError::new));
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

    /// The host part of the base URL, used as the server name of tokens and media.
    fn server_name(&self) -> String {
        self.base_url.split("://").nth(1).unwrap_or(&self.base_url).trim_end_matches('/').to_owned()
    }

    fn inner(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    /// Every method takes a `room_id` for symmetry with multi-room backends; this one serves
    /// exactly one room.
    fn check_room(&self, room_id: &str) -> Result<(), BackendError> {
        if room_id != self.room_id {
            return Err(BackendError::not_found(format!("this backend serves {}, not {room_id}", self.room_id)));
        }
        Ok(())
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

    fn schedule(
        &self,
        event_type: String,
        state_key: Option<String>,
        content: JsonValue,
        delay_ms: u64,
        sticky_duration_ms: Option<u64>,
    ) -> Result<String, BackendError> {
        let mut inner = self.inner();
        if let Some(err) = &inner.fail_sends {
            return Err(err.clone());
        }
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let delay_id = format!("delay{n}");
        let event = MatrixEvent {
            event_type,
            sender: self.user_id.clone(),
            event_id: String::new(),
            room_id: self.room_id.clone(),
            origin_server_ts: 0,
            state_key,
            content,
            unsigned: None,
        };
        inner.delayed.insert(
            delay_id.clone(),
            DelayedEvent { delay_id: delay_id.clone(), delay_ms, sticky_duration_ms, restarts: 0, event },
        );
        Ok(delay_id)
    }

    /// Store and announce `event`; returns its event id.
    fn send(&self, event: MatrixEvent) -> Result<String, BackendError> {
        {
            let mut inner = self.inner();
            if let Some(err) = &inner.fail_sends {
                return Err(err.clone());
            }
            inner.store(event.clone());
        }
        self.notify(&event);
        Ok(event.event_id)
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

    fn own_user_id(&self) -> String {
        self.user_id.clone()
    }

    fn own_device_id(&self) -> String {
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

    async fn send_room_event(
        &self,
        room_id: String,
        event_type: String,
        content: JsonValue,
    ) -> Result<String, BackendError> {
        self.check_room(&room_id)?;
        self.send(self.next_event(event_type, None, content))
    }

    async fn send_state_event(
        &self,
        room_id: String,
        event_type: String,
        state_key: String,
        content: JsonValue,
    ) -> Result<String, BackendError> {
        self.check_room(&room_id)?;
        self.send(self.next_event(event_type, Some(state_key), content))
    }

    /// Stored like a plain timeline event: this store does not model sticky expiry.
    async fn send_sticky_event(
        &self,
        room_id: String,
        event_type: String,
        content: JsonValue,
        _duration_ms: u64,
    ) -> Result<String, BackendError> {
        self.check_room(&room_id)?;
        self.send(self.next_event(event_type, None, content))
    }

    async fn send_delayed_event(
        &self,
        room_id: String,
        event_type: String,
        state_key: Option<String>,
        content: JsonValue,
        delay_ms: u64,
    ) -> Result<String, BackendError> {
        self.check_room(&room_id)?;
        self.schedule(event_type, state_key, content, delay_ms, None)
    }

    async fn send_delayed_sticky_event(
        &self,
        room_id: String,
        event_type: String,
        content: JsonValue,
        delay_ms: u64,
        duration_ms: u64,
    ) -> Result<String, BackendError> {
        self.check_room(&room_id)?;
        self.schedule(event_type, None, content, delay_ms, Some(duration_ms))
    }

    async fn restart_delayed_event(&self, room_id: String, delay_id: String) -> Result<(), BackendError> {
        self.check_room(&room_id)?;
        let mut inner = self.inner();
        let delayed = inner
            .delayed
            .get_mut(&delay_id)
            .ok_or_else(|| BackendError::not_found(format!("no delayed event {delay_id}")))?;
        delayed.restarts += 1;
        Ok(())
    }

    async fn cancel_delayed_event(&self, room_id: String, delay_id: String) -> Result<(), BackendError> {
        self.check_room(&room_id)?;
        self.inner()
            .delayed
            .remove(&delay_id)
            .map(|_| ())
            .ok_or_else(|| BackendError::not_found(format!("no delayed event {delay_id}")))
    }

    async fn send_delayed_event_now(&self, room_id: String, delay_id: String) -> Result<(), BackendError> {
        self.check_room(&room_id)?;
        self.fire_delayed_event(delay_id).map(|_| ())
    }

    /// `since` is ignored: this store has no pagination tokens.
    async fn read_room_events(
        &self,
        room_id: String,
        event_type: String,
        msgtype: Option<String>,
        limit: u32,
        _since: Option<String>,
    ) -> Result<Vec<MatrixEvent>, BackendError> {
        self.check_room(&room_id)?;
        let inner = self.inner();
        let mut events: Vec<MatrixEvent> = inner
            .timeline
            .iter()
            .rev()
            .filter(|e| e.event_type == event_type && e.state_key.is_none())
            .filter(|e| msgtype.as_deref().is_none_or(|m| e.content.get("msgtype").and_then(|v| v.as_str()) == Some(m)))
            .take(limit as usize)
            .cloned()
            .collect();
        events.reverse();
        Ok(events)
    }

    async fn read_room_state(
        &self,
        room_id: String,
        event_type: String,
        state_key: StateKeySelector,
    ) -> Result<Vec<MatrixEvent>, BackendError> {
        self.check_room(&room_id)?;
        let inner = self.inner();
        Ok(inner
            .state
            .iter()
            .filter(|((t, k), _)| *t == event_type && state_key.matches(k))
            .map(|(_, e)| e.clone())
            .collect())
    }

    /// Relations are found through `content["m.relates_to"]`; `from` / `to` are ignored and no
    /// batch tokens are produced (the whole result is one page).
    async fn relations(
        &self,
        room_id: String,
        event_id: String,
        rel_type: Option<String>,
        event_type: Option<String>,
        _from: Option<String>,
        _to: Option<String>,
        limit: Option<u32>,
        direction: Option<RelationDirection>,
    ) -> Result<RelationsChunk, BackendError> {
        self.check_room(&room_id)?;
        let inner = self.inner();
        let relates = |e: &MatrixEvent| -> bool {
            let Some(rel) = e.content.get("m.relates_to") else { return false };
            rel.get("event_id").and_then(|v| v.as_str()) == Some(event_id.as_str())
                && rel_type.as_deref().is_none_or(|t| rel.get("rel_type").and_then(|v| v.as_str()) == Some(t))
                && event_type.as_deref().is_none_or(|t| e.event_type == t)
        };
        let mut chunk: Vec<MatrixEvent> = inner.timeline.iter().filter(|e| relates(e)).cloned().collect();
        // The endpoint defaults to newest first.
        if direction != Some(RelationDirection::Forward) {
            chunk.reverse();
        }
        if let Some(limit) = limit {
            chunk.truncate(limit as usize);
        }
        Ok(RelationsChunk { chunk, next_batch: None, prev_batch: None })
    }

    /// A placeholder token: `access_token` counts up per call, `matrix_server_name` is the
    /// host of the base URL.
    async fn openid_token(&self) -> Result<OpenIdToken, BackendError> {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let server = self.server_name();
        Ok(OpenIdToken {
            access_token: format!("openid-token-{n}"),
            token_type: "Bearer".into(),
            matrix_server_name: server,
            expires_in: 3600,
        })
    }

    async fn rtc_transports(&self) -> Result<JsonValue, BackendError> {
        Ok(self.inner().rtc_transports.clone())
    }

    /// Searches the members known from `m.room.member` state (user id and `displayname`),
    /// case-insensitively.
    async fn search_user_directory(
        &self,
        search_term: String,
        limit: Option<u32>,
    ) -> Result<UserDirectorySearchResult, BackendError> {
        let term = search_term.to_lowercase();
        let inner = self.inner();
        let mut results: Vec<UserDirectoryUser> = inner
            .state
            .iter()
            .filter(|((t, _), _)| t == "m.room.member")
            .map(|((_, user_id), e)| UserDirectoryUser {
                user_id: user_id.clone(),
                display_name: e.content.get("displayname").and_then(|v| v.as_str()).map(str::to_owned),
                avatar_url: e.content.get("avatar_url").and_then(|v| v.as_str()).map(str::to_owned),
            })
            .filter(|u| {
                u.user_id.to_lowercase().contains(&term)
                    || u.display_name.as_deref().is_some_and(|d| d.to_lowercase().contains(&term))
            })
            .collect();
        let limited = limit.is_some_and(|l| results.len() > l as usize);
        if let Some(limit) = limit {
            results.truncate(limit as usize);
        }
        Ok(UserDirectorySearchResult { limited, results })
    }

    async fn media_config(&self) -> Result<MediaConfig, BackendError> {
        Ok(MediaConfig { upload_size: Some(50 * 1024 * 1024) })
    }

    /// Stores the file under `mxc://<host of base_url>/media-<n>`. Fails like a send when
    /// `fail_sends` is set.
    async fn upload_media(&self, file: MediaFile) -> Result<String, BackendError> {
        let n = self.counter.fetch_add(1, Ordering::Relaxed);
        let mut inner = self.inner();
        if let Some(err) = &inner.fail_sends {
            return Err(err.clone());
        }
        let content_uri = format!("mxc://{}/media-{n}", self.server_name());
        inner.media.insert(content_uri.clone(), file);
        Ok(content_uri)
    }

    async fn download_media(&self, content_uri: String) -> Result<MediaFile, BackendError> {
        self.inner()
            .media
            .get(&content_uri)
            .cloned()
            .ok_or_else(|| BackendError::not_found(format!("no media {content_uri}")))
    }

    async fn read_room_account_data(
        &self,
        room_id: String,
        event_type: String,
    ) -> Result<Vec<RoomAccountData>, BackendError> {
        self.check_room(&room_id)?;
        Ok(self
            .inner()
            .room_account_data
            .get(&event_type)
            .map(|content| vec![RoomAccountData { event_type, room_id, content: content.clone() }])
            .unwrap_or_default())
    }

    /// A placeholder JWT naming the slot and member.
    async fn rtc_livekit_get_token(
        &self,
        _server_name: String,
        _url: String,
        room_id: String,
        slot_id: String,
        member_id: String,
    ) -> Result<String, BackendError> {
        self.check_room(&room_id)?;
        Ok(format!("livekit-jwt-{slot_id}-{member_id}"))
    }

    async fn rtc_livekit_delegate_delayed_leave(
        &self,
        url: String,
        room_id: String,
        slot_id: String,
        member_id: String,
        delay_id: String,
    ) -> Result<(), BackendError> {
        self.check_room(&room_id)?;
        let mut inner = self.inner();
        if !inner.delayed.contains_key(&delay_id) {
            return Err(BackendError::not_found(format!("no delayed event {delay_id}")));
        }
        inner.delegated_leaves.push(DelegatedDelayedLeave { url, room_id, slot_id, member_id, delay_id });
        Ok(())
    }

    async fn send_to_device_message(
        &self,
        encrypted: bool,
        event_type: String,
        messages: Vec<ToDeviceMessage>,
    ) -> Result<Vec<ToDeviceDelivery>, BackendError> {
        let mut inner = self.inner();
        if let Some(err) = &inner.fail_sends {
            return Err(err.clone());
        }
        let mut deliveries = Vec::with_capacity(messages.len());
        for m in messages {
            inner.to_device_sent.push(SentToDeviceMessage {
                user_id: m.user_id.clone(),
                device_id: m.device_id.clone(),
                event_type: event_type.clone(),
                content: m.content,
                encrypted,
            });
            deliveries.push(ToDeviceDelivery { user_id: m.user_id, device_id: m.device_id, error: None });
        }
        Ok(deliveries)
    }

    fn subscribe_to_device(
        &self,
        event_types: Vec<String>,
        sink: Arc<dyn ToDeviceSink>,
    ) -> Result<Arc<dyn Subscription>, BackendError> {
        let subscription = Arc::new(InMemoryToDeviceSubscription { event_types, sink, active: AtomicBool::new(true) });
        self.to_device_subscriptions.lock().unwrap_or_else(|p| p.into_inner()).push(subscription.clone());
        Ok(subscription)
    }

    fn subscribe_turn_servers(&self, sink: Arc<dyn TurnServerSink>) -> Result<Arc<dyn Subscription>, BackendError> {
        let subscription = Arc::new(InMemoryTurnSubscription { sink, active: AtomicBool::new(true) });
        self.turn_subscriptions.lock().unwrap_or_else(|p| p.into_inner()).push(subscription.clone());
        let current = self.inner().turn_server.clone();
        if let Some(server) = current {
            subscription.sink.on_turn_server(server);
        }
        Ok(subscription)
    }

    fn subscribe_room(
        &self,
        room_id: String,
        subjects: RoomSubjects,
        sink: Arc<dyn RoomSink>,
    ) -> Result<Arc<dyn Subscription>, BackendError> {
        self.check_room(&room_id)?;
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

    const ROOM: &str = "!r:x";

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
            room_id: ROOM.into(),
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

    fn room() -> String {
        ROOM.into()
    }

    #[test]
    fn send_and_read() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new(room(), "@me:x".into());
            let id = b.send_room_event(room(), "m.room.message".into(), json!({"body": "1"}).into()).await.unwrap();
            assert_eq!(id, "$event1");
            b.send_room_event(room(), "m.room.message".into(), json!({"body": "2", "msgtype": "m.text"}).into())
                .await
                .unwrap();
            b.send_room_event(room(), "m.other".into(), json!({}).into()).await.unwrap();
            b.send_state_event(room(), "m.room.topic".into(), "".into(), json!({"topic": "a"}).into()).await.unwrap();
            b.send_state_event(room(), "m.room.topic".into(), "".into(), json!({"topic": "b"}).into()).await.unwrap();
            b.send_state_event(room(), "m.room.member".into(), "@me:x".into(), json!({}).into()).await.unwrap();

            let msgs = b.read_room_events(room(), "m.room.message".into(), None, 1, None).await.unwrap();
            assert_eq!(msgs.len(), 1);
            assert_eq!(msgs[0].content["body"], "2");
            assert_eq!(b.read_room_events(room(), "m.room.message".into(), None, 10, None).await.unwrap().len(), 2);
            // msgtype narrows
            let text =
                b.read_room_events(room(), "m.room.message".into(), Some("m.text".into()), 10, None).await.unwrap();
            assert_eq!(text.len(), 1);
            assert!(b
                .read_room_events(room(), "m.room.message".into(), Some("m.image".into()), 10, None)
                .await
                .unwrap()
                .is_empty());

            let topic = b.read_room_state(room(), "m.room.topic".into(), StateKeySelector::Any).await.unwrap();
            assert_eq!(topic.len(), 1);
            assert_eq!(topic[0].content["topic"], "b");
            assert!(b
                .read_room_state(room(), "m.room.member".into(), StateKeySelector::key("@x:x"))
                .await
                .unwrap()
                .is_empty());
            assert_eq!(
                b.read_room_state(room(), "m.room.member".into(), StateKeySelector::key("@me:x")).await.unwrap().len(),
                1
            );

            b.set_fail_sends(Some(BackendError::forbidden("no")));
            let err = b.send_room_event(room(), "m.x".into(), json!({}).into()).await.unwrap_err();
            assert_eq!(err.errcode(), Some("M_FORBIDDEN"));
            assert_eq!(err.status(), Some(403));
            assert_eq!(err.reason(), "no");

            // Any other room is refused everywhere.
            let other = "!other:x".to_string();
            assert!(b.send_room_event(other.clone(), "m.x".into(), json!({}).into()).await.is_err());
            assert!(b.read_room_events(other, "m.x".into(), None, 1, None).await.is_err());
        });
    }

    #[test]
    fn relations() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new(room(), "@me:x".into());
            b.inject(event("m.room.message", None, "root"));
            let react = |key: &str, body: &str| MatrixEvent {
                content: json!({"m.relates_to": {"rel_type": "m.annotation", "event_id": "$root", "key": key}}).into(),
                ..event("m.reaction", None, body)
            };
            b.inject(react("👍", "r1"));
            b.inject(MatrixEvent {
                content: json!({"m.relates_to": {"rel_type": "m.thread", "event_id": "$root"}, "body": "t"}).into(),
                ..event("m.room.message", None, "t1")
            });
            b.inject(react("👎", "r2"));
            b.inject(event("m.reaction", None, "unrelated"));

            let all = b.relations(room(), "$root".into(), None, None, None, None, None, None).await.unwrap();
            assert_eq!(all.chunk.iter().map(|e| e.event_id.as_str()).collect::<Vec<_>>(), ["$r2", "$t1", "$r1"]);
            assert!(all.next_batch.is_none());
            let forward = b
                .relations(room(), "$root".into(), None, None, None, None, Some(2), Some(RelationDirection::Forward))
                .await
                .unwrap();
            assert_eq!(forward.chunk.iter().map(|e| e.event_id.as_str()).collect::<Vec<_>>(), ["$r1", "$t1"]);
            let annotations = b
                .relations(
                    room(),
                    "$root".into(),
                    Some("m.annotation".into()),
                    Some("m.reaction".into()),
                    None,
                    None,
                    None,
                    None,
                )
                .await
                .unwrap();
            assert_eq!(annotations.chunk.len(), 2);
            assert!(b
                .relations(
                    room(),
                    "$root".into(),
                    Some("m.thread".into()),
                    Some("m.reaction".into()),
                    None,
                    None,
                    None,
                    None
                )
                .await
                .unwrap()
                .chunk
                .is_empty());
        });
    }

    #[test]
    fn to_device() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new(room(), "@me:x".into());
            #[derive(Default)]
            struct Sink(Mutex<Vec<ToDeviceEvent>>);
            impl ToDeviceSink for Sink {
                fn on_to_device_message(&self, message: ToDeviceEvent) {
                    self.0.lock().unwrap().push(message);
                }
            }
            let sink = Arc::new(Sink::default());
            let sub = b.subscribe_to_device(vec!["org.example.ping".into()], sink.clone()).unwrap();
            let ping = ToDeviceEvent {
                event_type: "org.example.ping".into(),
                sender: "@other:x".into(),
                content: json!({"n": 1}).into(),
                encrypted: true,
            };
            b.inject_to_device(ping.clone());
            b.inject_to_device(ToDeviceEvent { event_type: "org.example.other".into(), ..ping.clone() });
            assert_eq!(sink.0.lock().unwrap().as_slice(), std::slice::from_ref(&ping));
            sub.cancel();
            b.inject_to_device(ping);
            assert_eq!(sink.0.lock().unwrap().len(), 1);

            let deliveries = b
                .send_to_device_message(
                    false,
                    "org.example.ping".into(),
                    vec![
                        ToDeviceMessage {
                            user_id: "@a:x".into(),
                            device_id: "A".into(),
                            content: json!({"a": 1}).into(),
                        },
                        ToDeviceMessage {
                            user_id: "@b:x".into(),
                            device_id: "*".into(),
                            content: json!({"b": 1}).into(),
                        },
                    ],
                )
                .await
                .unwrap();
            assert_eq!(deliveries.len(), 2);
            assert!(deliveries.iter().all(|d| d.error.is_none()));
            let sent = b.to_device_sent();
            assert_eq!(sent.len(), 2);
            assert_eq!(sent[1].device_id, "*");
            assert_eq!(sent[1].content["b"], 1);
            assert!(!sent[0].encrypted);
        });
    }

    #[test]
    fn read_style_extras() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new(room(), "@me:x".into());
            // TURN: current credentials on subscribe, then pushes, until cancelled.
            #[derive(Default)]
            struct Sink(Mutex<Vec<TurnServer>>);
            impl TurnServerSink for Sink {
                fn on_turn_server(&self, server: TurnServer) {
                    self.0.lock().unwrap().push(server);
                }
            }
            let turn = |u: &str| TurnServer { uris: vec!["turn:x".into()], username: u.into(), password: "p".into() };
            let sink = Arc::new(Sink::default());
            let sub = b.subscribe_turn_servers(sink.clone()).unwrap();
            assert!(sink.0.lock().unwrap().is_empty());
            b.set_turn_server(turn("a"));
            let sink2 = Arc::new(Sink::default());
            let _sub2 = b.subscribe_turn_servers(sink2.clone()).unwrap();
            assert_eq!(sink2.0.lock().unwrap().len(), 1);
            sub.cancel();
            b.set_turn_server(turn("b"));
            assert_eq!(sink.0.lock().unwrap().len(), 1);
            assert_eq!(sink2.0.lock().unwrap().len(), 2);

            assert_eq!(b.rtc_transports().await.unwrap(), JsonValue::from(json!(null)));
            b.set_rtc_transports(json!([{"type": "livekit"}]).into());
            assert_eq!(b.rtc_transports().await.unwrap()[0]["type"], "livekit");

            b.inject(MatrixEvent {
                content: json!({"membership": "join", "displayname": "Alice"}).into(),
                ..event("m.room.member", Some("@alice:x"), "m1")
            });
            b.inject(event("m.room.member", Some("@bob:x"), "m2"));
            let hits = b.search_user_directory("ALI".into(), None).await.unwrap();
            assert_eq!(hits.results.len(), 1);
            assert_eq!(hits.results[0].display_name.as_deref(), Some("Alice"));
            let hits = b.search_user_directory(":x".into(), Some(1)).await.unwrap();
            assert!(hits.limited);
            assert_eq!(hits.results.len(), 1);

            assert!(b.media_config().await.unwrap().upload_size.is_some());
            let file = MediaFile { data: b"hi".to_vec(), mimetype: Some("text/plain".into()) };
            let uri = b.upload_media(file.clone()).await.unwrap();
            assert!(uri.starts_with("mxc://"));
            assert_eq!(b.download_media(uri).await.unwrap(), file);
            assert!(b.download_media("mxc://x/missing".into()).await.is_err());
            b.add_media("mxc://x/demo".into(), file.clone());
            assert_eq!(b.download_media("mxc://x/demo".into()).await.unwrap(), file);
            assert_eq!(b.media().len(), 2);

            assert!(b.read_room_account_data(room(), "m.tag".into()).await.unwrap().is_empty());
            b.set_room_account_data("m.tag".into(), json!({"tags": {"u.work": {}}}).into());
            let data = b.read_room_account_data(room(), "m.tag".into()).await.unwrap();
            assert_eq!(data.len(), 1);
            assert_eq!(data[0].room_id, ROOM);

            let jwt = b.rtc_livekit_get_token("x".into(), "u".into(), room(), "s".into(), "m".into()).await.unwrap();
            assert_eq!(jwt, "livekit-jwt-s-m");
            assert!(b
                .rtc_livekit_delegate_delayed_leave("u".into(), room(), "s".into(), "m".into(), "nope".into())
                .await
                .is_err());
            let d = b.send_delayed_event(room(), "m.rtc.member".into(), None, json!({}).into(), 1).await.unwrap();
            b.rtc_livekit_delegate_delayed_leave("u".into(), room(), "s".into(), "m".into(), d.clone()).await.unwrap();
            assert_eq!(b.delegated_delayed_leaves()[0].delay_id, d);
        });
    }

    #[test]
    fn delayed_events() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new(room(), "@me:x".into());
            let sink = Arc::new(RecordingSink::default());
            let _sub =
                b.subscribe_room(room(), subjects(&["m.room.message"], &["m.room.topic"]), sink.clone()).unwrap();
            sink.drain();

            let d1 = b
                .send_delayed_event(room(), "m.room.message".into(), None, json!({"body": "later"}).into(), 5000)
                .await
                .unwrap();
            let d2 = b
                .send_delayed_event(room(), "m.room.topic".into(), Some("".into()), json!({"topic": "t"}).into(), 1)
                .await
                .unwrap();
            let d3 = b.send_delayed_sticky_event(room(), "m.rtc.member".into(), json!({}).into(), 1, 2).await.unwrap();
            assert_eq!(b.delayed_events().len(), 3);
            assert_eq!(b.delayed_events()[2].sticky_duration_ms, Some(2));
            // Nothing happened yet.
            assert!(b.timeline().is_empty());
            assert!(sink.drain().is_empty());

            b.restart_delayed_event(room(), d1.clone()).await.unwrap();
            assert_eq!(b.delayed_events()[0].restarts, 1);
            b.cancel_delayed_event(room(), d3.clone()).await.unwrap();
            assert!(b.cancel_delayed_event(room(), d3).await.is_err());

            // Firing stores and announces like a normal send.
            b.send_delayed_event_now(room(), d1.clone()).await.unwrap();
            assert_eq!(b.timeline().len(), 1);
            assert_eq!(b.timeline()[0].content["body"], "later");
            assert_eq!(sink.drain().len(), 1);
            assert!(b.restart_delayed_event(room(), d1).await.is_err());

            let fired = b.fire_delayed_event(d2).unwrap();
            assert_eq!(fired.state_key.as_deref(), Some(""));
            assert_eq!(b.state().len(), 1);
            assert!(b.delayed_events().is_empty());

            let id = b.send_sticky_event(room(), "m.rtc.member".into(), json!({}).into(), 100).await.unwrap();
            assert_eq!(b.timeline().last().unwrap().event_id, id);
        });
    }

    #[test]
    fn subscription_emits_initial_sets_then_changes() {
        futures::executor::block_on(async {
            let b = InMemoryBackend::new(room(), "@me:x".into());
            b.inject(event("m.room.topic", Some(""), "old topic"));
            let sink = Arc::new(RecordingSink::default());
            let _sub = b
                .subscribe_room(room(), subjects(&["m.room.message"], &["m.room.topic", "m.room.name"]), sink.clone())
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
            b.send_state_event(room(), "m.room.topic".into(), "".into(), json!({"body": "new topic"}).into())
                .await
                .unwrap();
            let calls = sink.drain();
            assert_eq!(calls.len(), 1);
            assert_eq!(calls[0].0, "state");
            assert_eq!(calls[0].2.len(), 1);
            assert_eq!(calls[0].2[0].content["body"], "new topic");

            // A type that is both a timeline and a state subject gets both.
            let sink2 = Arc::new(RecordingSink::default());
            let _sub2 = b.subscribe_room(room(), subjects(&["m.room.name"], &["m.room.name"]), sink2.clone()).unwrap();
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
        let b = InMemoryBackend::new(room(), "@me:x".into());
        let sink = Arc::new(RecordingSink::default());
        let sub = b.subscribe_room(room(), subjects(&["m.room.message"], &[]), sink.clone()).unwrap();
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
        let b = InMemoryBackend::new(room(), "@me:x".into());
        b.inject(event("m.room.topic", Some(""), "t"));
        let sink = Arc::new(RecordingSink::default());
        let _sub = b.subscribe_room(room(), subjects(&["m.room.message"], &["m.room.topic"]), sink.clone()).unwrap();
        sink.drain();
        b.clear();
        assert_eq!(sink.drain(), vec![("state", "m.room.topic".into(), vec![])]);
        assert!(b.timeline().is_empty());
        assert!(b.state().is_empty());
    }

    #[test]
    fn other_room_is_not_found() {
        let b = InMemoryBackend::new(room(), "@me:x".into());
        let sink = Arc::new(RecordingSink::default());
        let err = b.subscribe_room("!other:x".into(), RoomSubjects::default(), sink).err().unwrap();
        assert_eq!(err.errcode(), Some("M_NOT_FOUND"));
    }
}
