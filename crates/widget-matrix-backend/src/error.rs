/// Errors a [`MatrixBackend`](crate::MatrixBackend) can report.
///
/// The driver turns these into widget API error responses, so `message` should be something a
/// widget developer can act on.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum BackendError {
    /// The user is not allowed to perform the operation (e.g. power levels).
    #[error("forbidden: {message}")]
    Forbidden { message: String },
    /// Nothing matched (e.g. unknown room).
    #[error("not found: {message}")]
    NotFound { message: String },
    /// Transport / homeserver failure.
    #[error("network error: {message}")]
    Network { message: String },
    /// Anything else.
    #[error("{message}")]
    Other { message: String },
}

impl BackendError {
    pub fn forbidden(message: impl Into<String>) -> Self {
        Self::Forbidden { message: message.into() }
    }

    pub fn not_found(message: impl Into<String>) -> Self {
        Self::NotFound { message: message.into() }
    }

    pub fn network(message: impl Into<String>) -> Self {
        Self::Network { message: message.into() }
    }

    pub fn other(message: impl Into<String>) -> Self {
        Self::Other { message: message.into() }
    }
}
