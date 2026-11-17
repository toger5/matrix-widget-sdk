//! Actions the host starts (`source: host`): one file per action, plus the two enums below that
//! list them all. The conventions are those of the `widget` module.

use serde::{Deserialize, Serialize};

use super::{expect, parse_tagged, split_tagged};
use crate::{
    ActionError, JsonValue, MatrixEvent, NotifyTimelineUpdateRequest, Source, ToDeviceEvent, TurnServer,
    UpdateCapabilitiesRequest, UpdateLanguageRequest, UpdateStateRequest, UpdateVisibilityRequest, WireMessage,
};

pub(crate) mod forward_event;
pub(crate) mod forward_to_device;
pub(crate) mod notify_timeline_update;
pub(crate) mod update_capabilities;
pub(crate) mod update_language;
pub(crate) mod update_state;
pub(crate) mod update_theme;
pub(crate) mod update_turn_servers;
pub(crate) mod update_visibility;

/// A request sent by the host (`source: host`, has `request`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum HostRequest {
    /// The full list of capabilities the widget holds from now on. (core action)
    #[serde(rename = "org.matrix.msc4412.update_capabilities", alias = "m.update_capabilities")]
    UpdateCapabilities { request: UpdateCapabilitiesRequest },
    /// A new room event the widget holds a `host:…forward_event.*` capability for.
    #[serde(rename = "org.matrix.mscXXXX.forward_event", alias = "m.forward_event")]
    ForwardEvent {
        #[serde(rename = "request")]
        event: MatrixEvent,
    },
    /// Current room state the widget holds `host:…update_state` capabilities for.
    #[serde(rename = "org.matrix.mscXXXX.update_state", alias = "m.update_state")]
    UpdateState { request: UpdateStateRequest },
    /// A to-device message the widget holds a `host:…forward_to_device` capability for.
    #[serde(rename = "org.matrix.mscXXXX.forward_to_device", alias = "m.forward_to_device")]
    ForwardToDevice {
        #[serde(rename = "request")]
        message: ToDeviceEvent,
    },
    /// TURN credentials for a widget that is watching them (MSC3846). Needs `host:…update_turn_servers`.
    #[serde(rename = "org.matrix.mscXXXX.update_turn_servers", alias = "m.update_turn_servers")]
    UpdateTurnServers {
        #[serde(rename = "request")]
        server: TurnServer,
    },
    /// The client's theme changed (MSC2873); the body shape is up to the client. Needs `host:…update_theme`.
    #[serde(rename = "org.matrix.mscXXXX.update_theme", alias = "m.update_theme")]
    UpdateTheme {
        #[serde(rename = "request")]
        theme: JsonValue,
    },
    /// The client's UI language changed. Needs `host:…update_language`.
    #[serde(rename = "org.matrix.mscXXXX.update_language", alias = "m.update_language")]
    UpdateLanguage { request: UpdateLanguageRequest },
    /// The client started or stopped showing the widget. Needs `host:…update_visibility`.
    #[serde(rename = "org.matrix.mscXXXX.update_visibility", alias = "m.update_visibility")]
    UpdateVisibility { request: UpdateVisibilityRequest },
    /// The timeline cache changed in a way `forward_event` does not cover (pagination status,
    /// reset, late decryption). Needs `host:…notify_timeline_update`.
    #[serde(rename = "org.matrix.mscXXXX.notify_timeline_update", alias = "m.notify_timeline_update")]
    NotifyTimelineUpdate { request: NotifyTimelineUpdateRequest },
    /// An action this crate does not know; see [`WidgetRequest::Unknown`](crate::WidgetRequest::Unknown).
    #[serde(other)]
    Unknown,
}

/// The widget's response to a [`HostRequest`] (`source: host`, has `response`).
///
/// Every host initiated action defined so far is acknowledged with `{}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum HostResponse {
    #[serde(rename = "org.matrix.msc4412.update_capabilities", alias = "m.update_capabilities")]
    UpdateCapabilities,
    #[serde(rename = "org.matrix.mscXXXX.forward_event", alias = "m.forward_event")]
    ForwardEvent,
    #[serde(rename = "org.matrix.mscXXXX.update_state", alias = "m.update_state")]
    UpdateState,
    #[serde(rename = "org.matrix.mscXXXX.forward_to_device", alias = "m.forward_to_device")]
    ForwardToDevice,
    #[serde(rename = "org.matrix.mscXXXX.update_turn_servers", alias = "m.update_turn_servers")]
    UpdateTurnServers,
    #[serde(rename = "org.matrix.mscXXXX.update_theme", alias = "m.update_theme")]
    UpdateTheme,
    #[serde(rename = "org.matrix.mscXXXX.update_language", alias = "m.update_language")]
    UpdateLanguage,
    #[serde(rename = "org.matrix.mscXXXX.update_visibility", alias = "m.update_visibility")]
    UpdateVisibility,
    #[serde(rename = "org.matrix.mscXXXX.notify_timeline_update", alias = "m.notify_timeline_update")]
    NotifyTimelineUpdate,
    /// A response to an action this crate does not know; the raw body is in the [`WireMessage`].
    #[serde(other)]
    Unknown,
}

impl HostRequest {
    /// Wrap into a wire envelope with the given request id.
    pub fn into_wire(self, request_id: impl Into<String>) -> WireMessage {
        let (action, body) = split_tagged(&self);
        WireMessage::request(Source::Host, action, request_id, body)
    }

    /// Interpret a wire envelope as a host request.
    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Host, true)?;
        parse_tagged(msg)
    }
}

impl HostResponse {
    /// Build the success reply envelope for `request` (see [`WireMessage::response_to`]). Error
    /// replies are built with [`WireMessage::error_response_to`].
    pub fn into_wire_reply(self, request: &WireMessage) -> WireMessage {
        request.response_to(split_tagged(&self).1)
    }

    /// Interpret the response found in `msg`. An error response is
    /// [`ActionError::ErrorResponse`].
    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        expect(msg, Source::Host, false)?;
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
    fn host_unknown_and_errors() {
        let wire = WireMessage::request(Source::Host, "org.example.custom", "r", json!({"a": 1}));
        assert_eq!(HostRequest::from_wire(&wire).unwrap(), HostRequest::Unknown);
        assert_eq!(HostResponse::from_wire(&wire.ack()).unwrap(), HostResponse::Unknown);
        assert_eq!(
            HostResponse::from_wire(&wire.error_response_to(WidgetError::new("nope"))),
            Err(ActionError::ErrorResponse { error: WidgetError::new("nope") })
        );
        assert!(matches!(HostRequest::from_wire(&wire.ack()), Err(ActionError::WrongDirection { .. })));

        let bad = WireMessage::request(Source::Host, "m.update_state", "b", json!({"state": 5}));
        assert!(matches!(HostRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));
    }

    /// Renamed actions have no aliases: the old names (and names without a namespace) are unknown
    /// actions. Only the compat wrapper translates them.
    #[test]
    fn renamed_actions_are_only_known_by_their_new_name() {
        let renamed = [
            ("notify_capabilities", "org.matrix.msc4412.update_capabilities"),
            ("org.matrix.msc2974.notify_capabilities", "m.update_capabilities"),
            ("update_capabilities", "m.update_capabilities"),
            ("send_event", "org.matrix.mscXXXX.forward_event"),
            ("forward_event", "m.forward_event"),
            ("send_to_device", "org.matrix.mscXXXX.forward_to_device"),
            ("theme_change", "org.matrix.mscXXXX.update_theme"),
            ("language_change", "org.matrix.mscXXXX.update_language"),
            ("visibility", "org.matrix.mscXXXX.update_visibility"),
            ("update_state", "org.matrix.mscXXXX.update_state"),
            ("update_turn_servers", "org.matrix.mscXXXX.update_turn_servers"),
        ];
        for (old, new) in renamed {
            let request = |action| HostRequest::from_wire(&WireMessage::request(Source::Host, action, "r", json!({})));
            assert_eq!(request(old), Ok(HostRequest::Unknown), "{old}");
            // Known: either parsed, or rejected for its body, but never `Unknown`.
            assert_ne!(request(new), Ok(HostRequest::Unknown), "{new}");
            let response = |action: &str| {
                HostResponse::from_wire(&WireMessage::request(Source::Host, action, "r", json!({})).ack())
            };
            assert_eq!(response(old), Ok(HostResponse::Unknown), "{old}");
            assert_ne!(response(new), Ok(HostResponse::Unknown), "{new}");
        }
    }

    /// Removed actions are unknown under every name. `forward_openid_credentials` was the late
    /// answer to a `get_openid` the user had to be asked about; the user now grants the
    /// `get_openid` capability instead, and `get_openid` always answers at once.
    #[test]
    fn removed_actions_are_unknown() {
        for action in ["org.matrix.mscXXXX.forward_openid_credentials", "m.forward_openid_credentials"] {
            let wire = WireMessage::request(Source::Host, action, "r", json!({"state": "allowed"}));
            assert_eq!(HostRequest::from_wire(&wire), Ok(HostRequest::Unknown), "{action}");
            assert_eq!(HostResponse::from_wire(&wire.ack()), Ok(HostResponse::Unknown), "{action}");
        }
    }
}
