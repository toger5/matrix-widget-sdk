//! Types for the Matrix widget API as proposed in
//! [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/pull/4411) (the `m.widget`
//! state event) and [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/pull/4412)
//! (the JSON request/response "action" protocol spoken over `postMessage`).
//!
//! This crate is deliberately free of any I/O or state. It only knows how to:
//!
//! * (de)serialize the generic wire envelope ([`WireMessage`]),
//! * map an envelope to a typed action ([`FromWidgetRequest`], [`ToWidgetRequest`], ...); the
//!   body types of each action live in their own module under [`actions`],
//! * parse and match capability strings ([`Capability`]),
//! * describe the widget state event ([`WidgetStateEventContent`]).
//!
//! Everything is plain data so it can be shared with other languages through UniFFI
//! (enable the `uniffi` feature) and compiled to WebAssembly.

pub mod actions;
mod capabilities;
mod error;
mod from_widget;
mod json;
mod matrix;
mod to_widget;
mod wire;

pub use actions::notify_capabilities::NotifyCapabilitiesRequest;
pub use actions::read_events::{ReadEventsRequest, ReadEventsResponse, StateKeySelector};
pub use actions::request_capabilities::RequestCapabilitiesRequest;
pub use actions::send_event::{SendEventRequest, SendEventResponse};
pub use actions::update_state::UpdateStateRequest;
pub use capabilities::{Capability, CapabilitySet};
pub use error::ActionError;
pub use from_widget::{FromWidgetRequest, FromWidgetResponse};
pub use json::JsonValue;
pub use matrix::{
    MatrixEvent, WidgetStateEventContent, WIDGET_EVENT_TYPE, WIDGET_EVENT_TYPE_LEGACY, WIDGET_EVENT_TYPE_UNSTABLE,
};
pub use to_widget::{ToWidgetRequest, ToWidgetResponse};
pub use wire::{MessageKind, Source, WidgetError, WireMessage, API_VERSION_V1};

#[cfg(feature = "uniffi")]
mod ffi;

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
