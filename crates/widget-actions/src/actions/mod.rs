//! One module per widget API action.
//!
//! Each submodule owns the action's wire name (`ACTION`) and the request / response body types
//! that belong to it. The direction enums that dispatch over all actions
//! ([`FromWidgetRequest`](crate::FromWidgetRequest), [`ToWidgetRequest`](crate::ToWidgetRequest), ...)
//! live next to this module.
//!
//! To add an action: create `actions/<action>.rs` with an `ACTION` constant and its body types,
//! declare it below, re-export the constant, and add a variant to the matching direction enum.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::{ActionError, Source, WireMessage};

pub(crate) mod content_loaded;
pub(crate) mod notify_capabilities;
pub(crate) mod read_events;
pub(crate) mod request_capabilities;
pub(crate) mod send_event;
pub(crate) mod update_state;

pub use content_loaded::ACTION as CONTENT_LOADED;
pub use notify_capabilities::ACTION as NOTIFY_CAPABILITIES;
pub use read_events::ACTION as READ_EVENTS;
pub use request_capabilities::ACTION as REQUEST_CAPABILITIES;
pub use send_event::ACTION as SEND_EVENT;
pub use update_state::ACTION as UPDATE_STATE;

/// Check that `msg` was sent by `source` and is a request (`request == true`) or a response.
pub(crate) fn expect(msg: &WireMessage, source: Source, request: bool) -> Result<(), ActionError> {
    if msg.source != source {
        return Err(ActionError::WrongSource { got: msg.source.to_string() });
    }
    if msg.is_request() != request {
        let (expected, got) = if request { ("request", "response") } else { ("response", "request") };
        return Err(ActionError::WrongDirection { expected: expected.into(), got: got.into() });
    }
    Ok(())
}

pub(crate) fn to_value<T: Serialize>(v: &T) -> Value {
    serde_json::to_value(v).expect("action bodies are serializable")
}

pub(crate) fn from_value<T: for<'de> Deserialize<'de>>(action: &str, body: Value) -> Result<T, ActionError> {
    serde_json::from_value(body).map_err(|e| ActionError::invalid_body(action, e))
}

#[cfg(test)]
pub(crate) fn test_event() -> crate::MatrixEvent {
    crate::MatrixEvent {
        event_type: "m.room.message".into(),
        sender: "@a:b".into(),
        event_id: "$e".into(),
        room_id: "!r:b".into(),
        origin_server_ts: 1,
        state_key: None,
        content: serde_json::json!({"body": "x"}).into(),
        unsigned: None,
    }
}
