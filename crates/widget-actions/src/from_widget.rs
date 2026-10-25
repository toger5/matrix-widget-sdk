//! Direction enums for actions initiated by the widget (`source: widget`).
//!
//! The per-action body types live in [`crate::actions`]; this module only maps between the wire
//! envelope and the typed variants.

use serde_json::Value;

use crate::actions::{self, expect, from_value, to_value};
use crate::{
    ActionError, JsonValue, ReadEventsRequest, ReadEventsResponse, RequestCapabilitiesRequest, SendEventRequest,
    SendEventResponse, Source, WidgetError, WireMessage,
};

/// A typed request sent by the widget.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum FromWidgetRequest {
    /// The widget finished loading and may be shown. (always allowed)
    ContentLoaded,
    /// Ask the host for capabilities. (always allowed)
    RequestCapabilities { request: RequestCapabilitiesRequest },
    /// Send an event to the room. Requires a `send.*` capability.
    SendEvent { request: SendEventRequest },
    /// Read events from the room. Requires a `receive.*` capability.
    ReadEvents { request: ReadEventsRequest },
    /// An action this crate does not know about.
    Unknown { action: String, request: JsonValue },
}

impl FromWidgetRequest {
    pub fn action(&self) -> &str {
        match self {
            FromWidgetRequest::ContentLoaded => actions::CONTENT_LOADED,
            FromWidgetRequest::RequestCapabilities { .. } => actions::REQUEST_CAPABILITIES,
            FromWidgetRequest::SendEvent { .. } => actions::SEND_EVENT,
            FromWidgetRequest::ReadEvents { .. } => actions::READ_EVENTS,
            FromWidgetRequest::Unknown { action, .. } => action,
        }
    }

    /// The JSON body placed in the `request` field.
    pub fn body(&self) -> Value {
        match self {
            FromWidgetRequest::ContentLoaded => Value::Object(Default::default()),
            FromWidgetRequest::RequestCapabilities { request } => to_value(request),
            FromWidgetRequest::SendEvent { request } => to_value(request),
            FromWidgetRequest::ReadEvents { request } => to_value(request),
            FromWidgetRequest::Unknown { request, .. } => request.0.clone(),
        }
    }

    /// Wrap into a wire envelope with the given request id.
    pub fn into_wire(self, request_id: impl Into<String>) -> WireMessage {
        WireMessage::request(Source::Widget, self.action().to_owned(), request_id, self.body())
    }

    /// Interpret a wire envelope as a widget request.
    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Widget, true)?;
        let body = msg.request_body();
        let action = msg.action.as_str();
        Ok(match action {
            actions::CONTENT_LOADED => FromWidgetRequest::ContentLoaded,
            actions::REQUEST_CAPABILITIES => {
                FromWidgetRequest::RequestCapabilities { request: from_value(action, body)? }
            }
            actions::SEND_EVENT => FromWidgetRequest::SendEvent { request: from_value(action, body)? },
            actions::READ_EVENTS => FromWidgetRequest::ReadEvents { request: from_value(action, body)? },
            _ => FromWidgetRequest::Unknown { action: action.to_owned(), request: JsonValue(body) },
        })
    }
}

/// A typed response to a [`FromWidgetRequest`], sent by the host.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum FromWidgetResponse {
    /// `{}`. Used for `content_loaded`, `request_capabilities` and unknown-but-accepted actions.
    Ack,
    SendEvent {
        response: SendEventResponse,
    },
    ReadEvents {
        response: ReadEventsResponse,
    },
    /// The host rejected the request.
    Error {
        error: WidgetError,
    },
    /// A response body for an action this crate does not know about.
    Unknown {
        action: String,
        response: JsonValue,
    },
}

impl FromWidgetResponse {
    /// The JSON body placed in the `response` field.
    pub fn body(&self) -> Value {
        match self {
            FromWidgetResponse::Ack => Value::Object(Default::default()),
            FromWidgetResponse::SendEvent { response } => to_value(response),
            FromWidgetResponse::ReadEvents { response } => to_value(response),
            FromWidgetResponse::Error { error } => error.clone().into_response_body(),
            FromWidgetResponse::Unknown { response, .. } => response.0.clone(),
        }
    }

    /// Interpret the response to `request` found in `msg`.
    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Widget, false)?;
        if let Some(error) = msg.error() {
            return Ok(FromWidgetResponse::Error { error });
        }
        let body = msg.response_body();
        let action = msg.action.as_str();
        Ok(match action {
            actions::CONTENT_LOADED | actions::REQUEST_CAPABILITIES => FromWidgetResponse::Ack,
            actions::SEND_EVENT => FromWidgetResponse::SendEvent { response: from_value(action, body)? },
            actions::READ_EVENTS => FromWidgetResponse::ReadEvents { response: from_value(action, body)? },
            _ => FromWidgetResponse::Unknown { action: action.to_owned(), response: JsonValue(body) },
        })
    }

    /// Turn an `Error` variant into `Err`, everything else into `Ok`.
    pub fn into_result(self) -> Result<Self, WidgetError> {
        match self {
            FromWidgetResponse::Error { error } => Err(error),
            other => Ok(other),
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn unknown_and_errors() {
        let wire = WireMessage::request(Source::Widget, "org.example.custom", "r", json!({"a": 1}));
        assert_eq!(
            FromWidgetRequest::from_wire(&wire).unwrap(),
            FromWidgetRequest::Unknown { action: "org.example.custom".into(), request: json!({"a": 1}).into() }
        );

        let err = wire.error_response_to(WidgetError::new("denied"));
        assert_eq!(
            FromWidgetResponse::from_wire(&err).unwrap(),
            FromWidgetResponse::Error { error: WidgetError::new("denied") }
        );

        let host_msg = WireMessage::request(Source::Host, actions::SEND_EVENT, "r", json!({}));
        assert!(matches!(FromWidgetRequest::from_wire(&host_msg), Err(ActionError::WrongSource { .. })));
        assert!(matches!(FromWidgetRequest::from_wire(&wire.ack()), Err(ActionError::WrongDirection { .. })));
    }
}
