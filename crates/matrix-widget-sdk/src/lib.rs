//! The widget side of the Matrix widget API (MSC4412).
//!
//! [`WidgetClient`] is a transport-agnostic, single-threaded (`!Send`) state machine inside a
//! widget. It sends `source: widget` requests and resolves the matching responses, acknowledges
//! what the host pushes and hands it to a [`WidgetDelegate`], remembers the capabilities requested
//! and held and whether `notify_ready` was sent, and fails requests the host does not answer in time
//! ([`WidgetClient::timeout_request`]). It does no I/O: the delegate's `send_to_host` delivers
//! outgoing JSON, and the embedding code feeds incoming JSON into
//! [`WidgetClient::handle_message_from_host`].
//!
//! On `wasm32` the `wasm` module exports the JavaScript class `WidgetApi`, wired to
//! `window.parent` (MSC4412 fixes the transport to `postMessage`).
//!
//! # Logging
//!
//! Through the [`log`] facade, with no logger installed; the `wasm32` build installs one (see
//! `wasm::logging`). Levels: `warn` for anything dropped or failed, `info` for the lifecycle,
//! `debug` for one line per message, `trace` for the message bodies (credentials redacted).

// See matrix-widget-actions: `WidgetClientError` wraps the full `WidgetError`.
#![allow(clippy::result_large_err)]

mod client;
mod error;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use client::{WidgetClient, WidgetDelegate, WidgetState};
pub use error::WidgetClientError;
pub use matrix_widget_actions;
