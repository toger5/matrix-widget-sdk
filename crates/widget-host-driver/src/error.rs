use widget_actions::ActionError;

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
    /// The widget speaks the pre-MSC4412 protocol (no `version` field). The platform should
    /// route this widget to its legacy implementation, if any.
    #[error("widget uses the legacy widget api (no version field)")]
    LegacyWidgetApi,
    /// The message has a version this driver does not implement.
    #[error("unsupported widget api version `{version}`")]
    UnsupportedVersion { version: String },
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
