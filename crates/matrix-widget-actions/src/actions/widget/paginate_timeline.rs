//! `org.matrix.mscXXXX.paginate_timeline` (MSCXXXX draft, `spec/patch/new/timeline-reading.md`),
//! widget -> host: ask the client to extend its timeline cache backwards.
//!
//! Body: [`PaginateTimelineRequest`], answered at once with [`PaginateTimelineResponse`] (what
//! the client did); the outcome follows with `notify_timeline_update`. Requires
//! `widget:…paginate_timeline`.

use serde::{Deserialize, Serialize};

use crate::PaginationStatus;

/// Body of `paginate_timeline`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PaginateTimelineRequest {
    /// A hint for how many events to fetch; the client may fetch more or fewer.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

/// Response to `paginate_timeline`: `paginating`, or `start_reached` when there is nothing older.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct PaginateTimelineResponse {
    pub pagination: PaginationStatus,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{Source, WidgetRequest, WidgetResponse, WireMessage};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::PaginateTimeline { request: PaginateTimelineRequest { limit: Some(50) } };
        let wire = req.clone().into_wire("p");
        assert_eq!(wire.action, "org.matrix.mscXXXX.paginate_timeline");
        assert_eq!(wire.to_value()["request"], json!({"limit": 50}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);

        let res = wire.response_to(json!({"pagination": "paginating"}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::PaginateTimeline {
                response: PaginateTimelineResponse { pagination: PaginationStatus::Paginating }
            }
        );

        let empty = WireMessage::request(Source::Widget, "m.paginate_timeline", "p", json!({}));
        assert_eq!(
            WidgetRequest::from_wire(&empty).unwrap(),
            WidgetRequest::PaginateTimeline { request: PaginateTimelineRequest::default() }
        );
    }
}
