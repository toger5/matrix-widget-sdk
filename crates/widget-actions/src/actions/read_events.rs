//! `read_events` (MSC2876), widget -> host.
//!
//! Read timeline or state events from the room. Body: [`ReadEventsRequest`], answered with
//! [`ReadEventsResponse`]. Requires a `receive.*` capability.

use serde::{de::Error as _, Deserialize, Deserializer, Serialize, Serializer};
use serde_json::Value;

use crate::MatrixEvent;

/// Wire name of the action.
pub const ACTION: &str = "read_events";

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

/// Body of `read_events`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadEventsRequest {
    #[serde(rename = "type")]
    pub event_type: String,
    /// `None` reads timeline events, `Some` reads state events.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub state_key: Option<StateKeySelector>,
    /// Maximum number of events. Hosts may clamp this.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

impl ReadEventsRequest {
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
    use crate::{ActionError, FromWidgetRequest, FromWidgetResponse, Source, WireMessage};

    #[test]
    fn state_key_selector() {
        let wire = WireMessage::request(
            Source::Widget,
            ACTION,
            "r",
            json!({"type": "m.room.member", "state_key": true, "limit": 5}),
        );
        match FromWidgetRequest::from_wire(&wire).unwrap() {
            FromWidgetRequest::ReadEvents { request } => {
                assert_eq!(request.state_key, Some(StateKeySelector::Any));
                assert_eq!(request.limit, Some(5));
                assert_eq!(serde_json::to_value(&request).unwrap()["state_key"], true);
            }
            other => panic!("{other:?}"),
        }

        let wire =
            WireMessage::request(Source::Widget, ACTION, "r", json!({"type": "m.room.member", "state_key": "@a:b"}));
        let FromWidgetRequest::ReadEvents { request } = FromWidgetRequest::from_wire(&wire).unwrap() else { panic!() };
        assert_eq!(request.state_key, Some(StateKeySelector::key("@a:b")));

        let bad = WireMessage::request(Source::Widget, ACTION, "r", json!({"type": "x", "state_key": 5}));
        assert!(matches!(FromWidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));
    }

    #[test]
    fn response_roundtrip() {
        let req = FromWidgetRequest::ReadEvents {
            request: ReadEventsRequest { event_type: "m.room.message".into(), state_key: None, limit: Some(1) },
        };
        let wire = req.into_wire("r");
        let res = wire.response_to(json!({"events": [test_event()]}));
        assert_eq!(
            FromWidgetResponse::from_wire(&res).unwrap(),
            FromWidgetResponse::ReadEvents { response: ReadEventsResponse { events: vec![test_event()] } }
        );
    }
}
