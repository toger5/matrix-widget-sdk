//! The interface between the widget host driver and an actual Matrix client.
//!
//! The driver (`widget-host-driver`) never talks to a homeserver itself. Everything that touches
//! Matrix goes through [`MatrixBackend`], an async trait a host implements once per Matrix SDK
//! (matrix-rust-sdk, matrix-js-sdk through the UniFFI/wasm bindings, a Kotlin/Swift SDK, ...).
//!
//! The trait has a *send/read* half (the driver asks the backend to send or read) and a
//! *subscribe* half: [`MatrixBackend::subscribe_room`] registers a [`RoomSink`] that the backend
//! feeds with new timeline events and with the current room state until the returned
//! [`Subscription`] is cancelled. The driver subscribes itself whenever the widget's capabilities
//! change, so a host does not push events anywhere; it only implements the subscription.
//!
//! [`InMemoryBackend`] is a complete in-process implementation for tests and prototypes.

mod error;
mod in_memory;

use std::sync::Arc;

pub use error::BackendError;
pub use in_memory::InMemoryBackend;
pub use widget_actions::{JsonValue, MatrixEvent, StateKeySelector};

/// Result of sending an event.
#[derive(Debug, Clone, PartialEq, Eq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SentEvent {
    pub room_id: String,
    pub event_id: String,
}

/// What a subscriber wants delivered for a room, by event type.
///
/// Timeline delivery matches on the event type alone, so a state event type listed here is
/// delivered as it appears in the timeline as well. State delivery is per type: the complete
/// current set of state events of that type, on subscribe and after every change.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RoomSubjects {
    /// Event types to forward as they arrive in the room's timeline.
    pub timeline_event_types: Vec<String>,
    /// State event types whose current set is delivered on subscribe and after every change.
    pub state_event_types: Vec<String>,
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
/// One backend instance belongs to exactly one room (the room the widget lives in). Capability
/// checks have already happened in the driver by the time a method here is called, so
/// implementations only perform the operation.
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
#[async_trait::async_trait]
pub trait MatrixBackend: Send + Sync {
    /// The id of the room this backend is bound to.
    fn room_id(&self) -> String;

    /// The Matrix user id of the logged in user.
    fn user_id(&self) -> String;

    /// The device id of the logged in session.
    fn device_id(&self) -> String;

    /// The user's display name, or the user id when there is none.
    fn display_name(&self) -> String;

    /// The user's `mxc://` avatar, or an empty string when there is none.
    fn avatar_url(&self) -> String;

    /// The client-server API base URL of the homeserver, e.g. `https://matrix.example.org`.
    fn base_url(&self) -> String;

    /// Send a timeline (non-state) event.
    async fn send_event(&self, event_type: String, content: JsonValue) -> Result<SentEvent, BackendError>;

    /// Send a state event.
    async fn send_state_event(
        &self,
        event_type: String,
        state_key: String,
        content: JsonValue,
    ) -> Result<SentEvent, BackendError>;

    /// Read the most recent timeline events of `event_type`, newest last, at most `limit`.
    async fn read_events(&self, event_type: String, limit: u32) -> Result<Vec<MatrixEvent>, BackendError>;

    /// Read current state events of `event_type` matching `state_key`.
    async fn read_state(
        &self,
        event_type: String,
        state_key: StateKeySelector,
    ) -> Result<Vec<MatrixEvent>, BackendError>;

    /// Deliver `subjects` of `room_id` to `sink` until the returned subscription is cancelled.
    ///
    /// Synchronous on purpose: register the client's listeners and return the handle; deliver
    /// from the client's own event loop. The current set of every requested state type is
    /// delivered right away (calling the sink from inside this method is fine) or as soon as it
    /// is known; timeline events only from now on. `room_id` always equals
    /// [`room_id`](Self::room_id) here, it is passed for symmetry with multi-room backends.
    fn subscribe_room(
        &self,
        room_id: String,
        subjects: RoomSubjects,
        sink: Arc<dyn RoomSink>,
    ) -> Result<Arc<dyn Subscription>, BackendError>;
}

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
