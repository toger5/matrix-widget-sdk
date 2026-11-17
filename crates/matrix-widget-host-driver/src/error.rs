use matrix_widget_actions::ActionError;

/// Errors reported to the *platform* (not to the widget) by the driver.
///
/// Anything the widget did wrong is answered to the widget with an error response and does not
/// surface here. These variants cover situations the embedding client needs to know about.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum DriverError {
    /// The JSON is not an MSC4412 envelope at all (probably not a widget message).
    #[error("not a widget api message: {message}")]
    NotAWidgetMessage { message: String },
    /// The widget speaks the pre-MSC4412 protocol: its message has an `api` property instead of
    /// `source`. The platform should route this widget to its legacy implementation or load it
    /// through the compat wrapper.
    #[error("widget uses the legacy widget api (`api` instead of `source`)")]
    LegacyWidgetApi,
    /// The widget's state event does not say `uses_widget_api: true` (MSC4412), so the widget API
    /// is not set up for it: the driver answers none of its messages.
    #[error("the widget does not use the widget api (`uses_widget_api` is not set in its state event)")]
    NoWidgetApi,
    /// The widget sent a response for a request the driver never made (or already completed).
    #[error("unexpected response for request id `{request_id}`")]
    UnexpectedResponse { request_id: String },
    /// A message with `source: widget` arrived as a response, or `source: host` as a request.
    /// The widget is confused; the driver ignores the message.
    #[error("message direction does not fit the host side: {message}")]
    WrongDirection { message: String },
}

/// A failure reported by the [`WidgetHostPlatform`](crate::WidgetHostPlatform) for an action it
/// performs on the widget's behalf (navigation). The driver answers the widget
/// with `reason`.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum PlatformError {
    #[error("{reason}")]
    Failed { reason: String },
}

impl PlatformError {
    pub fn new(reason: impl Into<String>) -> Self {
        Self::Failed { reason: reason.into() }
    }

    pub fn reason(&self) -> &str {
        let Self::Failed { reason } = self;
        reason
    }
}

/// A foreign platform threw something that is not a `PlatformError`: answer the widget with an
/// error instead of panicking.
#[cfg(feature = "uniffi")]
impl From<uniffi::UnexpectedUniFFICallbackError> for PlatformError {
    fn from(err: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::new(format!("unexpected platform error: {}", err.reason))
    }
}

impl From<ActionError> for DriverError {
    fn from(err: ActionError) -> Self {
        match err {
            ActionError::WrongSource { .. } | ActionError::WrongDirection { .. } => {
                DriverError::WrongDirection { message: err.to_string() }
            }
            other => DriverError::NotAWidgetMessage { message: other.to_string() },
        }
    }
}
