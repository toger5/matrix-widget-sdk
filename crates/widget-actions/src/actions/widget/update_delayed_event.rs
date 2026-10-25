//! `org.matrix.msc4157.update_delayed_event` (MSC4157), widget -> host: cancel, restart or fire a
//! delayed event scheduled with `send_event` + `delay`.
//!
//! Body: [`UpdateDelayedEventRequest`], acknowledged with `{}`. Requires the
//! `org.matrix.msc4157.update_delayed_event` capability.

use serde::{Deserialize, Serialize};

/// What to do with a delayed event (MSC4140 `/delayed_events/{delay_id}` actions).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum UpdateDelayedEventAction {
    /// Drop the scheduled event.
    Cancel,
    /// Reset its timer to the original delay from now.
    Restart,
    /// Send it right now.
    Send,
}

/// Body of `update_delayed_event`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct UpdateDelayedEventRequest {
    /// The `delay_id` a `send_event` with `delay` returned.
    pub delay_id: String,
    pub action: UpdateDelayedEventAction,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{ActionError, Source, WidgetRequest, WidgetResponse, WireMessage};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::UpdateDelayedEvent {
            request: UpdateDelayedEventRequest { delay_id: "d1".into(), action: UpdateDelayedEventAction::Restart },
        };
        let wire = req.clone().into_wire("u");
        assert_eq!(wire.action, "org.matrix.msc4157.update_delayed_event");
        assert_eq!(wire.to_value()["request"], json!({"delay_id": "d1", "action": "restart"}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::UpdateDelayedEvent);

        let plain = WireMessage::request(
            Source::Widget,
            "update_delayed_event",
            "u",
            json!({"delay_id": "d", "action": "send"}),
        );
        assert!(matches!(WidgetRequest::from_wire(&plain).unwrap(), WidgetRequest::UpdateDelayedEvent { .. }));
        let bad =
            WireMessage::request(Source::Widget, "update_delayed_event", "u", json!({"delay_id": "d", "action": "x"}));
        assert!(matches!(WidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));
    }
}
