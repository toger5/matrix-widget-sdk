//! `org.matrix.msc3869.read_relations` (MSC3869), widget -> host: read the events relating to
//! one event (`GET /rooms/{roomId}/relations/{eventId}[/{relType}[/{eventType}]]`).
//!
//! Body: [`ReadRelationsRequest`], answered with [`ReadRelationsResponse`]. No capability of its
//! own: the host filters the result by the widget's `receive.*` capabilities (and `room_id`
//! needs the `timeline:<room>` capability, as for `send_event`).

use serde::{Deserialize, Serialize};

use crate::MatrixEvent;

/// Pagination direction of a relations read, as the client-server API spells it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum RelationDirection {
    #[serde(rename = "f")]
    Forward,
    #[serde(rename = "b")]
    Backward,
}

/// Body of `read_relations`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadRelationsRequest {
    /// The event whose relations to read.
    pub event_id: String,
    /// Only relations of this `rel_type` (e.g. `m.annotation`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rel_type: Option<String>,
    /// Only relating events of this type. Requires `rel_type`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_type: Option<String>,
    /// The room; the widget's own room when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub room_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
    /// Pagination tokens from an earlier response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub to: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<RelationDirection>,
}

impl ReadRelationsRequest {
    pub fn new(event_id: impl Into<String>) -> Self {
        Self {
            event_id: event_id.into(),
            rel_type: None,
            event_type: None,
            room_id: None,
            limit: None,
            from: None,
            to: None,
            direction: None,
        }
    }
}

/// Response to `read_relations`: one page of relating events.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadRelationsResponse {
    pub chunk: Vec<MatrixEvent>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_batch: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prev_batch: Option<String>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::actions::test_event;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let mut request = ReadRelationsRequest::new("$e");
        request.rel_type = Some("m.annotation".into());
        request.limit = Some(3);
        request.direction = Some(RelationDirection::Backward);
        let req = WidgetRequest::ReadRelations { request };
        let wire = req.clone().into_wire("r");
        assert_eq!(wire.action, "org.matrix.msc3869.read_relations");
        assert_eq!(
            wire.to_value()["request"],
            json!({"event_id": "$e", "rel_type": "m.annotation", "limit": 3, "direction": "b"})
        );
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"chunk": [test_event()], "next_batch": "n"}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::ReadRelations {
                response: ReadRelationsResponse {
                    chunk: vec![test_event()],
                    next_batch: Some("n".into()),
                    prev_batch: None
                }
            }
        );
    }
}
