/// A failure reported by the host's Matrix client.
///
/// `Failed` has the shape of matrix-rust-rtc's `BackendError`; the driver forwards all three fields
/// to the widget (`error.message`, `error.matrix_api_error`), so `reason` should be something a
/// widget developer can act on. (`reason`, not `message`: Kotlin exceptions already have one.)
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum BackendError {
    #[error("{reason}")]
    Failed { errcode: Option<String>, status: Option<u16>, reason: String },
    /// [`timeline_read`](crate::MatrixBackend::timeline_read)'s `from` is not in the timeline
    /// cache; the widget gets `…event_not_cached`.
    #[error("event {event_id} is not in the timeline cache")]
    EventNotCached { event_id: String },
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

    /// The timeline cache does not hold `event_id`.
    pub fn event_not_cached(event_id: impl Into<String>) -> Self {
        Self::EventNotCached { event_id: event_id.into() }
    }

    pub fn errcode(&self) -> Option<&str> {
        match self {
            Self::Failed { errcode, .. } => errcode.as_deref(),
            Self::EventNotCached { .. } => None,
        }
    }

    pub fn status(&self) -> Option<u16> {
        match self {
            Self::Failed { status, .. } => *status,
            Self::EventNotCached { .. } => None,
        }
    }

    pub fn reason(&self) -> &str {
        match self {
            Self::Failed { reason, .. } => reason,
            Self::EventNotCached { .. } => "the event is not in the timeline cache",
        }
    }
}

/// A foreign `MatrixBackend` threw something that is not a `BackendError`: an ordinary error
/// response for the widget instead of a panic.
#[cfg(feature = "uniffi")]
impl From<uniffi::UnexpectedUniFFICallbackError> for BackendError {
    fn from(err: uniffi::UnexpectedUniFFICallbackError) -> Self {
        Self::new(format!("unexpected backend error: {}", err.reason))
    }
}
