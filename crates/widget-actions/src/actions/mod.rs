//! The typed layer of the protocol: the [`Action`] root and one submodule per message source with
//! one file per action.
//!
//! * [`widget`]: actions the widget initiates (`source: widget`) and the `WidgetRequest` /
//!   `WidgetResponse` enums.
//! * [`host`]: actions the host initiates (`source: host`) and the `HostRequest` / `HostResponse`
//!   enums.
//!
//! Only types that exist solely as the body of one action live here. Vocabulary that the host
//! driver, the widget client or the backend use on their own ([`MatrixEvent`](crate::MatrixEvent),
//! [`Capability`](crate::Capability), [`StateKeySelector`](crate::StateKeySelector)) lives at the
//! crate root next to the wire types.
//!
//! `source` + `action` identify a message type, which is why `send_event` exists once per
//! source: the widget's request to send an event and the host's delivery of one are different
//! types that share a wire name.
//!
//! To add an action:
//!
//! 1. create `actions/<source>/<action>.rs` with its body types and a roundtrip test;
//! 2. in that source's `mod.rs`: declare it (`pub(crate) mod`) and add one variant per enum it
//!    appears in, with `#[serde(rename = "<action>")]` (a unit variant when the body is `{}`);
//!    the serde literal is the single place the wire name lives;
//! 3. re-export the body types from `lib.rs`.

use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::{Map, Value};

use crate::{ActionError, MessageKind, Source, WireMessage};

pub mod host;
pub mod widget;

use host::{HostRequest, HostResponse};
use widget::{WidgetRequest, WidgetResponse};

/// Every message of the protocol, typed. The variants mirror [`MessageKind`].
///
/// This is the one-call entry point for code that has to deal with any message. Code that only
/// ever sees one direction can call the leaf `from_wire` directly. There is no `into_wire` on the
/// root: requests need a fresh id ([`WidgetRequest::into_wire`]), responses are replies to an
/// envelope ([`WireMessage::response_to`]).
#[derive(Debug, Clone, PartialEq)]
#[cfg_attr(feature = "uniffi", derive(uniffi::Enum))]
pub enum Action {
    WidgetRequest { request: WidgetRequest },
    WidgetResponse { response: WidgetResponse },
    HostRequest { request: HostRequest },
    HostResponse { response: HostResponse },
}

impl Action {
    /// Parse any envelope into its typed form.
    pub fn from_wire(msg: &WireMessage) -> Result<Self, ActionError> {
        Ok(match msg.kind() {
            MessageKind::WidgetRequest => Action::WidgetRequest { request: WidgetRequest::from_wire(msg)? },
            MessageKind::WidgetResponse => Action::WidgetResponse { response: WidgetResponse::from_wire(msg)? },
            MessageKind::HostRequest => Action::HostRequest { request: HostRequest::from_wire(msg)? },
            MessageKind::HostResponse => Action::HostResponse { response: HostResponse::from_wire(msg)? },
        })
    }

    pub fn kind(&self) -> MessageKind {
        match self {
            Action::WidgetRequest { .. } => MessageKind::WidgetRequest,
            Action::WidgetResponse { .. } => MessageKind::WidgetResponse,
            Action::HostRequest { .. } => MessageKind::HostRequest,
            Action::HostResponse { .. } => MessageKind::HostResponse,
        }
    }
}

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

/// Deserialize the action part of `msg` (`{ "action": ..., "request" | "response": ... }`) into a
/// tagged leaf enum. Unknown actions land on the enum's `#[serde(other)]` variant; a known action
/// with a malformed body is an [`ActionError::InvalidBody`].
pub(crate) fn parse_tagged<T: DeserializeOwned>(msg: &WireMessage) -> Result<T, ActionError> {
    let (key, body) =
        if msg.is_request() { ("request", msg.request_body()) } else { ("response", msg.response_body()) };
    let mut tagged = Map::with_capacity(2);
    tagged.insert("action".to_owned(), Value::String(msg.action.clone()));
    tagged.insert(key.to_owned(), body);
    serde_json::from_value(Value::Object(tagged)).map_err(|e| ActionError::invalid_body(&msg.action, e))
}

/// Serialize a tagged leaf enum and split it into `(action, body)`. The body is `{}` for unit
/// variants.
pub(crate) fn split_tagged<T: Serialize>(value: &T) -> (String, Value) {
    let Value::Object(mut map) = serde_json::to_value(value).expect("actions are serializable") else {
        unreachable!("tagged enums serialize to objects")
    };
    let Some(Value::String(action)) = map.remove("action") else {
        unreachable!("tagged enums carry a string `action`")
    };
    let body =
        map.remove("request").or_else(|| map.remove("response")).unwrap_or_else(|| Value::Object(Map::default()));
    (action, body)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn root_dispatch() {
        let req = WidgetRequest::ContentLoaded.into_wire("a");
        assert_eq!(Action::from_wire(&req).unwrap(), Action::WidgetRequest { request: WidgetRequest::ContentLoaded });
        assert_eq!(
            Action::from_wire(&req.ack()).unwrap(),
            Action::WidgetResponse { response: WidgetResponse::ContentLoaded }
        );
        let host = HostRequest::SendEvent { event: test_event() }.into_wire("b");
        let parsed = Action::from_wire(&host).unwrap();
        assert_eq!(parsed.kind(), MessageKind::HostRequest);
        assert_eq!(parsed, Action::HostRequest { request: HostRequest::SendEvent { event: test_event() } });
        assert_eq!(Action::from_wire(&host.ack()).unwrap(), Action::HostResponse { response: HostResponse::SendEvent });
        assert_eq!(HostResponse::SendEvent.into_wire_reply(&host), host.ack());
    }
}
