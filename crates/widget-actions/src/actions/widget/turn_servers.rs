//! `watch_turn_servers` / `unwatch_turn_servers` (MSC3846), widget -> host: start / stop
//! receiving the client's TURN server credentials.
//!
//! Both have an empty body and are acknowledged with `{}`. While watching, the host pushes
//! credentials as host -> widget `update_turn_servers` (`actions::host::update_turn_servers`).
//! Requires `town.robin.msc3846.turn_servers`.

#[cfg(test)]
mod tests {
    use serde_json::json;

    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        for (request, response, action) in [
            (WidgetRequest::WatchTurnServers, WidgetResponse::WatchTurnServers, "watch_turn_servers"),
            (WidgetRequest::UnwatchTurnServers, WidgetResponse::UnwatchTurnServers, "unwatch_turn_servers"),
        ] {
            let wire = request.clone().into_wire("t");
            assert_eq!(wire.action, action);
            assert_eq!(wire.to_value()["request"], json!({}));
            assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), request);
            assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), response);
        }
    }
}
