//! `org.matrix.mscXXXX.notify_timeline_update` (MSCXXXX draft, `spec/patch/new/timeline-reading.md`),
//! host -> widget: the timeline cache changed in a way `forward_event` does not cover. Carries no
//! events; the widget reads them with `read_timeline`. Needs `host:…notify_timeline_update`.
//!
//! Body: [`NotifyTimelineUpdateRequest`], acknowledged with `{}`.

use serde::{Deserialize, Serialize};

use crate::{PaginationStatus, WidgetError};

/// The new pagination status, with the error of a failed pagination (then the status is `idle`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct TimelinePagination {
    pub status: PaginationStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<WidgetError>,
}

/// Body of `notify_timeline_update`. Every part is optional.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct NotifyTimelineUpdateRequest {
    /// The pagination status changed; sent after fetched events are in the cache.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pagination: Option<TimelinePagination>,
    /// The cache is no longer continuous: read again without `from`.
    #[serde(default, skip_serializing_if = "is_false")]
    pub reset: bool,
    /// IDs of cached events that became decryptable and that the widget may read.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub decrypted: Vec<String>,
}

fn is_false(value: &bool) -> bool {
    !value
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{HostRequest, HostResponse, Source, WireMessage};

    #[test]
    fn roundtrip() {
        let req = HostRequest::NotifyTimelineUpdate {
            request: NotifyTimelineUpdateRequest {
                pagination: Some(TimelinePagination {
                    status: PaginationStatus::Idle,
                    error: Some(WidgetError::new("timeout")),
                }),
                reset: true,
                decrypted: vec!["$e".into()],
            },
        };
        let wire = req.clone().into_wire("n");
        assert_eq!(wire.action, "org.matrix.mscXXXX.notify_timeline_update");
        assert_eq!(
            wire.to_value()["request"],
            json!({
                "pagination": {"status": "idle", "error": {"code": "org.matrix.msc4412.unknown", "message": "timeout"}},
                "reset": true,
                "decrypted": ["$e"],
            })
        );
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::NotifyTimelineUpdate);

        // `reset: false` and an empty `decrypted` are left out.
        let only_status = HostRequest::NotifyTimelineUpdate {
            request: NotifyTimelineUpdateRequest {
                pagination: Some(TimelinePagination { status: PaginationStatus::StartReached, error: None }),
                ..Default::default()
            },
        };
        assert_eq!(
            only_status.into_wire("n").to_value()["request"],
            json!({"pagination": {"status": "start_reached"}})
        );
        let empty = WireMessage::request(Source::Host, "m.notify_timeline_update", "n", json!({}));
        assert_eq!(
            HostRequest::from_wire(&empty).unwrap(),
            HostRequest::NotifyTimelineUpdate { request: NotifyTimelineUpdateRequest::default() }
        );
    }
}
