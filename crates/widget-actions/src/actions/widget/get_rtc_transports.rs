//! `org.matrix.msc4515.get_rtc_transports` (MSC4515), widget -> host: the homeserver's
//! MatrixRTC transports (`GET /_matrix/client/v1/rtc/transports`).
//!
//! Empty request body, answered with [`RtcTransportsResponse`]. Requires
//! `org.matrix.msc4515.rtc_transports`.

use serde::{Deserialize, Serialize};

use crate::JsonValue;

/// Response to `get_rtc_transports`: each transport is `{ "type": ..., ...transport specific }`,
/// passed through as the homeserver sent it.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RtcTransportsResponse {
    pub rtc_transports: Vec<JsonValue>,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{Source, WidgetRequest, WidgetResponse, WireMessage};

    #[test]
    fn roundtrip() {
        let wire = WidgetRequest::GetRtcTransports.into_wire("r");
        assert_eq!(wire.action, "org.matrix.msc4515.get_rtc_transports");
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::GetRtcTransports);
        let plain = WireMessage::request(Source::Widget, "get_rtc_transports", "r", json!({}));
        assert_eq!(WidgetRequest::from_wire(&plain).unwrap(), WidgetRequest::GetRtcTransports);

        let transport = json!({"type": "livekit", "livekit_service_url": "https://lk.example.org"});
        let res = wire.response_to(json!({"rtc_transports": [transport]}));
        assert_eq!(
            WidgetResponse::from_wire(&res).unwrap(),
            WidgetResponse::GetRtcTransports {
                response: RtcTransportsResponse { rtc_transports: vec![transport.into()] }
            }
        );
    }
}
