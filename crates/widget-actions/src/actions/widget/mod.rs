//! Actions initiated by the widget (`source: widget`): one file per action plus the two enums
//! that dispatch over them.
//!
//! The enums are serde *internally tagged* on `action`; their serde shape is the action part of
//! the envelope (`{ "action": ..., "request": ... }` or `"response"`), not the full
//! [`WireMessage`]. Converting between the two goes through `from_wire` / `into_wire`.
//!
//! Conventions that keep this file free of per-action logic:
//!
//! * one variant per action, `#[serde(rename = "<action>")]`, a unit variant when the body is `{}`.
//!   The `rename` is the name **emitted** on the wire: the MSC's unstable spelling where the
//!   action has one (`org.matrix.msc2876.read_events`), so that a wrongly designed action can be
//!   renamed later. Other spellings (the prefix-less future stable name, a legacy name) are
//!   accepted on input through `alias`;
//! * a trailing `#[serde(other)] Unknown` unit variant catches unknown *tags* only, so a known
//!   action with a malformed body is still an [`ActionError::InvalidBody`];
//! * no `#[serde(untagged)]` anywhere: it would swallow body errors.

use serde::{Deserialize, Serialize};

use super::{expect, parse_tagged, split_tagged};
use crate::{
    ActionError, ClientContextResponse, GetOpenIdResponse, MatrixContextResponse, MediaConfigResponse, NavigateRequest,
    ReadEventsRequest, ReadEventsResponse, ReadRelationsRequest, ReadRelationsResponse, ReadRoomAccountDataRequest,
    ReadRoomAccountDataResponse, RequestCapabilitiesRequest, RtcLivekitDelegateDelayedLeaveRequest,
    RtcLivekitGetTokenRequest, RtcLivekitGetTokenResponse, RtcTransportsResponse, SendEventRequest, SendEventResponse,
    SendToDeviceRequest, SetAlwaysOnScreenRequest, SetAlwaysOnScreenResponse, Source, StickerRequest,
    UpdateDelayedEventRequest, UserDirectorySearchRequest, UserDirectorySearchResponse, WireMessage,
};

pub(crate) mod client_context;
pub(crate) mod content_loaded;
pub(crate) mod get_media_config;
pub(crate) mod get_openid;
pub(crate) mod get_rtc_transports;
pub(crate) mod matrix_context;
pub(crate) mod navigate;
pub(crate) mod read_events;
pub(crate) mod read_relations;
pub(crate) mod read_room_account_data;
pub(crate) mod request_capabilities;
pub(crate) mod rtc_livekit;
pub(crate) mod send_event;
pub(crate) mod send_to_device;
pub(crate) mod set_always_on_screen;
pub(crate) mod sticker;
pub(crate) mod turn_servers;
pub(crate) mod update_delayed_event;
pub(crate) mod user_directory_search;

/// A request sent by the widget (`source: widget`, has `request`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum WidgetRequest {
    /// The widget finished loading and may be shown. (always allowed)
    #[serde(rename = "content_loaded")]
    ContentLoaded,
    /// Ask the host for capabilities. (always allowed)
    #[serde(rename = "request_capabilities", alias = "org.matrix.msc2974.request_capabilities")]
    RequestCapabilities { request: RequestCapabilitiesRequest },
    /// Send an event to the room. Requires a `send.*` capability.
    #[serde(rename = "send_event")]
    SendEvent { request: SendEventRequest },
    /// Send a to-device message. Requires `org.matrix.msc3819.send.to_device:<type>`.
    #[serde(rename = "send_to_device")]
    SendToDevice { request: SendToDeviceRequest },
    /// Read events from the room. Requires a `receive.*` capability.
    #[serde(rename = "org.matrix.msc2876.read_events", alias = "read_events")]
    ReadEvents { request: ReadEventsRequest },
    /// Read the events relating to one event. Results are filtered by the `receive.*` capabilities.
    #[serde(rename = "org.matrix.msc3869.read_relations", alias = "read_relations")]
    ReadRelations { request: ReadRelationsRequest },
    /// Cancel / restart / fire a delayed event. Requires `org.matrix.msc4157.update_delayed_event`.
    #[serde(rename = "org.matrix.msc4157.update_delayed_event", alias = "update_delayed_event")]
    UpdateDelayedEvent { request: UpdateDelayedEventRequest },
    /// Ask for an OpenID token (MSC1960). No capability; the user may be asked.
    #[serde(rename = "get_openid")]
    GetOpenId,
    /// Start receiving TURN credentials (`update_turn_servers`). Requires `town.robin.msc3846.turn_servers`.
    #[serde(rename = "watch_turn_servers")]
    WatchTurnServers,
    /// Stop receiving TURN credentials.
    #[serde(rename = "unwatch_turn_servers")]
    UnwatchTurnServers,
    /// The homeserver's MatrixRTC transports. Requires `org.matrix.msc4515.rtc_transports`.
    #[serde(rename = "org.matrix.msc4515.get_rtc_transports", alias = "get_rtc_transports")]
    GetRtcTransports,
    /// Search the user directory. Requires `org.matrix.msc3973.user_directory_search`.
    #[serde(rename = "org.matrix.msc3973.user_directory_search", alias = "user_directory_search")]
    UserDirectorySearch { request: UserDirectorySearchRequest },
    /// The homeserver's media config. Requires `org.matrix.msc4039.upload_file`.
    #[serde(rename = "org.matrix.msc4039.get_media_config", alias = "get_media_config")]
    GetMediaConfig,
    /// Read room account data. Requires `com.beeper.capabilities.receive.room_account_data:<type>`.
    #[serde(rename = "com.beeper.read_room_account_data", alias = "read_room_account_data")]
    ReadRoomAccountData { request: ReadRoomAccountDataRequest },
    /// A LiveKit token for a MatrixRTC session. Requires `org.matrix.msc4533.rtc_livekit_get_token`.
    #[serde(rename = "org.matrix.msc4533.rtc_livekit_get_token", alias = "rtc_livekit_get_token")]
    RtcLivekitGetToken { request: RtcLivekitGetTokenRequest },
    /// Hand a delayed leave over to the LiveKit service. Requires
    /// `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave`.
    #[serde(
        rename = "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave",
        alias = "rtc_livekit_delegate_delayed_leave"
    )]
    RtcLivekitDelegateDelayedLeave { request: RtcLivekitDelegateDelayedLeaveRequest },
    /// Ask the client to open a `matrix.to` permalink. Requires `org.matrix.msc2931.navigate`.
    #[serde(rename = "org.matrix.msc2931.navigate", alias = "navigate")]
    Navigate { request: NavigateRequest },
    /// Ask the client to send a sticker. Requires `m.sticker`.
    #[serde(rename = "m.sticker")]
    SendSticker { request: StickerRequest },
    /// Ask the client to keep the widget on screen. Requires `m.always_on_screen`.
    #[serde(rename = "set_always_on_screen")]
    SetAlwaysOnScreen { request: SetAlwaysOnScreenRequest },
    /// Who and where the widget is on Matrix. Requires `m.matrix_context`.
    #[serde(rename = "org.matrix.msc4412.matrix_context", alias = "matrix_context")]
    MatrixContext,
    /// Facts about the embedding client. Requires `m.client_context`.
    #[serde(rename = "org.matrix.msc4412.client_context", alias = "client_context")]
    ClientContext,
    /// An action this crate does not know. The [`WireMessage`] it was parsed from carries the
    /// action string and the raw body. Serializing it yields the placeholder action `Unknown`.
    #[serde(other)]
    Unknown,
}

/// The host's response to a [`WidgetRequest`] (`source: widget`, has `response`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum WidgetResponse {
    /// `{}`
    #[serde(rename = "content_loaded")]
    ContentLoaded,
    /// `{}`; the decision arrives later as [`HostRequest::NotifyCapabilities`](crate::HostRequest::NotifyCapabilities).
    #[serde(rename = "request_capabilities", alias = "org.matrix.msc2974.request_capabilities")]
    RequestCapabilities,
    #[serde(rename = "send_event")]
    SendEvent { response: SendEventResponse },
    /// `{}`
    #[serde(rename = "send_to_device")]
    SendToDevice,
    #[serde(rename = "org.matrix.msc2876.read_events", alias = "read_events")]
    ReadEvents { response: ReadEventsResponse },
    #[serde(rename = "org.matrix.msc3869.read_relations", alias = "read_relations")]
    ReadRelations { response: ReadRelationsResponse },
    /// `{}`
    #[serde(rename = "org.matrix.msc4157.update_delayed_event", alias = "update_delayed_event")]
    UpdateDelayedEvent,
    #[serde(rename = "get_openid")]
    GetOpenId { response: GetOpenIdResponse },
    /// `{}`
    #[serde(rename = "watch_turn_servers")]
    WatchTurnServers,
    /// `{}`
    #[serde(rename = "unwatch_turn_servers")]
    UnwatchTurnServers,
    #[serde(rename = "org.matrix.msc4515.get_rtc_transports", alias = "get_rtc_transports")]
    GetRtcTransports { response: RtcTransportsResponse },
    #[serde(rename = "org.matrix.msc3973.user_directory_search", alias = "user_directory_search")]
    UserDirectorySearch { response: UserDirectorySearchResponse },
    #[serde(rename = "org.matrix.msc4039.get_media_config", alias = "get_media_config")]
    GetMediaConfig { response: MediaConfigResponse },
    #[serde(rename = "com.beeper.read_room_account_data", alias = "read_room_account_data")]
    ReadRoomAccountData { response: ReadRoomAccountDataResponse },
    #[serde(rename = "org.matrix.msc4533.rtc_livekit_get_token", alias = "rtc_livekit_get_token")]
    RtcLivekitGetToken { response: RtcLivekitGetTokenResponse },
    /// `{}`
    #[serde(
        rename = "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave",
        alias = "rtc_livekit_delegate_delayed_leave"
    )]
    RtcLivekitDelegateDelayedLeave,
    /// `{}`
    #[serde(rename = "org.matrix.msc2931.navigate", alias = "navigate")]
    Navigate,
    /// `{}`
    #[serde(rename = "m.sticker")]
    SendSticker,
    #[serde(rename = "set_always_on_screen")]
    SetAlwaysOnScreen { response: SetAlwaysOnScreenResponse },
    #[serde(rename = "org.matrix.msc4412.matrix_context", alias = "matrix_context")]
    MatrixContext { response: MatrixContextResponse },
    #[serde(rename = "org.matrix.msc4412.client_context", alias = "client_context")]
    ClientContext { response: ClientContextResponse },
    /// A response to an action this crate does not know; the raw body is in the [`WireMessage`].
    #[serde(other)]
    Unknown,
}

impl WidgetRequest {
    /// Wrap into a wire envelope with the given request id.
    pub fn into_wire(self, request_id: impl Into<String>) -> WireMessage {
        let (action, body) = split_tagged(&self);
        WireMessage::request(Source::Widget, action, request_id, body)
    }

    /// Interpret a wire envelope as a widget request.
    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Widget, true)?;
        parse_tagged(msg)
    }
}

impl WidgetResponse {
    /// Build the success reply envelope for `request` (see [`WireMessage::response_to`]). Error
    /// replies are built with [`WireMessage::error_response_to`].
    pub fn into_wire_reply(self, request: &WireMessage) -> WireMessage {
        request.response_to(split_tagged(&self).1)
    }

    /// Interpret the response found in `msg`. An error response is
    /// [`ActionError::ErrorResponse`].
    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Widget, false)?;
        if let Some(error) = msg.error() {
            return Err(ActionError::ErrorResponse { error });
        }
        parse_tagged(msg)
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;
    use crate::WidgetError;

    #[test]
    fn widget_unknown_and_errors() {
        let wire = WireMessage::request(Source::Widget, "org.example.custom", "r", json!({"a": 1}));
        assert_eq!(WidgetRequest::from_wire(&wire).unwrap(), WidgetRequest::Unknown);
        assert_eq!(wire.action, "org.example.custom");
        assert_eq!(wire.request_body(), json!({"a": 1}));
        assert_eq!(WidgetResponse::from_wire(&wire.ack()).unwrap(), WidgetResponse::Unknown);

        let err = wire.error_response_to(WidgetError::new("denied"));
        assert_eq!(
            WidgetResponse::from_wire(&err),
            Err(ActionError::ErrorResponse { error: WidgetError::new("denied") })
        );

        // A *known* action with a malformed body is an InvalidBody, never Unknown.
        let bad = WireMessage::request(Source::Widget, "send_event", "b", json!({"type": 5}));
        assert!(matches!(WidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));

        let host_msg = WireMessage::request(Source::Host, "send_event", "r", json!({}));
        assert!(matches!(WidgetRequest::from_wire(&host_msg), Err(ActionError::WrongSource { .. })));
        assert!(matches!(WidgetRequest::from_wire(&wire.ack()), Err(ActionError::WrongDirection { .. })));

        // Serializing Unknown does not panic; it carries a placeholder action.
        let placeholder = WidgetRequest::Unknown.into_wire("x");
        assert_eq!(placeholder.action, "Unknown");
        assert_eq!(placeholder.request_body(), json!({}));
    }
}
