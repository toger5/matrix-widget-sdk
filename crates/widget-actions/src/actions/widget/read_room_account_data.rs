//! `com.beeper.read_room_account_data` (Beeper extension), widget -> host: read room account
//! data of one type.
//!
//! Body: [`ReadRoomAccountDataRequest`], answered with [`ReadRoomAccountDataResponse`]. Requires
//! `com.beeper.capabilities.receive.room_account_data:<type>`; `room_ids` needs the
//! `timeline:<room>` capability per room, as for `read_events`.

use serde::{Deserialize, Serialize};

use crate::{RoomAccountData, RoomSelector};

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
    use crate::{WidgetRequest, WidgetResponse};

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
