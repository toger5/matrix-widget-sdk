//! Shared matrix types: Matrix objects used in widget action bodies *and* outside of them (backend
//! trait, driver callbacks, widget client). Types that only ever appear as the body of one action
//! live with that action under `actions/`.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
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

/// Which state keys a `read_events` request is interested in.
///
/// On the wire this is either a string (one state key) or the boolean `true` (all state keys),
/// following MSC2876.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum StateKeySelector {
    Any,
    Key { key: String },
}

impl StateKeySelector {
    pub fn key(key: impl Into<String>) -> Self {
        Self::Key { key: key.into() }
    }

    pub fn matches(&self, state_key: &str) -> bool {
        match self {
            StateKeySelector::Any => true,
            StateKeySelector::Key { key } => key == state_key,
        }
    }
}

impl Serialize for StateKeySelector {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            StateKeySelector::Any => s.serialize_bool(true),
            StateKeySelector::Key { key } => s.serialize_str(key),
        }
    }
}

impl<'de> Deserialize<'de> for StateKeySelector {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        match Value::deserialize(d)? {
            Value::Bool(true) => Ok(StateKeySelector::Any),
            Value::String(key) => Ok(StateKeySelector::Key { key }),
            other => Err(D::Error::custom(format!("state_key must be a string or `true`, got {other}"))),
        }
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
}
