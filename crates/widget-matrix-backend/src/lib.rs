//! The interface between the widget host driver and an actual Matrix client.
//!
//! The driver (`widget-host-driver`) never talks to a homeserver itself. Everything that touches
//! Matrix goes through [`MatrixBackend`], an async trait a host implements once per Matrix SDK
//! (matrix-rust-sdk, matrix-js-sdk via wasm, a Kotlin/Swift SDK via UniFFI, ...).
//!
//! The trait is *pull* only: the driver asks the backend to send or read. Events arriving from
//! sync are *pushed* into the driver by the host (see `WidgetHostDriver::on_matrix_event`), so
//! the backend does not need any subscription machinery.
//!
//! [`InMemoryBackend`] is a complete in-process implementation for tests and prototypes.

mod error;
mod in_memory;

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
}

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
