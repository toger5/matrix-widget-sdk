//! `read_events` (MSC2876), widget -> host.
//!
//! Read timeline or state events from the room. Body: [`ReadEventsRequest`], answered with
//! [`ReadEventsResponse`]. Requires a `receive.*` capability.

use serde::{Deserialize, Serialize};

use crate::{MatrixEvent, StateKeySelector};

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
    fn response_roundtrip() {
        let req = WidgetRequest::ReadEvents {
            request: ReadEventsRequest { event_type: "m.room.message".into(), state_key: None, limit: Some(1) },
        };
        let wire = req.into_wire("r");
        assert_eq!(wire.action, "org.matrix.msc2876.read_events");
        let res = wire.response_to(json!({"events": [test_event()]}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::ReadEvents { response: ReadEventsResponse { events: vec![test_event()] } }
        );
    }
}
