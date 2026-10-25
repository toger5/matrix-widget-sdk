/// A failure reported by the host's Matrix client.
///
/// The same shape as matrix-rust-rtc's `BackendError`: one variant carrying the Matrix `errcode`
/// and HTTP status when the client had them, plus a message. The driver forwards all three to the
/// widget (`error.message` and `error.matrix_api_error`), so `reason` should be something a widget
/// developer can act on.
///
/// (One variant rather than a struct because UniFFI errors are enums; `reason` rather than
/// `message` because Kotlin's generated exception already has a `message` property.)
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum BackendError {
    #[error("{reason}")]
    Failed { errcode: Option<String>, status: Option<u16>, reason: String },
}

impl BackendError {
    /// A failure without Matrix error details.
    pub fn new(reason: impl Into<String>) -> Self {
        Self::Failed { errcode: None, status: None, reason: reason.into() }
    }

    /// A failure the homeserver reported with a standard error response.
    pub fn with_matrix_error(errcode: Option<String>, status: Option<u16>, reason: impl Into<String>) -> Self {
        Self::Failed { errcode, status, reason: reason.into() }
    }

    /// `M_FORBIDDEN` / 403: the user is not allowed to perform the operation (e.g. power levels).
    pub fn forbidden(reason: impl Into<String>) -> Self {
        Self::with_matrix_error(Some("M_FORBIDDEN".into()), Some(403), reason)
    }

    /// `M_NOT_FOUND` / 404.
    pub fn not_found(reason: impl Into<String>) -> Self {
        Self::with_matrix_error(Some("M_NOT_FOUND".into()), Some(404), reason)
    }

    /// The backend does not implement an optional operation (relations, TURN servers, ...).
    pub fn not_implemented(method: &str) -> Self {
        Self::new(format!("the backend does not implement {method}"))
    }

    pub fn errcode(&self) -> Option<&str> {
        let Self::Failed { errcode, .. } = self;
        errcode.as_deref()
    }

    pub fn status(&self) -> Option<u16> {
        let Self::Failed { status, .. } = self;
        *status
    }

    pub fn reason(&self) -> &str {
        let Self::Failed { reason, .. } = self;
        reason
    }
}

/// A foreign `MatrixBackend` threw something that is not a `BackendError`. Report it as an
/// ordinary error so the widget gets an error response instead of the driver panicking.
#[cfg(feature = "uniffi")]
impl From<uniffi::UnexpectedUniFFICallbackError> for BackendError {
    fn from(err: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::new(format!("unexpected backend error: {}", err.reason))
    }
}
