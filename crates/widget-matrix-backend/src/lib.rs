//! The interface between the widget host driver and an actual Matrix client.
//!
//! The driver (`widget-host-driver`) never talks to a homeserver itself. Everything that touches
//! Matrix goes through [`MatrixBackend`], an async trait a host implements once per Matrix SDK
//! (matrix-rust-sdk, matrix-js-sdk through the UniFFI/wasm bindings, a Kotlin/Swift SDK, ...).
//!
//! The trait is shaped after the `MatrixBackend` of
//! [matrix-rust-rtc](https://github.com/element-hq/matrix-rust-rtc) (same method names and
//! parameter order wherever both need the same thing, see `docs/parity.md`), so one adapter per
//! SDK can serve both. It has a *send/read* half (the driver asks the backend to send or read)
//! and a *subscribe* half: [`MatrixBackend::subscribe_room`] registers a [`RoomSink`] that the
//! backend feeds with new timeline events and with the current room state until the returned
//! [`Subscription`] is cancelled. The driver subscribes itself whenever the widget's capabilities
//! change, so a host does not push events anywhere; it only implements the subscription.
//!
//! One backend instance is bound to **one room** (the room the widget lives in). Every method
//! still takes the `room_id`, like matrix-rust-rtc's; the driver always passes
//! [`MatrixBackend::room_id`] and an implementation may reject anything else.
//!
//! [`InMemoryBackend`] is a complete in-process implementation for tests and prototypes.

mod error;
mod in_memory;

use std::sync::Arc;

pub use error::BackendError;
pub use in_memory::{DelayedEvent, InMemoryBackend};
pub use widget_actions::{JsonValue, MatrixEvent, RelationDirection, StateKeySelector};

/// One page of a relations read ([`MatrixBackend::relations`]).
#[derive(Debug, Clone, PartialEq, Default)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RelationsChunk {
    pub chunk: Vec<MatrixEvent>,
    pub next_batch: Option<String>,
    pub prev_batch: Option<String>,
}

/// What a subscriber wants delivered for a room, by event type.
///
/// Timeline delivery matches on the event type alone, so a state event type listed here is
/// delivered as it appears in the timeline as well. State delivery is per type: the complete
/// current set of state events of that type, on subscribe and after every change.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RoomSubjects {
    /// State event types whose current set is delivered on subscribe and after every change.
    pub state_event_types: Vec<String>,
    /// Event types to forward as they arrive in the room's timeline.
    pub timeline_event_types: Vec<String>,
}

impl RoomSubjects {
    pub fn is_empty(&self) -> bool {
        self.timeline_event_types.is_empty() && self.state_event_types.is_empty()
    }
}

/// Where a backend delivers what a subscription asked for. Implemented by the driver.
///
/// Every method returns at once and may be called from any thread, including synchronously from
/// inside [`MatrixBackend::subscribe_room`].
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub trait RoomSink: Send + Sync {
    /// New events of a subscribed timeline type, oldest first. Each event is delivered once.
    fn on_timeline_events(&self, events: Vec<MatrixEvent>);

    /// The **complete current set** of state events of `event_type` (one per state key). The
    /// first call per type is the set at subscription time; later calls follow every change.
    /// An empty vector means there is no such state.
    fn on_state_events(&self, event_type: String, events: Vec<MatrixEvent>);
}

/// A live subscription. The driver ends it with [`cancel`](Subscription::cancel); cancelling
/// twice is a no-op and nothing is delivered afterwards.
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
pub trait Subscription: Send + Sync {
    fn cancel(&self);
}

/// Matrix operations the widget host driver needs, scoped to **one room**.
///
/// Capability checks have already happened in the driver by the time a method here is called, so
/// implementations only perform the operation. Every method is required (UniFFI traits have no
/// default bodies); an operation a client cannot offer returns
/// [`BackendError::not_implemented`].
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
#[async_trait::async_trait]
pub trait MatrixBackend: Send + Sync {
    // ---- Identity ----

    /// The id of the room this backend is bound to.
    fn room_id(&self) -> String;

    /// The account the client is logged in as.
    fn own_user_id(&self) -> String;

    /// The device the client is logged in as.
    fn own_device_id(&self) -> String;

    /// The user's display name, or the user id when there is none.
    fn display_name(&self) -> String;

    /// The user's `mxc://` avatar, or an empty string when there is none.
    fn avatar_url(&self) -> String;

    /// The client-server API base URL of the homeserver, e.g. `https://matrix.example.org`.
    fn base_url(&self) -> String;

    // ---- Send half ----

    /// Send a plain room event (message-like, not state). In an encrypted room the client
    /// encrypts it like any other message. Returns the event id the homeserver assigned.
    async fn send_room_event(
        &self,
        room_id: String,
        event_type: String,
        content: JsonValue,
    ) -> Result<String, BackendError>;

    /// Send a state event. Returns the event id the homeserver assigned.
    async fn send_state_event(
        &self,
        room_id: String,
        event_type: String,
        state_key: String,
        content: JsonValue,
    ) -> Result<String, BackendError>;

    /// Send a sticky event (MSC4354): `duration_ms` is how long the homeserver keeps it in the
    /// room's sticky map; pass it through verbatim. Returns the event id.
    async fn send_sticky_event(
        &self,
        room_id: String,
        event_type: String,
        content: JsonValue,
        duration_ms: u64,
    ) -> Result<String, BackendError>;

    /// Schedule an event (MSC4140): with `state_key` a state event, otherwise message-like, sent
    /// `delay_ms` from now. Returns the **delay id**, the handle for
    /// [`restart_delayed_event`](Self::restart_delayed_event) & co., not an event id.
    async fn send_delayed_event(
        &self,
        room_id: String,
        event_type: String,
        state_key: Option<String>,
        content: JsonValue,
        delay_ms: u64,
    ) -> Result<String, BackendError>;

    /// Schedule a sticky event: [`send_delayed_event`](Self::send_delayed_event) and
    /// [`send_sticky_event`](Self::send_sticky_event) combined. Returns the delay id.
    async fn send_delayed_sticky_event(
        &self,
        room_id: String,
        event_type: String,
        content: JsonValue,
        delay_ms: u64,
        duration_ms: u64,
    ) -> Result<String, BackendError>;

    /// MSC4140 `restart`: reset the timer of a delayed event to its original delay from now.
    async fn restart_delayed_event(&self, room_id: String, delay_id: String) -> Result<(), BackendError>;

    /// MSC4140 `cancel`: drop a delayed event.
    async fn cancel_delayed_event(&self, room_id: String, delay_id: String) -> Result<(), BackendError>;

    /// MSC4140 `send`: send a delayed event right now.
    async fn send_delayed_event_now(&self, room_id: String, delay_id: String) -> Result<(), BackendError>;

    // ---- Read half ----

    /// Read the most recent timeline events of `event_type`, newest last, at most `limit`.
    /// `msgtype` narrows `m.room.message` events to one `msgtype`; `since` is an opaque
    /// pagination token from an earlier read (MSC2876), which an implementation may ignore.
    async fn read_room_events(
        &self,
        room_id: String,
        event_type: String,
        msgtype: Option<String>,
        limit: u32,
        since: Option<String>,
    ) -> Result<Vec<MatrixEvent>, BackendError>;

    /// Read current state events of `event_type` matching `state_key`.
    async fn read_room_state(
        &self,
        room_id: String,
        event_type: String,
        state_key: StateKeySelector,
    ) -> Result<Vec<MatrixEvent>, BackendError>;

    /// `GET /rooms/{room_id}/relations/{event_id}[/{rel_type}[/{event_type}]]` (MSC3869), decrypted.
    /// `limit`, `from`, `to` and `direction` are the endpoint's query parameters; absent means
    /// the homeserver's default. Same as matrix-rust-rtc's `relations` plus the pagination.
    #[allow(clippy::too_many_arguments)]
    async fn relations(
        &self,
        room_id: String,
        event_id: String,
        rel_type: Option<String>,
        event_type: Option<String>,
        from: Option<String>,
        to: Option<String>,
        limit: Option<u32>,
        direction: Option<RelationDirection>,
    ) -> Result<RelationsChunk, BackendError>;

    /// Deliver `subjects` of `room_id` to `sink` until the returned subscription is cancelled.
    ///
    /// Synchronous on purpose: register the client's listeners and return the handle; deliver
    /// from the client's own event loop. The current set of every requested state type is
    /// delivered right away (calling the sink from inside this method is fine) or as soon as it
    /// is known; timeline events only from now on.
    fn subscribe_room(
        &self,
        room_id: String,
        subjects: RoomSubjects,
        sink: Arc<dyn RoomSink>,
    ) -> Result<Arc<dyn Subscription>, BackendError>;
}

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
