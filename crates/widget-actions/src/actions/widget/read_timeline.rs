//! `org.matrix.mscXXXX.read_timeline` (MSCXXXX draft, `spec/patch/new/timeline-reading.md`),
//! widget -> host: read events from the client's timeline cache, newest first. Never contacts
//! the homeserver.
//!
//! Body: [`ReadTimelineRequest`], answered with [`ReadTimelineResponse`]. Requires
//! `widget:…read_timeline:<type>[#<msgtype>]`; only events the widget holds such a capability for
//! are returned. `from` not in the cache is the error `…event_not_cached`.

use serde::{Deserialize, Serialize};

use crate::{MatrixEvent, PaginationStatus, TimelineFilter};

/// Body of `read_timeline`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadTimelineRequest {
    /// Start with the event older than this one (exclusive); the newest event of the cache when
    /// absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub from: Option<String>,
    /// The largest number of events to return. Hosts may clamp it.
    pub limit: u32,
    /// The events to return; every event the widget may read when absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filter: Option<Vec<TimelineFilter>>,
}

impl ReadTimelineRequest {
    /// The newest `limit` events the widget may read.
    pub fn newest(limit: u32) -> Self {
        Self { from: None, limit, filter: None }
    }
}

/// Response to `read_timeline`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct ReadTimelineResponse {
    /// Newest first. Fewer than `limit`: the cache has no more matching events below the last one.
    pub events: Vec<MatrixEvent>,
    /// The pagination status at the time of the answer.
    pub pagination: PaginationStatus,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::actions::test_event;
    use crate::{ActionError, Source, WidgetRequest, WidgetResponse, WireMessage};

    #[test]
    fn roundtrip() {
        let request = ReadTimelineRequest {
            from: Some("$old".into()),
            limit: 50,
            filter: Some(vec![
                TimelineFilter::new("m.room.message", Some("m.text")),
                TimelineFilter::new("m.reaction", None::<&str>),
            ]),
        };
        let req = WidgetRequest::ReadTimeline { request };
        let wire = req.clone().into_wire("r");
        assert_eq!(wire.action, "org.matrix.mscXXXX.read_timeline");
        assert_eq!(
            wire.to_value()["request"],
            json!({"from": "$old", "limit": 50, "filter": [{"type": "m.room.message", "msgtype": "m.text"}, {"type": "m.reaction"}]})
        );
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"events": [test_event()], "pagination": "start_reached"}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::ReadTimeline {
                response: ReadTimelineResponse {
                    events: vec![test_event()],
                    pagination: PaginationStatus::StartReached
                }
            }
        );
    }

    #[test]
    fn minimal_and_invalid_bodies() {
        let wire = WireMessage::request(Source::Widget, "m.read_timeline", "r", json!({"limit": 5}));
        assert_eq!(
            WidgetRequest::from_wire(&wire).unwrap(),
            WidgetRequest::ReadTimeline { request: ReadTimelineRequest::newest(5) }
        );
        assert_eq!(
            WidgetRequest::ReadTimeline { request: ReadTimelineRequest::newest(5) }.into_wire("r").to_value()
                ["request"],
            json!({"limit": 5})
        );
        for bad in [json!({}), json!({"limit": -1}), json!({"limit": 5, "filter": [{"msgtype": "m.text"}]})] {
            let wire = WireMessage::request(Source::Widget, "org.matrix.mscXXXX.read_timeline", "r", bad.clone());
            assert!(matches!(WidgetRequest::from_wire(&wire), Err(ActionError::InvalidBody { .. })), "{bad}");
        }
        let paginating = wire.response_to(json!({"events": [], "pagination": "paginating"}));
        let WidgetResponse::ReadTimeline { response } = WidgetResponse::from_wire(&paginating).unwrap() else {
            panic!()
        };
        assert_eq!(response.pagination, PaginationStatus::Paginating);
        assert_eq!(serde_json::to_value(PaginationStatus::Idle).unwrap(), "idle");
    }
}
