//! `send_event` (MSC2762), widget -> host: send an event to the room.
//!
//! Body: [`SendEventRequest`], answered with [`SendEventResponse`]. Requires a `send.*`
//! capability. The host -> widget action of the same name lives in `actions::host::send_event`.
//!
//! Extensions carried in the same body:
//!
//! * `room_id` (MSC2762): another room's timeline; needs `org.matrix.msc2762.timeline:<room>`.
//! * `delay` (MSC4157): schedule the send; needs `org.matrix.msc4157.send.delayed_event`. The
//!   response then carries a `delay_id` instead of an `event_id`.
//! * `sticky_duration_ms` (MSC4407 / MSC4354): a sticky event; needs
//!   `org.matrix.msc4407.send.sticky_event`. Not allowed together with `state_key`.

use serde::{Deserialize, Serialize};

use crate::JsonValue;

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
    /// The room to send to; the widget's own room when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    /// MSC4157: send after this many milliseconds instead of now.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay: Option<u64>,
    /// MSC4407: send as a sticky event with this lifetime.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sticky_duration_ms: Option<u64>,
}

impl SendEventRequest {
    /// A plain timeline event for the widget's own room.
    pub fn room_event(event_type: impl Into<String>, content: JsonValue) -> Self {
        Self {
            event_type: event_type.into(),
            state_key: None,
            content,
            room_id: None,
            delay: None,
            sticky_duration_ms: None,
        }
    }

    /// A state event for the widget's own room.
    pub fn state_event(event_type: impl Into<String>, state_key: impl Into<String>, content: JsonValue) -> Self {
        Self {
            event_type: event_type.into(),
            state_key: Some(state_key.into()),
            content,
            room_id: None,
            delay: None,
            sticky_duration_ms: None,
        }
    }

    pub fn is_state(&self) -> bool {
        self.state_key.is_some()
    }

    pub fn is_delayed(&self) -> bool {
        self.delay.is_some()
    }

    pub fn is_sticky(&self) -> bool {
        self.sticky_duration_ms.is_some()
    }
}

/// Response to a widget's `send_event` request: `event_id` for an immediate send, `delay_id`
/// (MSC4157) for a delayed one.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct SendEventResponse {
    pub room_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub delay_id: Option<String>,
}

impl SendEventResponse {
    pub fn sent(room_id: impl Into<String>, event_id: impl Into<String>) -> Self {
        Self { room_id: room_id.into(), event_id: Some(event_id.into()), delay_id: None }
    }

    pub fn delayed(room_id: impl Into<String>, delay_id: impl Into<String>) -> Self {
        Self { room_id: room_id.into(), event_id: None, delay_id: Some(delay_id.into()) }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn from_widget_roundtrip() {
        let req = WidgetRequest::SendEvent {
            request: SendEventRequest::room_event("m.room.message", json!({"body": "hi", "msgtype": "m.text"}).into()),
        };
        let wire = req.clone().into_wire("r1");
        assert_eq!(wire.action, "send_event");
        assert_eq!(wire.to_value()["request"]["type"], "m.room.message");
        let body = wire.to_value()["request"].clone();
        for absent in ["state_key", "room_id", "delay", "sticky_duration_ms"] {
            assert!(body.get(absent).is_none(), "{absent}");
        }
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"room_id": "!r:x", "event_id": "$e"}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::SendEvent { response: SendEventResponse::sent("!r:x", "$e") }
        );
    }

    #[test]
    fn extensions_roundtrip() {
        let req = WidgetRequest::SendEvent {
            request: SendEventRequest {
                event_type: "m.rtc.member".into(),
                state_key: None,
                content: json!({}).into(),
                room_id: Some("!r:x".into()),
                delay: Some(8000),
                sticky_duration_ms: Some(30000),
            },
        };
        let wire = req.clone().into_wire("r2");
        let body = wire.to_value()["request"].clone();
        assert_eq!(body["room_id"], "!r:x");
        assert_eq!(body["delay"], 8000);
        assert_eq!(body["sticky_duration_ms"], 30000);
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"room_id": "!r:x", "delay_id": "d1"}));
        let parsed = WidgetResponse::from_wire(&res).unwrap();
        assert_eq!(parsed, WidgetResponse::SendEvent { response: SendEventResponse::delayed("!r:x", "d1") });
        assert!(parsed.into_wire_reply(&wire).to_value()["response"].get("event_id").is_none());
    }
}
