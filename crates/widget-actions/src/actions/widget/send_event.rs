//! `send_event` (MSC2762), widget -> host: send an event to the room.
//!
//! Body: [`SendEventRequest`], answered with [`SendEventResponse`]. Requires a `send.*`
//! capability. The host -> widget action of the same name lives in `actions::host::send_event`.

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
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn from_widget_roundtrip() {
        let req = WidgetRequest::SendEvent {
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
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"room_id": "!r:x", "event_id": "$e"}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::SendEvent { response: SendEventResponse { room_id: "!r:x".into(), event_id: "$e".into() } }
        );
    }
}
