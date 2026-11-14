//! Actions the widget starts (`source: widget`): one file per action, plus the two enums below
//! that list them all.
//!
//! The enums are serde-tagged on `action`. Their serde shape is only the action part of the
//! envelope, `{ "action": ..., "request" | "response": ... }`; `from_wire` / `into_wire` convert
//! to and from the full [`WireMessage`].
//!
//! Conventions (the host enums follow them too):
//!
//! * One variant per action. A body of `{}` is a unit variant.
//! * Every action is `<namespace>.<name>` (MSC4412 "Action naming").
//! * `#[serde(rename = "...")]` is the name this crate **sends**: the unstable spelling of the MSC
//!   that defines the action (`org.matrix.msc2876.read_events`; `org.matrix.msc4412` for the three
//!   core actions; the placeholder `org.matrix.mscXXXX` where no MSC exists yet).
//! * `alias` is the other name it **accepts**: the future stable name `m.<name>`. Names without a
//!   namespace and legacy names are not accepted; `packages/widget-compat-wrapper` translates them.
//! * The capability of an action embeds this exact name, see [`Capability`](crate::Capability).
//! * The last variant, `#[serde(other)] Unknown`, catches unknown action names only. A known
//!   action with a broken body is still an [`ActionError::InvalidBody`].
//! * No `#[serde(untagged)]`: it would hide body errors.

use serde::{Deserialize, Serialize};

use super::{expect, parse_tagged, split_tagged};
use crate::{
    ActionError, DelegateRtcLivekitDelayedLeaveRequest, DownloadFileRequest, DownloadFileResponse,
    GetClientContextResponse, GetMatrixContextResponse, GetOpenIdResponse, GetRtcLivekitTokenRequest,
    GetRtcLivekitTokenResponse, MediaConfigResponse, NavigateRequest, ReadEventsRequest, ReadEventsResponse,
    ReadRelationsRequest, ReadRelationsResponse, ReadRoomAccountDataRequest, ReadRoomAccountDataResponse,
    RequestCapabilitiesRequest, RtcTransportsResponse, SearchUserDirectoryRequest, SearchUserDirectoryResponse,
    SendEventRequest, SendEventResponse, SendToDeviceRequest, SetAlwaysOnScreenRequest, SetAlwaysOnScreenResponse,
    Source, UpdateDelayedEventRequest, UploadFileRequest, UploadFileResponse, WireMessage,
};

pub(crate) mod download_file;
pub(crate) mod get_client_context;
pub(crate) mod get_matrix_context;
pub(crate) mod get_media_config;
pub(crate) mod get_openid;
pub(crate) mod get_rtc_transports;
pub(crate) mod navigate;
pub(crate) mod notify_ready;
pub(crate) mod read_events;
pub(crate) mod read_relations;
pub(crate) mod read_room_account_data;
pub(crate) mod request_capabilities;
pub(crate) mod rtc_livekit;
pub(crate) mod search_user_directory;
pub(crate) mod send_event;
pub(crate) mod send_to_device;
pub(crate) mod set_always_on_screen;
pub(crate) mod turn_servers;
pub(crate) mod update_delayed_event;
pub(crate) mod upload_file;

/// A request sent by the widget (`source: widget`, has `request`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum WidgetRequest {
    /// The widget is ready to be shown. (core action, always allowed)
    #[serde(rename = "org.matrix.msc4412.notify_ready", alias = "m.notify_ready")]
    NotifyReady,
    /// Ask the host for (more) capabilities. (core action, always allowed)
    #[serde(rename = "org.matrix.msc4412.request_capabilities", alias = "m.request_capabilities")]
    RequestCapabilities { request: RequestCapabilitiesRequest },
    /// Send an event to the room. Requires a `widget:…send_event.*` capability.
    #[serde(rename = "org.matrix.mscXXXX.send_event", alias = "m.send_event")]
    SendEvent { request: SendEventRequest },
    /// Send a to-device message. Requires `widget:…send_to_device:<type>`.
    #[serde(rename = "org.matrix.mscXXXX.send_to_device", alias = "m.send_to_device")]
    SendToDevice { request: SendToDeviceRequest },
    /// Read events from the room. Requires a `widget:…read_events.*` capability.
    #[serde(rename = "org.matrix.msc2876.read_events", alias = "m.read_events")]
    ReadEvents { request: ReadEventsRequest },
    /// Read the events relating to one event. Results are filtered by the
    /// `widget:…read_relations:<type>` capabilities.
    #[serde(rename = "org.matrix.msc3869.read_relations", alias = "m.read_relations")]
    ReadRelations { request: ReadRelationsRequest },
    /// Cancel / restart / fire a delayed event. Requires `widget:…update_delayed_event`.
    #[serde(rename = "org.matrix.msc4157.update_delayed_event", alias = "m.update_delayed_event")]
    UpdateDelayedEvent { request: UpdateDelayedEventRequest },
    /// Ask for an OpenID token (MSC1960). Requires `widget:…get_openid`; the user may still be asked.
    #[serde(rename = "org.matrix.mscXXXX.get_openid", alias = "m.get_openid")]
    GetOpenId,
    /// Start receiving TURN credentials (`update_turn_servers`). Requires `host:…update_turn_servers`.
    #[serde(rename = "org.matrix.mscXXXX.watch_turn_servers", alias = "m.watch_turn_servers")]
    WatchTurnServers,
    /// Stop receiving TURN credentials.
    #[serde(rename = "org.matrix.mscXXXX.unwatch_turn_servers", alias = "m.unwatch_turn_servers")]
    UnwatchTurnServers,
    /// The homeserver's MatrixRTC transports. Requires `widget:…get_rtc_transports`.
    #[serde(rename = "org.matrix.msc4515.get_rtc_transports", alias = "m.get_rtc_transports")]
    GetRtcTransports,
    /// Search the user directory. Requires `widget:…search_user_directory`.
    #[serde(rename = "org.matrix.msc3973.search_user_directory", alias = "m.search_user_directory")]
    SearchUserDirectory { request: SearchUserDirectoryRequest },
    /// The homeserver's media config. Requires `widget:…get_media_config`.
    #[serde(rename = "org.matrix.msc4039.get_media_config", alias = "m.get_media_config")]
    GetMediaConfig,
    /// Upload a base64 file to the media repository. Requires `widget:…upload_file`.
    #[serde(rename = "org.matrix.msc4039.upload_file", alias = "m.upload_file")]
    UploadFile { request: UploadFileRequest },
    /// Download a file as base64. Requires `widget:…download_file`.
    #[serde(rename = "org.matrix.msc4039.download_file", alias = "m.download_file")]
    DownloadFile { request: DownloadFileRequest },
    /// Read room account data. Requires `widget:…read_room_account_data:<type>`.
    #[serde(rename = "com.beeper.read_room_account_data", alias = "m.read_room_account_data")]
    ReadRoomAccountData { request: ReadRoomAccountDataRequest },
    /// A LiveKit token for a MatrixRTC session. Requires `widget:…get_rtc_livekit_token`.
    #[serde(rename = "org.matrix.msc4533.get_rtc_livekit_token", alias = "m.get_rtc_livekit_token")]
    GetRtcLivekitToken { request: GetRtcLivekitTokenRequest },
    /// Hand a delayed leave over to the LiveKit service. Requires
    /// `widget:…delegate_rtc_livekit_delayed_leave`.
    #[serde(
        rename = "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave",
        alias = "m.delegate_rtc_livekit_delayed_leave"
    )]
    DelegateRtcLivekitDelayedLeave { request: DelegateRtcLivekitDelayedLeaveRequest },
    /// Ask the client to open a `matrix.to` permalink. Requires `widget:…navigate`.
    #[serde(rename = "org.matrix.msc2931.navigate", alias = "m.navigate")]
    Navigate { request: NavigateRequest },
    /// Ask the client to keep the widget on screen. Requires `widget:…set_always_on_screen`.
    #[serde(rename = "org.matrix.mscXXXX.set_always_on_screen", alias = "m.set_always_on_screen")]
    SetAlwaysOnScreen { request: SetAlwaysOnScreenRequest },
    /// Who and where the widget is on Matrix. Requires `widget:…get_matrix_context`.
    #[serde(rename = "org.matrix.mscXXXX.get_matrix_context", alias = "m.get_matrix_context")]
    GetMatrixContext,
    /// Facts about the embedding client. Requires `widget:…get_client_context`.
    #[serde(rename = "org.matrix.mscXXXX.get_client_context", alias = "m.get_client_context")]
    GetClientContext,
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
    #[serde(rename = "org.matrix.msc4412.notify_ready", alias = "m.notify_ready")]
    NotifyReady,
    /// `{}`; the decision arrives later as [`HostRequest::UpdateCapabilities`](crate::HostRequest::UpdateCapabilities).
    #[serde(rename = "org.matrix.msc4412.request_capabilities", alias = "m.request_capabilities")]
    RequestCapabilities,
    #[serde(rename = "org.matrix.mscXXXX.send_event", alias = "m.send_event")]
    SendEvent { response: SendEventResponse },
    /// `{}`
    #[serde(rename = "org.matrix.mscXXXX.send_to_device", alias = "m.send_to_device")]
    SendToDevice,
    #[serde(rename = "org.matrix.msc2876.read_events", alias = "m.read_events")]
    ReadEvents { response: ReadEventsResponse },
    #[serde(rename = "org.matrix.msc3869.read_relations", alias = "m.read_relations")]
    ReadRelations { response: ReadRelationsResponse },
    /// `{}`
    #[serde(rename = "org.matrix.msc4157.update_delayed_event", alias = "m.update_delayed_event")]
    UpdateDelayedEvent,
    #[serde(rename = "org.matrix.mscXXXX.get_openid", alias = "m.get_openid")]
    GetOpenId { response: GetOpenIdResponse },
    /// `{}`
    #[serde(rename = "org.matrix.mscXXXX.watch_turn_servers", alias = "m.watch_turn_servers")]
    WatchTurnServers,
    /// `{}`
    #[serde(rename = "org.matrix.mscXXXX.unwatch_turn_servers", alias = "m.unwatch_turn_servers")]
    UnwatchTurnServers,
    #[serde(rename = "org.matrix.msc4515.get_rtc_transports", alias = "m.get_rtc_transports")]
    GetRtcTransports { response: RtcTransportsResponse },
    #[serde(rename = "org.matrix.msc3973.search_user_directory", alias = "m.search_user_directory")]
    SearchUserDirectory { response: SearchUserDirectoryResponse },
    #[serde(rename = "org.matrix.msc4039.get_media_config", alias = "m.get_media_config")]
    GetMediaConfig { response: MediaConfigResponse },
    #[serde(rename = "org.matrix.msc4039.upload_file", alias = "m.upload_file")]
    UploadFile { response: UploadFileResponse },
    #[serde(rename = "org.matrix.msc4039.download_file", alias = "m.download_file")]
    DownloadFile { response: DownloadFileResponse },
    #[serde(rename = "com.beeper.read_room_account_data", alias = "m.read_room_account_data")]
    ReadRoomAccountData { response: ReadRoomAccountDataResponse },
    #[serde(rename = "org.matrix.msc4533.get_rtc_livekit_token", alias = "m.get_rtc_livekit_token")]
    GetRtcLivekitToken { response: GetRtcLivekitTokenResponse },
    /// `{}`
    #[serde(
        rename = "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave",
        alias = "m.delegate_rtc_livekit_delayed_leave"
    )]
    DelegateRtcLivekitDelayedLeave,
    /// `{}`
    #[serde(rename = "org.matrix.msc2931.navigate", alias = "m.navigate")]
    Navigate,
    #[serde(rename = "org.matrix.mscXXXX.set_always_on_screen", alias = "m.set_always_on_screen")]
    SetAlwaysOnScreen { response: SetAlwaysOnScreenResponse },
    #[serde(rename = "org.matrix.mscXXXX.get_matrix_context", alias = "m.get_matrix_context")]
    GetMatrixContext { response: GetMatrixContextResponse },
    #[serde(rename = "org.matrix.mscXXXX.get_client_context", alias = "m.get_client_context")]
    GetClientContext { response: GetClientContextResponse },
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
        let bad = WireMessage::request(Source::Widget, "m.send_event", "b", json!({"type": 5}));
        assert!(matches!(WidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));

        let host_msg = WireMessage::request(Source::Host, "m.send_event", "r", json!({}));
        assert!(matches!(WidgetRequest::from_wire(&host_msg), Err(ActionError::WrongSource { .. })));
        assert!(matches!(WidgetRequest::from_wire(&wire.ack()), Err(ActionError::WrongDirection { .. })));

        // Serializing Unknown does not panic; it carries a placeholder action.
        let placeholder = WidgetRequest::Unknown.into_wire("x");
        assert_eq!(placeholder.action, "Unknown");
        assert_eq!(placeholder.request_body(), json!({}));
    }

    /// Renamed actions have no aliases: the old names are unknown actions. Only the compat wrapper
    /// translates them. That includes the names without a namespace, which MSC4412 does not allow.
    #[test]
    fn renamed_actions_are_only_known_by_their_new_name() {
        let renamed = [
            ("content_loaded", "org.matrix.msc4412.notify_ready"),
            ("notify_ready", "m.notify_ready"),
            ("org.matrix.msc2974.request_capabilities", "org.matrix.msc4412.request_capabilities"),
            ("request_capabilities", "m.request_capabilities"),
            ("send_event", "org.matrix.mscXXXX.send_event"),
            ("org.matrix.msc4412.send_event", "m.send_event"),
            ("send_to_device", "org.matrix.mscXXXX.send_to_device"),
            ("get_openid", "org.matrix.mscXXXX.get_openid"),
            ("watch_turn_servers", "org.matrix.mscXXXX.watch_turn_servers"),
            ("unwatch_turn_servers", "org.matrix.mscXXXX.unwatch_turn_servers"),
            ("set_always_on_screen", "org.matrix.mscXXXX.set_always_on_screen"),
            ("read_events", "m.read_events"),
            ("org.matrix.msc4412.matrix_context", "org.matrix.mscXXXX.get_matrix_context"),
            ("org.matrix.msc4412.get_matrix_context", "m.get_matrix_context"),
            ("org.matrix.msc4412.client_context", "org.matrix.mscXXXX.get_client_context"),
            ("org.matrix.msc4412.get_client_context", "m.get_client_context"),
            ("org.matrix.msc3973.user_directory_search", "org.matrix.msc3973.search_user_directory"),
            ("user_directory_search", "m.search_user_directory"),
            ("org.matrix.msc4533.rtc_livekit_get_token", "org.matrix.msc4533.get_rtc_livekit_token"),
            ("rtc_livekit_get_token", "m.get_rtc_livekit_token"),
            (
                "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave",
                "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave",
            ),
            ("rtc_livekit_delegate_delayed_leave", "m.delegate_rtc_livekit_delayed_leave"),
        ];
        for (old, new) in renamed {
            let request =
                |action| WidgetRequest::from_wire(&WireMessage::request(Source::Widget, action, "r", json!({})));
            assert_eq!(request(old), Ok(WidgetRequest::Unknown), "{old}");
            // Known: either parsed, or rejected for its body, but never `Unknown`.
            assert_ne!(request(new), Ok(WidgetRequest::Unknown), "{new}");
        }
        // The host actions are not widget actions.
        for action in ["org.matrix.mscXXXX.forward_event", "m.update_theme", "org.matrix.msc4412.update_capabilities"] {
            let wire = WireMessage::request(Source::Widget, action, "r", json!({}));
            assert_eq!(WidgetRequest::from_wire(&wire), Ok(WidgetRequest::Unknown));
        }
    }

    /// MSC4412: every action is `<namespace>.<name>`, the name is snake_case without `.` or `:`.
    #[test]
    fn every_action_is_namespaced() {
        let requests = [
            WidgetRequest::NotifyReady,
            WidgetRequest::GetOpenId,
            WidgetRequest::WatchTurnServers,
            WidgetRequest::UnwatchTurnServers,
            WidgetRequest::GetRtcTransports,
            WidgetRequest::GetMediaConfig,
            WidgetRequest::GetMatrixContext,
            WidgetRequest::GetClientContext,
        ];
        for request in requests {
            let action = request.into_wire("r").action;
            let (namespace, name) = action.rsplit_once('.').expect("namespaced");
            assert!(namespace.starts_with("org.matrix.msc") || namespace == "com.beeper", "{action}");
            assert!(name.chars().all(|c| c.is_ascii_lowercase() || c == '_'), "{action}");
        }
    }
}
