//! Direction enums for actions initiated by the host (`source: host`).
//!
//! The per-action body types live in [`crate::actions`]; this module only maps between the wire
//! envelope and the typed variants.

use serde_json::Value;

use crate::actions::{self, expect, from_value, to_value};
use crate::{
    ActionError, JsonValue, MatrixEvent, NotifyCapabilitiesRequest, Source, UpdateStateRequest, WidgetError,
    WireMessage,
};

/// A typed request sent by the host.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ToWidgetRequest {
    /// Result of a capability negotiation.
    NotifyCapabilities { request: NotifyCapabilitiesRequest },
    /// A room event the widget has a `receive.*` capability for.
    SendEvent { event: MatrixEvent },
    /// Current room state the widget has `receive.state_event` capabilities for.
    UpdateState { request: UpdateStateRequest },
    /// An action this crate does not know about.
    Unknown { action: String, request: JsonValue },
}

impl ToWidgetRequest {
    pub fn action(&self) -> &str {
        match self {
            ToWidgetRequest::NotifyCapabilities { .. } => actions::NOTIFY_CAPABILITIES,
            ToWidgetRequest::SendEvent { .. } => actions::SEND_EVENT,
            ToWidgetRequest::UpdateState { .. } => actions::UPDATE_STATE,
            ToWidgetRequest::Unknown { action, .. } => action,
        }
    }

    pub fn body(&self) -> Value {
        match self {
            ToWidgetRequest::NotifyCapabilities { request } => to_value(request),
            ToWidgetRequest::SendEvent { event } => to_value(event),
            ToWidgetRequest::UpdateState { request } => to_value(request),
            ToWidgetRequest::Unknown { request, .. } => request.0.clone(),
        }
    }

    pub fn into_wire(self, request_id: impl Into<String>) -> WireMessage {
        WireMessage::request(Source::Host, self.action().to_owned(), request_id, self.body())
    }

    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Host, true)?;
        let body = msg.request_body();
        let action = msg.action.as_str();
        Ok(match action {
            actions::NOTIFY_CAPABILITIES => ToWidgetRequest::NotifyCapabilities { request: from_value(action, body)? },
            actions::SEND_EVENT => ToWidgetRequest::SendEvent { event: from_value(action, body)? },
            actions::UPDATE_STATE => ToWidgetRequest::UpdateState { request: from_value(action, body)? },
            _ => ToWidgetRequest::Unknown { action: action.to_owned(), request: JsonValue(body) },
        })
    }
}

/// A typed response to a [`ToWidgetRequest`], sent by the widget.
///
/// All host initiated actions defined so far are acknowledged with `{}`.
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum ToWidgetResponse {
    Ack,
    Error { error: WidgetError },
    Unknown { action: String, response: JsonValue },
}

impl ToWidgetResponse {
    pub fn body(&self) -> Value {
        match self {
            ToWidgetResponse::Ack => Value::Object(Default::default()),
            ToWidgetResponse::Error { error } => error.clone().into_response_body(),
            ToWidgetResponse::Unknown { response, .. } => response.0.clone(),
        }
    }

    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Host, false)?;
        if let Some(error) = msg.error() {
            return Ok(ToWidgetResponse::Error { error });
        }
        let body = msg.response_body();
        Ok(match msg.action.as_str() {
            actions::NOTIFY_CAPABILITIES | actions::SEND_EVENT | actions::UPDATE_STATE => ToWidgetResponse::Ack,
            other => ToWidgetResponse::Unknown { action: other.to_owned(), response: JsonValue(body) },
        })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn unknown_and_errors() {
        let wire = WireMessage::request(Source::Host, "org.example.custom", "r", json!({"a": 1}));
        assert_eq!(
            ToWidgetRequest::from_wire(&wire).unwrap(),
            ToWidgetRequest::Unknown { action: "org.example.custom".into(), request: json!({"a": 1}).into() }
        );
        assert_eq!(
            ToWidgetResponse::from_wire(&wire.error_response_to(WidgetError::new("nope"))).unwrap(),
            ToWidgetResponse::Error { error: WidgetError::new("nope") }
        );
        assert!(matches!(ToWidgetRequest::from_wire(&wire.ack()), Err(ActionError::WrongDirection { .. })));
    }
}
