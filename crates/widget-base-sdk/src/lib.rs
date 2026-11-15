//! The widget side of the Matrix widget API (MSC4412).
//!
//! [`WidgetClient`] is a small, transport agnostic state machine that lives inside a widget. It
//!
//! * builds and sends `source: widget` requests and resolves the matching responses,
//! * answers `source: host` requests (acknowledgements) and surfaces their payload through a
//!   [`WidgetDelegate`],
//! * remembers which capabilities have been requested and which it holds (the host's last
//!   `update_capabilities`), and whether `notify_ready` was sent,
//! * fails requests the host does not answer in time ([`WidgetClient::timeout_request`]; the
//!   `WidgetApi` class starts the 10 second timer itself).
//!
//! It does **not** do any I/O itself: the delegate's `send_to_host` delivers outgoing JSON and
//! the embedding code feeds incoming JSON into [`WidgetClient::handle_message_from_host`].
//!
//! When compiled to `wasm32` this crate additionally exports a JavaScript class `WidgetApi`
//! (see the `wasm` module). MSC4412 fixes the transport to `postMessage`, so `WidgetApi`
//! implements the delegate's `send_to_host` directly against `window.parent` and a web widget
//! can simply `import { WidgetApi } from "widget-base-sdk"` without any transport glue.
//!
//! The client is single threaded (`!Send`), which is what browsers offer anyway.
//!
//! # Logging
//!
//! The client logs through the [`log`] facade and installs no logger. The `wasm32` build does:
//! warnings, errors and panics reach the JavaScript console without any setup, and `initLogging`
//! changes the level. Levels: `warn` for anything dropped or failed, `info` for the lifecycle,
//! `debug` for one line per message, `trace` for the message bodies (credentials redacted).

// See widget-actions: `WidgetClientError` wraps the full `WidgetError`.
#![allow(clippy::result_large_err)]

mod client;
mod error;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

pub use client::{WidgetClient, WidgetDelegate, WidgetState};
pub use error::WidgetClientError;
pub use widget_actions;
