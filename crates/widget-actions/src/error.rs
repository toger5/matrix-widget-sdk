/// Errors produced while converting between wire messages and typed actions.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Error))]
pub enum ActionError {
    /// The JSON could not be parsed or did not have the envelope shape.
    #[error("malformed widget message: {message}")]
    Malformed { message: String },
    /// A message with `source` `host` was handled where a `widget` message was expected (or vice versa).
    #[error("message has unexpected source `{got}`")]
    WrongSource { got: String },
    /// A request was handled where a response was expected (or vice versa).
    #[error("expected a {expected}, got a {got}")]
    WrongDirection { expected: String, got: String },
    /// The `request`/`response` body did not match the schema of the action.
    #[error("invalid body for action `{action}`: {message}")]
    InvalidBody { action: String, message: String },
    /// The response body carried an error object.
    #[error("widget api error: {message}")]
    ErrorResponse { message: String },
}

impl ActionError {
    pub(crate) fn malformed(err: impl std::fmt::Display) -> Self {
        Self::Malformed { message: err.to_string() }
    }

    pub(crate) fn invalid_body(action: &str, err: impl std::fmt::Display) -> Self {
        Self::InvalidBody { action: action.to_owned(), message: err.to_string() }
    }
}
