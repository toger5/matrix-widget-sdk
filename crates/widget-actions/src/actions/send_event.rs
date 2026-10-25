//! `send_event` (MSC2762), both directions.
//!
//! * Widget -> host: send an event to the room. Body: [`SendEventRequest`], answered with
//!   [`SendEventResponse`]. Requires a `send.*` capability.
//! * Host -> widget: deliver a room event the widget has a `receive.*` capability for. Body: a
//!   [`MatrixEvent`](crate::MatrixEvent), acknowledged with `{}`.

use serde::{Deserialize, Serialize};

use crate::JsonValue;

/// Wire name of the action.
pub const ACTION: &str = "send_event";

/// Body of a widget's `send_event` request.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SendEventRequest {
    #[serde(rename = "type")]
    pub event_type: String,
    /// Present (possibly empty) for state events, absent for timeline events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_key: Option<String>,
    pub content: JsonValue,
}

impl SendEventRequest {
    pub fn is_state(&self) -> bool {
        self.state_key.is_some()
    }
}

/// Response to a widget's `send_event` request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SendEventResponse {
    pub room_id: String,
    pub event_id: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::actions::test_event;
    use crate::{ActionError, FromWidgetRequest, FromWidgetResponse, Source, ToWidgetRequest, WireMessage};

    #[test]
    fn from_widget_roundtrip() {
        let req = FromWidgetRequest::SendEvent {
            request: SendEventRequest {
                event_type: "m.room.message".into(),
                state_key: None,
                content: json!({"body": "hi", "msgtype": "m.text"}).into(),
            },
        };
        let wire = req.clone().into_wire("r1");
        assert_eq!(wire.action, ACTION);
        assert_eq!(wire.to_value()["request"]["type"], "m.room.message");
        assert!(wire.to_value()["request"].get("state_key").is_none());
        assert_eq!(FromWidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"room_id": "!r:x", "event_id": "$e"}));
        assert_eq!(
            FromWidgetResponse::from_wire(&res).unwrap(),
            FromWidgetResponse::SendEvent {
                response: SendEventResponse { room_id: "!r:x".into(), event_id: "$e".into() }
            }
        );
    }

    #[test]
    fn to_widget_roundtrip() {
        let wire = ToWidgetRequest::SendEvent { event: test_event() }.into_wire("s");
        assert_eq!(wire.to_value()["request"]["type"], "m.room.message");
        assert_eq!(ToWidgetRequest::from_wire(&wire).unwrap(), ToWidgetRequest::SendEvent { event: test_event() });

        let widget_msg = WireMessage::request(Source::Widget, ACTION, "s", json!({}));
        assert!(matches!(ToWidgetRequest::from_wire(&widget_msg), Err(ActionError::WrongSource { .. })));
    }
}
