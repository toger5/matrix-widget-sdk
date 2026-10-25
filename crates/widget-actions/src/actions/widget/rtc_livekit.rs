//! MSC4533, widget -> host: let the client's LiveKit integration act for a MatrixRTC session.
//!
//! * `org.matrix.msc4533.rtc_livekit_get_token`: [`RtcLivekitGetTokenRequest`] ->
//!   [`RtcLivekitGetTokenResponse`]; requires `org.matrix.msc4533.rtc_livekit_get_token`.
//! * `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave`:
//!   [`RtcLivekitDelegateDelayedLeaveRequest`] -> `{}`; requires
//!   `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave`.
//!
//! Both actions of the MSC share this file because they share every field but one.

use serde::{Deserialize, Serialize};

/// Body of `rtc_livekit_get_token`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RtcLivekitGetTokenRequest {
    /// The homeserver hosting the MatrixRTC session.
    pub server_name: String,
    /// The LiveKit SFU to obtain a token for.
    pub url: String,
    /// The room the session belongs to.
    pub room_id: String,
    /// The MatrixRTC session (slot) to join.
    pub slot_id: String,
    /// The `member.id` of the `m.rtc.member` event.
    pub member_id: String,
}

/// Response to `rtc_livekit_get_token`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RtcLivekitGetTokenResponse {
    /// The JWT to authenticate against the SFU with.
    pub jwt: String,
}

/// Body of `rtc_livekit_delegate_delayed_leave`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Record))]
pub struct RtcLivekitDelegateDelayedLeaveRequest {
    /// The WebSocket URL of the LiveKit SFU the user is connected to.
    pub url: String,
    pub room_id: String,
    pub slot_id: String,
    pub member_id: String,
    /// The delayed leave event to hand over to the SFU's service.
    pub delay_id: String,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::{WidgetRequest, WidgetResponse};

    #[test]
    fn roundtrip() {
        let req = WidgetRequest::RtcLivekitGetToken {
            request: RtcLivekitGetTokenRequest {
                server_name: "example.org".into(),
                url: "https://lk.example.org".into(),
                room_id: "!r:x".into(),
                slot_id: "s".into(),
                member_id: "m".into(),
            },
        };
        let wire = req.clone().into_wire("l");
        assert_eq!(wire.action, "org.matrix.msc4533.rtc_livekit_get_token");
        assert_eq!(wire.to_value()["request"]["slot_id"], "s");
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(
            WidgetResponse::from_wire(&wire.response_to(json!({"jwt": "j"}))).unwrap(),
            WidgetResponse::RtcLivekitGetToken { response: RtcLivekitGetTokenResponse { jwt: "j".into() } }
        );

        let req = WidgetRequest::RtcLivekitDelegateDelayedLeave {
            request: RtcLivekitDelegateDelayedLeaveRequest {
                url: "wss://lk.example.org".into(),
                room_id: "!r:x".into(),
                slot_id: "s".into(),
                member_id: "m".into(),
                delay_id: "d".into(),
            },
        };
        let wire = req.clone().into_wire("l2");
        assert_eq!(wire.action, "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave");
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), req);
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::RtcLivekitDelegateDelayedLeave);
    }
}
