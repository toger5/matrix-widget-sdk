//! Types for the Matrix widget API as proposed in
//! [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) (the `m.widget`
//! state event) and [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)
//! (the JSON request/response "action" protocol spoken over `postMessage`).
//!
//! This crate is deliberately free of any I/O or state. It only knows how to:
//!
//! * (de)serialize the generic wire envelope ([`WireMessage`]),
//! * map an envelope to a typed action ([`Action`] and its leaves [`WidgetRequest`],
//!   [`WidgetResponse`], [`HostRequest`], [`HostResponse`]); each action has its own module under
//!   [`actions`], grouped by the source that initiates it,
//! * parse and match capability strings ([`Capability`]).
//!
//! Everything is plain data so it can be shared with other languages through UniFFI
//! (enable the `uniffi` feature) and compiled to WebAssembly.

pub mod actions;
mod capabilities;
mod error;
mod json;
mod matrix;
mod wire;

pub use actions::host::notify_capabilities::NotifyCapabilitiesRequest;
pub use actions::host::update_state::UpdateStateRequest;
pub use actions::host::{HostRequest, HostResponse};
pub use actions::widget::client_context::ClientContextResponse;
pub use actions::widget::matrix_context::MatrixContextResponse;
pub use actions::widget::read_events::{ReadEventsRequest, ReadEventsResponse};
pub use actions::widget::request_capabilities::RequestCapabilitiesRequest;
pub use actions::widget::send_event::{SendEventRequest, SendEventResponse};
pub use actions::widget::{WidgetRequest, WidgetResponse};
pub use actions::Action;
pub use capabilities::{Capability, CapabilitySet};
pub use error::ActionError;
pub use json::JsonValue;
pub use matrix::{MatrixEvent, StateKeySelector};
pub use wire::{MessageKind, Source, WidgetError, WireMessage, API_VERSION_V1};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
