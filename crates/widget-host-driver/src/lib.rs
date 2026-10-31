//! The host side of the widget API (MSC4412).
//!
//! A [`WidgetHostDriver`] is created per rendered widget. The embedding client ("platform") has
//! exactly two obligations:
//!
//! 1. Pass every `postMessage` received **from** the widget window into
//!    [`WidgetHostDriver::handle_message_from_widget`].
//! 2. Implement [`WidgetHostPlatform::send_to_widget`] to `postMessage` JSON **to** the widget
//!    window (never with a `*` target origin, see MSC4412).
//!
//! The driver takes care of the handshake (`content_loaded`, capability negotiation), checks
//! capabilities, performs Matrix operations through a [`MatrixBackend`] and answers the widget.
//! Events arriving from sync come through the backend too: whenever the widget's `receive.*`
//! capabilities change, the driver subscribes to the backend
//! ([`MatrixBackend::subscribe_room`]) for exactly those event types, pushes the current state as
//! `update_state` and forwards new events as `send_event`.
//!
//! Capability approval is the one asynchronous, user-facing step: the driver acknowledges a
//! `request_capabilities` immediately (as required by MSC4412), asks the platform via
//! [`WidgetHostPlatform::on_capabilities_requested`], and sends `notify_capabilities` once the
//! platform calls [`WidgetHostDriver::approve_capabilities`].
//!
//! [`WidgetStateEventContent`] describes the `m.widget` state event (MSC4411) the client reads
//! from room state to know which widgets to render.
//!
//! With the `uniffi` feature this crate's `cdylib` carries the UniFFI scaffolding of this crate,
//! `widget-matrix-backend` and `widget-actions`; it is what the Kotlin/Swift/Python bindings and
//! the web bindings (`packages/widget-host-bindings`, via uniffi-bindgen-react-native) are
//! generated from.

// See widget-actions: request handlers return the full `WidgetError`.
#![allow(clippy::result_large_err)]

mod driver;
mod error;
mod platform;
mod widget_event;

pub use driver::{DriverSnapshot, WidgetHostDriver};
pub use error::{DriverError, PlatformError};
pub use platform::WidgetHostPlatform;
pub use widget_actions;
pub use widget_event::{
    WidgetStateEventContent, WIDGET_EVENT_TYPE, WIDGET_EVENT_TYPE_LEGACY, WIDGET_EVENT_TYPE_UNSTABLE,
};
pub use widget_matrix_backend::{self, MatrixBackend};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
