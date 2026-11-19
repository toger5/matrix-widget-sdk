use matrix_widget_actions::Capability;

use crate::{PlatformError, WidgetIframe};

/// What the embedding client provides to the driver.
///
/// The driver calls these methods synchronously from inside its own methods. It never calls them
/// concurrently for one driver, but it may call them from any thread the platform runs it on.
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
pub trait WidgetHostPlatform: Send + Sync {
    /// Build the widget's iframe (webview) from `iframe` behind a loading state, in place of the
    /// one before, and start the timeout of [`on_ready`](Self::on_ready). Accept messages only from
    /// the window of the iframe built last, and only from [`WidgetIframe::origin`].
    ///
    /// Called by [`WidgetHostDriver::start`], and again whenever the widget's webview
    /// capabilities change `sandbox` or `allow` (a browser applies them only to a new iframe). The
    /// widget starts over then: the driver has forgotten the old page (drop an open capability
    /// prompt) and grants the new one what the old one held. Stop a widget that is reloaded too
    /// often.
    ///
    /// [`WidgetHostDriver::start`]: crate::WidgetHostDriver::start
    fn load_iframe(&self, iframe: WidgetIframe);

    /// Deliver a JSON message to the widget window, e.g.
    /// `iframe.contentWindow.postMessage(JSON.parse(json), widgetOrigin)`.
    ///
    /// Never use `*` as the target origin (MSC4412).
    fn send_to_widget(&self, json: String);

    /// The widget asked for capabilities that need a decision; the driver has already
    /// acknowledged the request.
    ///
    /// `requested` is the whole open question: everything requested since the last answer, without
    /// what the widget holds or gets without asking. A request before the answer joins it; if it
    /// adds something to decide, this is called again with the whole question, which replaces the
    /// earlier one (`spec/patch/msc4412/merge-capability-requests.md`).
    ///
    /// Ask the user (or a policy), then call [`WidgetHostDriver::approve_capabilities`] once with
    /// the approved subset (empty denies everything). A prompt should not accept an approval for a
    /// few seconds after the question appeared or changed, so that the widget cannot change it just
    /// before the click. Remember approvals for [`WidgetHostDriver::set_auto_approved`], except
    /// single-use ones ([`WidgetHostDriver::set_single_use`]) unless the user chose "always".
    ///
    /// [`WidgetHostDriver::approve_capabilities`]: crate::WidgetHostDriver::approve_capabilities
    /// [`WidgetHostDriver::set_auto_approved`]: crate::WidgetHostDriver::set_auto_approved
    /// [`WidgetHostDriver::set_single_use`]: crate::WidgetHostDriver::set_single_use
    fn on_capabilities_requested(&self, requested: Vec<Capability>);

    /// Hide the loading state and show the iframe built by the last
    /// [`load_iframe`](Self::load_iframe). Called once after each `load_iframe`: when the widget
    /// sends `notify_ready`, or, for a widget without `uses_widget_api: true` (it never does), right
    /// after `load_iframe` from inside the same driver call. Not in time (MSC4412 recommends
    /// [`NOTIFY_READY_TIMEOUT_MS`](matrix_widget_actions::NOTIFY_READY_TIMEOUT_MS)): show an error.
    fn on_ready(&self);

    /// Open `uri` (the `navigate` action). The driver has checked that it is a
    /// `https://matrix.to/#/` permalink. An error is passed on to the widget.
    fn navigate(&self, uri: String) -> Result<(), PlatformError>;

    /// Keep the widget on screen (`value: true`) or stop doing so. Returns whether the client
    /// honours the request.
    fn set_always_on_screen(&self, value: bool) -> bool;

    /// The client's identifier for `get_client_context`, e.g. `io.element.web`.
    fn client_id(&self) -> Option<String>;

    /// The client's current theme name for `get_client_context`, e.g. `dark`.
    fn client_theme(&self) -> Option<String>;

    /// The client's current UI language for `get_client_context`, e.g. `en`.
    fn client_language(&self) -> Option<String>;
}
