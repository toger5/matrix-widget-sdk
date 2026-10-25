//! `org.matrix.msc2876.read_events` (MSC2876), widget -> host.
//!
//! Read timeline or state events from the room. Body: [`ReadEventsRequest`], answered with
//! [`ReadEventsResponse`]. Requires a `receive.*` capability; `room_ids` additionally needs the
//! `org.matrix.msc2762.timeline:<room>` capability per room.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::{MatrixEvent, StateKeySelector};

/// Which rooms a `read_events` request is interested in (MSC2762 `room_ids`).
///
/// On the wire either the string `*` (every room the widget may see) or an array of room ids.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum RoomSelector {
    Any,
    Rooms { room_ids: Vec<String> },
}

impl Serialize for RoomSelector {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            RoomSelector::Any => s.serialize_str("*"),
            RoomSelector::Rooms { room_ids } => room_ids.serialize(s),
        }
    }
}

impl<'de> Deserialize<'de> for RoomSelector {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match Value::deserialize(d)? {
            Value::String(s) if s == "*" => Ok(RoomSelector::Any),
            Value::Array(items) => Ok(RoomSelector::Rooms {
                room_ids: items
                    .into_iter()
                    .map(|v| match v {
                        Value::String(s) => Ok(s),
                        other => Err(D::Error::custom(format!("room_ids entries must be strings, got {other}"))),
                    })
                    .collect::<Result<_, _>>()?,
            }),
            other => Err(D::Error::custom(format!("room_ids must be `*` or an array of room ids, got {other}"))),
        }
    }
}

/// Body of `read_events`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadEventsRequest {
    #[serde(rename = "type")]
    pub event_type: String,
    /// `None` reads timeline events, `Some` reads state events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_key: Option<StateKeySelector>,
    /// Only `m.room.message` events with this `msgtype` (timeline reads).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msgtype: Option<String>,
    /// Maximum number of events. Hosts may clamp this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Rooms to read from; the widget's own room when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_ids: Option<RoomSelector>,
    /// Opaque pagination token from an earlier read (timeline reads).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub since: Option<String>,
}

impl ReadEventsRequest {
    /// Read recent timeline events of `event_type`.
    pub fn timeline(event_type: impl Into<String>, limit: Option<u32>) -> Self {
        Self { event_type: event_type.into(), state_key: None, msgtype: None, limit, room_ids: None, since: None }
    }

    /// Read current state events of `event_type`.
    pub fn state(event_type: impl Into<String>, state_key: StateKeySelector) -> Self {
        Self {
            event_type: event_type.into(),
            state_key: Some(state_key),
            msgtype: None,
            limit: None,
            room_ids: None,
            since: None,
        }
    }

    pub fn is_state(&self) -> bool {
        self.state_key.is_some()
    }
}

/// Response to `read_events`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadEventsResponse {
    pub events: Vec<MatrixEvent>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::actions::test_event;
    use crate::{ActionError, Source, WidgetRequest, WidgetResponse, WireMessage};

    #[test]
    fn state_key_selector() {
        // The legacy / unstable spelling and the plain one are both accepted.
        let wire = WireMessage::request(
            Source::Widget,
            "org.matrix.msc2876.read_events",
            "r",
            json!({"type": "m.room.member", "state_key": true, "limit": 5}),
        );
        match WidgetRequest::from_wire(&wire).unwrap() {
            WidgetRequest::ReadEvents { request } => {
                assert_eq!(request.state_key, Some(StateKeySelector::Any));
                assert_eq!(request.limit, Some(5));
                assert_eq!(serde_json::to_value(&request).unwrap()["state_key"], true);
            }
            other => panic!("{other:?}"),
        }

        let wire = WireMessage::request(
            Source::Widget,
            "read_events",
            "r",
            json!({"type": "m.room.member", "state_key": "@a:b"}),
        );
        let WidgetRequest::ReadEvents { request } = WidgetRequest::from_wire(&wire).unwrap() else { panic!() };
        assert_eq!(request.state_key, Some(StateKeySelector::key("@a:b")));

        let bad = WireMessage::request(Source::Widget, "read_events", "r", json!({"type": "x", "state_key": 5}));
        assert!(matches!(WidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));
    }

    #[test]
    fn room_ids_msgtype_since() {
        let wire = WireMessage::request(
            Source::Widget,
            "read_events",
            "r",
            json!({"type": "m.room.message", "msgtype": "m.text", "room_ids": "*", "since": "s1"}),
        );
        let WidgetRequest::ReadEvents { request } = WidgetRequest::from_wire(&wire).unwrap() else { panic!() };
        assert_eq!(request.room_ids, Some(RoomSelector::Any));
        assert_eq!(request.msgtype.as_deref(), Some("m.text"));
        assert_eq!(request.since.as_deref(), Some("s1"));
        assert_eq!(serde_json::to_value(&request).unwrap()["room_ids"], "*");

        let wire = WireMessage::request(
            Source::Widget,
            "read_events",
            "r",
            json!({"type": "m.room.message", "room_ids": ["!a:x", "!b:x"]}),
        );
        let WidgetRequest::ReadEvents { request } = WidgetRequest::from_wire(&wire).unwrap() else { panic!() };
        assert_eq!(request.room_ids, Some(RoomSelector::Rooms { room_ids: vec!["!a:x".into(), "!b:x".into()] }));
        assert_eq!(serde_json::to_value(&request).unwrap()["room_ids"], json!(["!a:x", "!b:x"]));

        let bad = WireMessage::request(Source::Widget, "read_events", "r", json!({"type": "x", "room_ids": "!a:x"}));
        assert!(matches!(WidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));
    }

    #[test]
    fn response_roundtrip() {
        let req = WidgetRequest::ReadEvents { request: ReadEventsRequest::timeline("m.room.message", Some(1)) };
        let wire = req.into_wire("r");
        assert_eq!(wire.action, "org.matrix.msc2876.read_events");
        assert_eq!(wire.to_value()["request"], json!({"type": "m.room.message", "limit": 1}));
        let res = wire.response_to(json!({"events": [test_event()]}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::ReadEvents { response: ReadEventsResponse { events: vec![test_event()] } }
        );
    }
}
