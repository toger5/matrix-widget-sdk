//! `com.beeper.read_room_account_data` (Beeper extension), widget -> host: read room account
//! data of one type.
//!
//! Body: [`ReadRoomAccountDataRequest`], answered with [`ReadRoomAccountDataResponse`]. Requires
//! `widget:…read_room_account_data:<type>`. `room_ids` may only name the
//! widget's own room.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::RoomAccountData;

/// Which rooms a `read_room_account_data` request is interested in (MSC2762 `room_ids`).
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

/// Body of `read_room_account_data`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadRoomAccountDataRequest {
    #[serde(rename = "type")]
    pub event_type: String,
    /// Rooms to read from; the widget's own room when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_ids: Option<RoomSelector>,
}

/// Response to `read_room_account_data`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadRoomAccountDataResponse {
    pub events: Vec<RoomAccountData>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{ActionError, Source, WidgetRequest, WidgetResponse, WireMessage};

    #[test]
    fn room_ids() {
        let parse = |room_ids| {
            let wire = WireMessage::request(
                Source::Widget,
                "m.read_room_account_data",
                "r",
                json!({"type": "m.tag", "room_ids": room_ids}),
            );
            WidgetRequest::from_wire(&wire)
        };
        let Ok(WidgetRequest::ReadRoomAccountData { request }) = parse(json!("*")) else { panic!() };
        assert_eq!(request.room_ids, Some(RoomSelector::Any));
        assert_eq!(serde_json::to_value(&request).unwrap()["room_ids"], "*");
        let Ok(WidgetRequest::ReadRoomAccountData { request }) = parse(json!(["!a:x", "!b:x"])) else { panic!() };
        assert_eq!(request.room_ids, Some(RoomSelector::Rooms { room_ids: vec!["!a:x".into(), "!b:x".into()] }));
        assert_eq!(serde_json::to_value(&request).unwrap()["room_ids"], json!(["!a:x", "!b:x"]));
        assert!(matches!(parse(json!("!a:x")), Err(ActionError::InvalidBody { .. })));
        assert!(matches!(parse(json!([1])), Err(ActionError::InvalidBody { .. })));
    }

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::ReadRoomAccountData {
            request: ReadRoomAccountDataRequest { event_type: "m.tag".into(), room_ids: None },
        };
        let wire = req.clone().into_wire("a");
        assert_eq!(wire.action, "com.beeper.read_room_account_data");
        assert_eq!(wire.to_value()["request"], json!({"type": "m.tag"}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"events": [{"type": "m.tag", "room_id": "!r:x", "content": {"tags": {}}}]}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::ReadRoomAccountData {
                response: ReadRoomAccountDataResponse {
                    events: vec![RoomAccountData {
                        event_type: "m.tag".into(),
                        room_id: "!r:x".into(),
                        content: json!({"tags": {}}).into()
                    }]
                }
            }
        );
    }
}
