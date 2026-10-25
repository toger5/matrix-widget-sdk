//! Actions initiated by the host (`source: host`): one file per action plus the two enums that
//! dispatch over them. See the `widget` module for the conventions; they are identical.

use serde::{Deserialize, Serialize};

use super::{expect, parse_tagged, split_tagged};
use crate::{ActionError, MatrixEvent, NotifyCapabilitiesRequest, Source, UpdateStateRequest, WireMessage};

pub(crate) mod notify_capabilities;
pub(crate) mod send_event;
pub(crate) mod update_state;

pub use notify_capabilities::ACTION as NOTIFY_CAPABILITIES;
pub use send_event::ACTION as SEND_EVENT;
pub use update_state::ACTION as UPDATE_STATE;

// ----- Enums -----
// The two enums are the source of truth for all host actions (actions where: `source: "host"`)
// To keep this list easy to read each type for the different request gets their own file.

/// A request sent by the host (`source: host`, has `request`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum HostRequest {
    /// Result of a capability negotiation.
    #[serde(rename = "notify_capabilities")]
    NotifyCapabilities { request: NotifyCapabilitiesRequest },
    /// A room event the widget has a `receive.*` capability for.
    #[serde(rename = "send_event")]
    SendEvent {
        #[serde(rename = "request")]
        event: MatrixEvent,
    },
    /// Current room state the widget has `receive.state_event` capabilities for.
    #[serde(rename = "update_state")]
    UpdateState { request: UpdateStateRequest },
    /// An action this crate does not know; see [`WidgetRequest::Unknown`](crate::WidgetRequest::Unknown).
    #[serde(other)]
    Unknown,
}

/// The widget's response to a [`HostRequest`] (`source: host`, has `response`).
///
/// All host initiated actions defined so far are acknowledged with `{}`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum HostResponse {
    #[serde(rename = "notify_capabilities")]
    NotifyCapabilities,
    #[serde(rename = "send_event")]
    SendEvent,
    #[serde(rename = "update_state")]
    UpdateState,
    /// A response to an action this crate does not know; the raw body is in the [`WireMessage`].
    #[serde(other)]
    Unknown,
}

// ---- Implementations ----
// Just used to convert from and to wire

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

        let bad = WireMessage::request(Source::Host, UPDATE_STATE, "b", json!({"state": 5}));
        assert!(matches!(HostRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));
    }
}
