//! The host side of the widget API (MSC4412).
//!
//! A [`WidgetHostDriver`] is created per rendered widget from its [`WidgetDefinition`]
//! ([`parse_widget_state_event`] reads it from the MSC4411 state event). The embedding client
//! ("platform") implements [`WidgetHostPlatform`] (build the iframe, `postMessage` to it with
//! [`WidgetIframe::origin`] as the target origin, never `*`, and ask the user about capabilities)
//! and passes every message from the iframe's window to
//! [`WidgetHostDriver::handle_message_from_widget`].
//!
//! The driver runs the handshake, checks capabilities, performs Matrix operations through a
//! [`MatrixBackend`] and answers the widget. For the approved `host:…` capabilities it subscribes
//! to the backend and pushes `update_state`, `forward_event` & co.; it sends nothing before the
//! widget's first action. The rules are documented where they are applied:
//!
//! * capability negotiation: [`WidgetHostPlatform::on_capabilities_requested`],
//!   [`WidgetHostDriver::approve_capabilities`], [`WidgetHostDriver::revoke_capabilities`];
//! * single-use grants (`get_openid` by default): [`WidgetHostDriver::set_single_use`];
//! * the iframe and its webview capabilities: [`WidgetHostPlatform::load_iframe`],
//!   [`WebviewPolicy`], [`webview_attributes`], [`DriverSnapshot::carried`];
//! * which widgets may be loaded, legacy widgets and the compat wrapper: [`parse_widget_state_event`],
//!   [`widget_url_problem`], [`EmbedOptions`], [`legacy_auto_approved`];
//! * a widget without `uses_widget_api: true`: [`DriverError::NoWidgetApi`].
//!
//! With the `uniffi` feature this crate's `cdylib` carries the UniFFI scaffolding of this crate,
//! `matrix-widget-host-backend-interface` and `matrix-widget-actions`, from which the
//! Kotlin/Swift/Python and the web bindings (`packages/widget-host-bindings`) are generated.
//!
//! # Logging
//!
//! Through the [`log`] facade, with no logger installed (the bindings have
//! `logging::setup_logging`). `warn` for anything dropped or refused, `info` for the widget's
//! lifecycle, `debug` for one line per message, `trace` for the bodies (credentials redacted).

// See matrix-widget-actions: request handlers return the full `WidgetError`.
#![allow(clippy::result_large_err)]

mod driver;
mod error;
#[cfg(feature = "uniffi")]
pub mod logging;
mod platform;
mod webview;
mod widget_event;
mod widget_url;

pub use driver::{DriverSnapshot, WidgetHostDriver};
pub use error::{DriverError, PlatformError};
pub use matrix_widget_actions;
pub use matrix_widget_host_backend_interface::{self, MatrixBackend};
pub use platform::WidgetHostPlatform;
pub use webview::{
    legacy_auto_approved, webview_attributes, WebviewAttributes, WebviewPolicy, WidgetIframe, BASE_SANDBOX,
};
pub use widget_event::{
    parse_widget_state_event, widget_event_types, LegacyWidget, WidgetDefinition, WidgetEventError, WIDGET_EVENT_TYPE,
    WIDGET_EVENT_TYPES, WIDGET_EVENT_TYPE_LEGACY, WIDGET_EVENT_TYPE_UNSTABLE,
};
pub use widget_url::{widget_url_problem, EmbedOptions};

#[cfg(feature = "uniffi")]
uniffi::setup_scaffolding!();
