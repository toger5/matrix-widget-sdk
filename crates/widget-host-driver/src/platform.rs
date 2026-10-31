use widget_actions::{Capability, StickerRequest};

use crate::PlatformError;

/// What the embedding client provides to the driver.
///
/// The driver calls these methods synchronously from inside its own methods. It never calls them
/// concurrently for one driver, but it may call them from any thread the platform runs it on.
#[cfg_attr(feature = "uniffi", uniffi::export(with_foreign))]
pub trait WidgetHostPlatform: Send + Sync {
    /// Deliver a JSON message to the widget window, e.g.
    /// `iframe.contentWindow.postMessage(JSON.parse(json), widgetOrigin)`.
    ///
    /// Never use `*` as the target origin (MSC4412).
    fn send_to_widget(&self, json: String);

    /// The widget asked for `requested`; the driver has already acknowledged the request.
    ///
    /// Ask the user (or a policy), then call [`WidgetHostDriver::approve_capabilities`] with the
    /// approved subset. An empty list denies everything and still completes the negotiation.
    ///
    /// [`WidgetHostDriver::approve_capabilities`]: crate::WidgetHostDriver::approve_capabilities
    fn on_capabilities_requested(&self, requested: Vec<Capability>);

    /// The widget sent `content_loaded`: hide the loading indicator and show the iframe.
    fn on_content_loaded(&self);

    /// The widget asked for an OpenID token, and the driver told it that the user is being asked.
    ///
    /// Ask the user, then call [`WidgetHostDriver::resolve_openid`]. Not called while
    /// [`WidgetHostDriver::set_openid_auto_approved`] is on.
    ///
    /// [`WidgetHostDriver::resolve_openid`]: crate::WidgetHostDriver::resolve_openid
    /// [`WidgetHostDriver::set_openid_auto_approved`]: crate::WidgetHostDriver::set_openid_auto_approved
    fn on_openid_requested(&self);

    /// Open `uri` (`org.matrix.msc2931.navigate`). The driver has checked that it is a
    /// `https://matrix.to/#/` permalink. An error is passed on to the widget.
    fn navigate(&self, uri: String) -> Result<(), PlatformError>;

    /// Build and send an `m.sticker` event for a sticker picker widget. An error is passed on to
    /// the widget.
    fn send_sticker(&self, sticker: StickerRequest) -> Result<(), PlatformError>;

    /// Keep the widget on screen (`value: true`) or stop doing so. Returns whether the client
    /// honours the request.
    fn set_always_on_screen(&self, value: bool) -> bool;

    /// The client's identifier for `client_context`, e.g. `io.element.web`.
    fn client_id(&self) -> Option<String>;

    /// The client's current theme name for `client_context`, e.g. `dark`.
    fn client_theme(&self) -> Option<String>;

    /// The client's current UI language for `client_context`, e.g. `en`.
    fn client_language(&self) -> Option<String>;
}
