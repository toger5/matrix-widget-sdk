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
//! Events arriving from sync are pushed in with [`WidgetHostDriver::on_matrix_event`]; the driver
//! forwards them only when the widget holds a matching `receive.*` capability.
//!
//! Capability approval is the one asynchronous, user-facing step: the driver acknowledges a
//! `request_capabilities` immediately (as required by MSC4412), asks the platform via
//! [`WidgetHostPlatform::on_capabilities_requested`], and sends `notify_capabilities` once the
//! platform calls [`WidgetHostDriver::approve_capabilities`].
//!
//! [`WidgetStateEventContent`] describes the `m.widget` state event (MSC4411) the client reads
//! from room state to know which widgets to render.
//!
//! When compiled to `wasm32` this crate additionally exports a JavaScript class `WidgetHost`
//! (see the `wasm` module): the driver wired to an [`InMemoryBackend`](widget_matrix_backend::InMemoryBackend)
//! for test hosts and tooling.

mod driver;
mod error;
#[cfg(target_arch = "wasm32")]
pub mod wasm;
mod widget_event;

pub use driver::{DriverSnapshot, WidgetHostDriver, WidgetHostPlatform};
pub use error::DriverError;
pub use widget_actions;
pub use widget_event::{
    WidgetStateEventContent, WIDGET_EVENT_TYPE, WIDGET_EVENT_TYPE_LEGACY, WIDGET_EVENT_TYPE_UNSTABLE,
};
pub use widget_matrix_backend::{self, MatrixBackend};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
