use widget_actions::{ActionError, WidgetError};

/// Errors surfaced to the widget application.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum WidgetClientError {
    /// The message from the host was not a valid widget API message.
    #[error(transparent)]
    Protocol(#[from] ActionError),
    /// The host answered with an error.
    #[error("host rejected the request: {0}")]
    Host(WidgetError),
    /// A response arrived for a request id the client does not know.
    #[error("response for unknown request id `{request_id}`")]
    UnknownRequestId { request_id: String },
    /// The host answered with a body of the wrong shape for the action.
    #[error("unexpected response for action `{action}`")]
    UnexpectedResponse { action: String },
    /// The message has no / an unsupported `version`.
    #[error("unsupported widget api version `{version}`")]
    UnsupportedVersion { version: String },
    /// The message was a widget-sourced request or host-sourced response, which a widget never receives.
    #[error("message direction does not fit the widget side: {message}")]
    WrongDirection { message: String },
    /// The client was dropped before the host answered.
    #[error("the widget client was dropped before a response arrived")]
    Cancelled,
    /// The host (or the user) refused to hand out an OpenID token.
    #[error("the host blocked the OpenID request")]
    OpenIdBlocked,
}
