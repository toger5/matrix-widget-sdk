//! Actions initiated by the widget (`source: widget`): one file per action plus the two enums
//! that dispatch over them.
//!
//! The enums are serde *internally tagged* on `action`; their serde shape is the action part of
//! the envelope (`{ "action": ..., "request": ... }` or `"response"`), not the full
//! [`WireMessage`]. Converting between the two goes through `from_wire` / `into_wire`.
//!
//! Conventions that keep this file free of per-action logic:
//!
//! * one variant per action, `#[serde(rename = "<action>")]`, a unit variant when the body is `{}`;
//! * a trailing `#[serde(other)] Unknown` unit variant catches unknown *tags* only, so a known
//!   action with a malformed body is still an [`ActionError::InvalidBody`];
//! * no `#[serde(untagged)]` anywhere: it would swallow body errors.

use serde::{Deserialize, Serialize};

use super::{expect, parse_tagged, split_tagged};
use crate::{
    ActionError, ReadEventsRequest, ReadEventsResponse, RequestCapabilitiesRequest, SendEventRequest,
    SendEventResponse, Source, WireMessage,
};

pub(crate) mod content_loaded;
pub(crate) mod read_events;
pub(crate) mod request_capabilities;
pub(crate) mod send_event;

pub use content_loaded::ACTION as CONTENT_LOADED;
pub use read_events::ACTION as READ_EVENTS;
pub use request_capabilities::ACTION as REQUEST_CAPABILITIES;
pub use send_event::ACTION as SEND_EVENT;

/// A request sent by the widget (`source: widget`, has `request`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum WidgetRequest {
    /// The widget finished loading and may be shown. (always allowed)
    #[serde(rename = "content_loaded")]
    ContentLoaded,
    /// Ask the host for capabilities. (always allowed)
    #[serde(rename = "request_capabilities")]
    RequestCapabilities { request: RequestCapabilitiesRequest },
    /// Send an event to the room. Requires a `send.*` capability.
    #[serde(rename = "send_event")]
    SendEvent { request: SendEventRequest },
    /// Read events from the room. Requires a `receive.*` capability.
    #[serde(rename = "read_events")]
    ReadEvents { request: ReadEventsRequest },
    /// An action this crate does not know. The [`WireMessage`] it was parsed from carries the
    /// action string and the raw body. Serializing it yields the placeholder action `Unknown`.
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

/// The host's response to a [`WidgetRequest`] (`source: widget`, has `response`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "action")]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum WidgetResponse {
    /// `{}`
    #[serde(rename = "content_loaded")]
    ContentLoaded,
    /// `{}`; the decision arrives later as [`HostRequest::NotifyCapabilities`](crate::HostRequest::NotifyCapabilities).
    #[serde(rename = "request_capabilities")]
    RequestCapabilities,
    #[serde(rename = "send_event")]
    SendEvent { response: SendEventResponse },
    #[serde(rename = "read_events")]
    ReadEvents { response: ReadEventsResponse },
    /// A response to an action this crate does not know; the raw body is in the [`WireMessage`].
    #[serde(other)]
    Unknown,
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
        let bad = WireMessage::request(Source::Widget, SEND_EVENT, "b", json!({"type": 5}));
        assert!(matches!(WidgetRequest::from_wire(&bad), Err(ActionError::InvalidBody { .. })));

        let host_msg = WireMessage::request(Source::Host, SEND_EVENT, "r", json!({}));
        assert!(matches!(WidgetRequest::from_wire(&host_msg), Err(ActionError::WrongSource { .. })));
        assert!(matches!(WidgetRequest::from_wire(&wire.ack()), Err(ActionError::WrongDirection { .. })));

        // Serializing Unknown does not panic; it carries a placeholder action.
        let placeholder = WidgetRequest::Unknown.into_wire("x");
        assert_eq!(placeholder.action, "Unknown");
        assert_eq!(placeholder.request_body(), json!({}));
    }
}
