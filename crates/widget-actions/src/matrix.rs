//! Shared matrix types: Matrix objects used in widget action bodies *and* outside of them (backend
//! trait, driver callbacks, widget client). Types that only ever appear as the body of one action
//! live with that action under `actions/`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ActionError, JsonValue};

/// A Matrix room event as exchanged with widgets (the client-server API event JSON).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct MatrixEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub sender: String,
    pub event_id: String,
    pub room_id: String,
    pub origin_server_ts: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_key: Option<String>,
    pub content: JsonValue,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unsigned: Option<JsonValue>,
}

impl MatrixEvent {
    pub fn is_state(&self) -> bool {
        self.state_key.is_some()
    }

    pub fn from_value(value: Value) -> Result<Self, serde_json::Error> {
        serde_json::from_value(value)
    }

    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("MatrixEvent is serializable")
    }
}

/// Parse an event from its client-server API JSON (`{"type": ..., "content": ...}`), the shape a
/// host already has in hand. Mainly for foreign code, where [`MatrixEvent`] is a record with
/// differently named fields.
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn matrix_event_from_json(json: String) -> Result<MatrixEvent, ActionError> {
    serde_json::from_str(&json).map_err(ActionError::malformed)
}

/// The client-server API JSON of an event, the inverse of [`matrix_event_from_json`].
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn matrix_event_to_json(event: MatrixEvent) -> String {
    event.to_value().to_string()
}

/// A to-device message as delivered to widgets (MSC3819): the message plus whether it arrived
/// Olm-encrypted. Used by the host's `send_to_device` action and by the backend's to-device
/// subscription.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ToDeviceEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    pub sender: String,
    pub content: JsonValue,
    /// Whether the message was encrypted on the wire.
    pub encrypted: bool,
}

/// TURN server credentials (MSC3846 `update_turn_servers`), the shape of `GET /voip/turnServer`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TurnServer {
    pub uris: Vec<String>,
    pub username: String,
    pub password: String,
}

/// One room account data event (`com.beeper.read_room_account_data`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RoomAccountData {
    #[serde(rename = "type")]
    pub event_type: String,
    pub room_id: String,
    pub content: JsonValue,
}

/// A Matrix OpenID token (MSC1960), as returned by
/// `POST /_matrix/client/v3/user/{userId}/openid/request_token`, and the response of `get_openid`.
/// Same shape as matrix-rust-rtc's.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct OpenIdToken {
    pub access_token: String,
    /// `Bearer`.
    pub token_type: String,
    /// The homeserver that issued the token and will answer `/openid/userinfo` for it.
    pub matrix_server_name: String,
    /// Seconds until the token expires.
    pub expires_in: u64,
}

/// The pagination status of the room's timeline cache (MSCXXXX, `spec/patch/new/timeline-reading.md`):
/// in `read_timeline`, `paginate_timeline` and `notify_timeline_update`, and in the backend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum PaginationStatus {
    /// The cache does not reach the start of the room, and no pagination is running.
    #[default]
    Idle,
    /// The client is fetching older events from the homeserver.
    Paginating,
    /// The cache contains the room's first event.
    StartReached,
}

/// One entry of the `filter` of `read_timeline`: an event type, for `m.room.message` optionally
/// one `msgtype`. Also what the backend filters the timeline cache with.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TimelineFilter {
    #[serde(rename = "type")]
    pub event_type: String,
    /// Only for `m.room.message`: only events with this `msgtype`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub msgtype: Option<String>,
}

impl TimelineFilter {
    pub fn new(event_type: impl Into<String>, msgtype: Option<impl Into<String>>) -> Self {
        Self { event_type: event_type.into(), msgtype: msgtype.map(Into::into) }
    }

    /// Whether `event` matches: same type, and the same `msgtype` if the filter names one.
    pub fn matches(&self, event: &MatrixEvent) -> bool {
        self.event_type == event.event_type
            && self.msgtype.as_deref().is_none_or(|m| event.content.0.get("msgtype").and_then(Value::as_str) == Some(m))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn event_roundtrip() {
        let ev = json!({
            "type": "m.room.topic", "sender": "@a:b", "event_id": "$e", "room_id": "!r:b",
            "origin_server_ts": 12, "state_key": "", "content": {"topic": "t"}
        });
        let parsed = MatrixEvent::from_value(ev.clone()).unwrap();
        assert!(parsed.is_state());
        assert_eq!(parsed.to_value(), ev);
    }

    #[test]
    fn timeline_filter_matches_type_and_msgtype() {
        let event = |t: &str, content| MatrixEvent {
            event_type: t.into(),
            sender: "@a:b".into(),
            event_id: "$e".into(),
            room_id: "!r:b".into(),
            origin_server_ts: 1,
            state_key: None,
            content: JsonValue(content),
            unsigned: None,
        };
        let text = event("m.room.message", json!({"msgtype": "m.text"}));
        assert!(TimelineFilter::new("m.room.message", None::<&str>).matches(&text));
        assert!(TimelineFilter::new("m.room.message", Some("m.text")).matches(&text));
        assert!(!TimelineFilter::new("m.room.message", Some("m.image")).matches(&text));
        assert!(!TimelineFilter::new("m.room.message", Some("m.text")).matches(&event("m.room.message", json!({}))));
        assert!(!TimelineFilter::new("m.reaction", None::<&str>).matches(&text));
        assert_eq!(serde_json::to_value(PaginationStatus::StartReached).unwrap(), "start_reached");
    }
}
