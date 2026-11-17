//! The host side of the widget API (MSC4412).
//!
//! A [`WidgetHostDriver`] is created per rendered widget, from the widget's [`WidgetDefinition`]
//! (below). The embedding client ("platform") has three obligations:
//!
//! 1. Implement [`WidgetHostPlatform::load_iframe`]: build the widget's iframe (webview) from the
//!    URL, `sandbox` and `allow` the driver hands over ([`WidgetIframe`]), in place of the one
//!    before. The driver calls it from [`WidgetHostDriver::start`], and again whenever the widget's
//!    webview capabilities change the attributes.
//! 2. Pass every `postMessage` received **from** the window of that iframe into
//!    [`WidgetHostDriver::handle_message_from_widget`].
//! 3. Implement [`WidgetHostPlatform::send_to_widget`] to `postMessage` JSON **to** the widget
//!    window, with [`WidgetIframe::origin`] as the target origin (never `*`, see MSC4412).
//!
//! The driver takes care of the handshake (`notify_ready`, capability negotiation), checks
//! capabilities, performs Matrix operations through a [`MatrixBackend`] and answers the widget.
//! Events arriving from sync come through the backend too: whenever the widget's `host:…`
//! capabilities change, the driver subscribes to the backend
//! ([`MatrixBackend::subscribe_room`]) for exactly those event types, pushes the current state as
//! `update_state` and forwards new events as `forward_event`. It sends nothing before the widget
//! has sent its first action.
//!
//! Capability approval is the one asynchronous, user-facing step: the driver acknowledges a
//! `request_capabilities` immediately (as required by MSC4412), asks the platform via
//! [`WidgetHostPlatform::on_capabilities_requested`], and sends `update_capabilities` (always
//! the full list of what the widget holds) once the platform calls
//! [`WidgetHostDriver::approve_capabilities`]. Requests that arrive before that answer join the
//! open question, so one answer decides all of them.
//! [`WidgetHostDriver::revoke_capabilities`] takes capabilities away again.
//!
//! A grant can be limited. [`WidgetHostDriver::set_single_use`] names the capabilities a request
//! uses up (`get_openid` by default, so every OpenID token is a decision of its own): the driver
//! takes such a capability away when a request passes its check and sends `update_capabilities`
//! after the reply. The driver has no clock; a time limit is a timer of the platform that calls
//! `revoke_capabilities`.
//!
//! [`WidgetDefinition`] reads the widget state events of a room (MSC4411 `m.widget`, and the
//! legacy `im.vector.modular.widgets`): [`parse_widget_state_event`] tells which events are
//! widgets and whether the client may load one, after the URL check ([`widget_url_problem`], and
//! never the client's own compat wrapper, never a page of the client's own origin, see
//! [`EmbedOptions`]). [`WidgetHostDriver::new`] makes the same check and decides what
//! the iframe loads; a legacy widget is loaded through the compat wrapper and gets
//! [`legacy_auto_approved`] without asking.
//!
//! A widget whose state event does not say `uses_widget_api: true` (MSC4412) has no widget API:
//! the driver calls [`WidgetHostPlatform::on_ready`] right after `load_iframe` and refuses its
//! messages with [`DriverError::NoWidgetApi`].
//!
//! The iframe (webview) of a widget starts strict: `sandbox="allow-scripts allow-same-origin"`,
//! nothing in `allow`. Everything else is a webview capability (`webview:…sandbox:<token>`,
//! `webview:…allow:<feature>`) the widget requests like any other; [`WebviewPolicy`] grants the
//! base tokens without asking and never the `allow-top-navigation` ones, and
//! [`webview_attributes`] builds the iframe's attributes from what the widget holds. Applying a
//! grant or a revocation takes a new iframe: the driver calls `load_iframe` again, forgets the old
//! page (not ready, holds nothing, no open question, no subscriptions) and grants the new page
//! what the old one held without asking ([`DriverSnapshot::carried`]; not a single-use
//! capability).
//!
//! With the `uniffi` feature this crate's `cdylib` carries the UniFFI scaffolding of this crate,
//! `matrix-widget-host-backend-interface` and `matrix-widget-actions`; it is what the Kotlin/Swift/Python bindings and
//! the web bindings (`packages/widget-host-bindings`, via uniffi-bindgen-react-native) are
//! generated from.
//!
//! # Logging
//!
//! The driver logs through the [`log`] facade and installs no logger: a Rust application uses the
//! one it likes. The bindings have [`logging::setup_logging`] (`uniffi` feature) instead. Levels:
//! `warn` for anything dropped or refused, `info` for the widget's lifecycle, `debug` for one line
//! per message, `trace` for the message bodies (credentials redacted).

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
