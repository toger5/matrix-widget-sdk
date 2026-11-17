use widget_actions::Capability;

use crate::{PlatformError, WidgetIframe};

/// What the embedding client provides to the driver.
///
/// The driver calls these methods synchronously from inside its own methods. It never calls them
/// concurrently for one driver, but it may call them from any thread the platform runs it on.
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
pub trait WidgetHostPlatform: Send + Sync {
    /// Build the widget's iframe (webview) from `iframe` behind a loading state, in place of the
    /// one before, and start the timeout of [`on_ready`](Self::on_ready).
    ///
    /// Called by [`WidgetHostDriver::start`], and again whenever the widget's webview
    /// capabilities change `sandbox` or `allow`: a browser applies them only to a new iframe, so
    /// the widget starts over in it. The driver has forgotten the old page by then (drop an open
    /// capability prompt) and grants the new one what the old one held without asking. Accept
    /// messages only from the window of the iframe built last, and only from
    /// [`WidgetIframe::origin`]. A client should stop a widget that is reloaded too often.
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
    /// `requested` is the whole open question: every capability the widget requested since the
    /// last answer, without those it holds already and those granted without asking
    /// ([`WidgetHostDriver::set_auto_approved`]). A request that arrives before the answer joins
    /// the question; if it adds something to decide, this is called again with the whole
    /// question, which replaces the earlier one (the merge proposed for MSC4412 in
    /// `spec/patch/msc4412/merge-capability-requests.md`).
    ///
    /// Ask the user (or a policy), then call [`WidgetHostDriver::approve_capabilities`] once
    /// with the approved subset: it answers every request so far. An empty list denies
    /// everything and still completes the negotiation. A host that prompts should not accept an
    /// approval for a few seconds after the question appeared or changed, so that the widget
    /// cannot change what the user approves just before the click.
    /// Clients should remember what was approved, so that the user is not asked again every time
    /// the widget starts (pass it to [`WidgetHostDriver::set_auto_approved`]), except a
    /// single-use capability ([`WidgetHostDriver::set_single_use`], `get_openid` by default): it
    /// is asked about for every use, unless the user chose to allow it always.
    ///
    /// [`WidgetHostDriver::set_auto_approved`]: crate::WidgetHostDriver::set_auto_approved
    /// [`WidgetHostDriver::set_single_use`]: crate::WidgetHostDriver::set_single_use
    ///
    /// [`WidgetHostDriver::approve_capabilities`]: crate::WidgetHostDriver::approve_capabilities
    fn on_capabilities_requested(&self, requested: Vec<Capability>);

    /// Hide the loading state and show the iframe built by the last
    /// [`load_iframe`](Self::load_iframe). Called once after each `load_iframe`:
    ///
    /// * when the widget sends `notify_ready`, or
    /// * right after `load_iframe`, from inside the same driver call, for a widget whose state
    ///   event does not say `uses_widget_api: true`: it never sends `notify_ready`.
    ///
    /// Until then the client shows a loading state in place of the widget. If this is not called
    /// in time (MSC4412 recommends 15 seconds,
    /// [`NOTIFY_READY_TIMEOUT_MS`](widget_actions::NOTIFY_READY_TIMEOUT_MS)), the client should
    /// show an error instead.
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
