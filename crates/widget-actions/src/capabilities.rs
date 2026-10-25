use std::fmt;

use serde::{Deserialize, Serialize};

/// Stable prefix of every capability this crate models.
const STABLE_PREFIX: &str = "m.";
/// Unstable prefix of the MSC2762 event capabilities, used by all deployed implementations
/// (matrix-widget-api, Element). Each capability knows its own unstable prefix, see
/// [`Capability::unstable_prefix`].
const MSC2762_PREFIX: &str = "org.matrix.msc2762.";

const SEND_EVENT: &str = "send.event:";
const RECEIVE_EVENT: &str = "receive.event:";
const SEND_STATE: &str = "send.state_event:";
const RECEIVE_STATE: &str = "receive.state_event:";

const CLIENT_CONTEXT: &str = "client_context";
const MATRIX_CONTEXT: &str = "matrix_context";

/// A widget capability (MSC2762 / MSC2974).
///
/// Capabilities are plain strings on the wire. This type understands the event related ones so
/// hosts can check permissions and widgets can build requests without string fiddling. Unknown
/// strings are preserved verbatim in [`Capability::Other`] so future MSCs keep working.
///
/// Event capabilities are of the form
///
/// * `<prefix>send.event:<type>`
/// * `<prefix>receive.event:<type>`
/// * `<prefix>send.state_event:<type>` (any state key) or `<prefix>send.state_event:<type>#<state_key>`
/// * `<prefix>receive.state_event:<type>` / `<prefix>receive.state_event:<type>#<state_key>`
///
/// where `<prefix>` is `m.` (stable) or `org.matrix.msc2762.` (unstable). Both are accepted
/// when parsing. [`Display`](fmt::Display) emits the unstable prefix because that is what
/// deployed hosts understand; use [`Capability::to_stable_string`] for the stable form.
///
/// The context capabilities `m.client_context` and `m.matrix_context` guard the
/// `client_context` / `matrix_context` actions. They have no unstable form.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Capability {
    SendEvent {
        event_type: String,
    },
    ReceiveEvent {
        event_type: String,
    },
    SendStateEvent {
        event_type: String,
        state_key: Option<String>,
    },
    ReceiveStateEvent {
        event_type: String,
        state_key: Option<String>,
    },
    /// May call `client_context`.
    ClientContext,
    /// May call `matrix_context`.
    MatrixContext,
    /// Any capability this crate does not model.
    Other {
        raw: String,
    },
}

impl Capability {
    pub fn send_event(event_type: impl Into<String>) -> Self {
        Self::SendEvent { event_type: event_type.into() }
    }

    pub fn receive_event(event_type: impl Into<String>) -> Self {
        Self::ReceiveEvent { event_type: event_type.into() }
    }

    pub fn send_state_event(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::SendStateEvent { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    pub fn receive_state_event(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::ReceiveStateEvent { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    /// Parse a capability string. Never fails: unknown strings become [`Capability::Other`].
    pub fn parse(raw: &str) -> Self {
        let body = raw.strip_prefix(MSC2762_PREFIX).or_else(|| raw.strip_prefix(STABLE_PREFIX));
        let Some(body) = body else {
            return Self::Other { raw: raw.to_owned() };
        };

        if let Some(t) = body.strip_prefix(SEND_EVENT) {
            return Self::SendEvent { event_type: t.to_owned() };
        }
        if let Some(t) = body.strip_prefix(RECEIVE_EVENT) {
            return Self::ReceiveEvent { event_type: t.to_owned() };
        }
        if let Some(rest) = body.strip_prefix(SEND_STATE) {
            let (event_type, state_key) = split_state(rest);
            return Self::SendStateEvent { event_type, state_key };
        }
        if let Some(rest) = body.strip_prefix(RECEIVE_STATE) {
            let (event_type, state_key) = split_state(rest);
            return Self::ReceiveStateEvent { event_type, state_key };
        }
        if body == CLIENT_CONTEXT {
            return Self::ClientContext;
        }
        if body == MATRIX_CONTEXT {
            return Self::MatrixContext;
        }
        Self::Other { raw: raw.to_owned() }
    }

    fn body(&self) -> Option<String> {
        Some(match self {
            Capability::SendEvent { event_type } => format!("{SEND_EVENT}{event_type}"),
            Capability::ReceiveEvent { event_type } => format!("{RECEIVE_EVENT}{event_type}"),
            Capability::SendStateEvent { event_type, state_key } => {
                format!("{SEND_STATE}{}", join_state(event_type, state_key.as_deref()))
            }
            Capability::ReceiveStateEvent { event_type, state_key } => {
                format!("{RECEIVE_STATE}{}", join_state(event_type, state_key.as_deref()))
            }
            Capability::ClientContext => CLIENT_CONTEXT.to_owned(),
            Capability::MatrixContext => MATRIX_CONTEXT.to_owned(),
            Capability::Other { .. } => return None,
        })
    }

    /// The prefix of this capability's unstable form. Capabilities without an unstable form
    /// (the context capabilities) use the stable prefix.
    pub fn unstable_prefix(&self) -> &'static str {
        match self {
            Capability::SendEvent { .. }
            | Capability::ReceiveEvent { .. }
            | Capability::SendStateEvent { .. }
            | Capability::ReceiveStateEvent { .. } => MSC2762_PREFIX,
            Capability::ClientContext | Capability::MatrixContext | Capability::Other { .. } => STABLE_PREFIX,
        }
    }

    /// The unstable representation, e.g. `org.matrix.msc2762.send.event:m.room.message`
    /// (or the raw string for `Other`).
    pub fn to_unstable_string(&self) -> String {
        match self.body() {
            Some(body) => format!("{}{body}", self.unstable_prefix()),
            None => self.raw_other(),
        }
    }

    /// The `m.*` representation (or the raw string for `Other`).
    pub fn to_stable_string(&self) -> String {
        match self.body() {
            Some(body) => format!("{STABLE_PREFIX}{body}"),
            None => self.raw_other(),
        }
    }

    fn raw_other(&self) -> String {
        match self {
            Capability::Other { raw } => raw.clone(),
            _ => unreachable!("raw_other is only called for Other"),
        }
    }

    /// Does this capability allow *sending* the given event?
    /// `state_key == None` means a timeline (non-state) event.
    pub fn allows_send(&self, event_type: &str, state_key: Option<&str>) -> bool {
        match (self, state_key) {
            (Capability::SendEvent { event_type: t }, None) => t == event_type,
            (Capability::SendStateEvent { event_type: t, state_key: k }, Some(sk)) => {
                t == event_type && k.as_deref().is_none_or(|k| k == sk)
            }
            _ => false,
        }
    }

    /// Does this capability allow *receiving* the given event?
    /// `state_key == None` means a timeline (non-state) event.
    pub fn allows_receive(&self, event_type: &str, state_key: Option<&str>) -> bool {
        match (self, state_key) {
            (Capability::ReceiveEvent { event_type: t }, None) => t == event_type,
            (Capability::ReceiveStateEvent { event_type: t, state_key: k }, Some(sk)) => {
                t == event_type && k.as_deref().is_none_or(|k| k == sk)
            }
            _ => false,
        }
    }

    /// Does this capability allow *reading* (via `read_events`) events of this type at all?
    /// Used to decide whether a read request may be forwarded; individual results still need
    /// [`Capability::allows_receive`].
    pub fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool {
        match (self, is_state) {
            (Capability::ReceiveEvent { event_type: t }, false) => t == event_type,
            (Capability::ReceiveStateEvent { event_type: t, .. }, true) => t == event_type,
            _ => false,
        }
    }
}

fn split_state(rest: &str) -> (String, Option<String>) {
    match rest.split_once('#') {
        Some((t, k)) => (t.to_owned(), Some(k.to_owned())),
        None => (rest.to_owned(), None),
    }
}

fn join_state(event_type: &str, state_key: Option<&str>) -> String {
    match state_key {
        Some(k) => format!("{event_type}#{k}"),
        None => event_type.to_owned(),
    }
}

impl fmt::Display for Capability {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.to_unstable_string())
    }
}

// Over the FFI a capability is its string form, exactly as on the wire: foreign code deals in
// `org.matrix.msc2762.send.event:m.room.message` & co. and never needs the parsed shape.
#[cfg(feature = "uniffi")]
uniffi::custom_type!(Capability, String, {
    try_lift: |raw| Ok(Capability::parse(&raw)),
    lower: |cap| cap.to_string(),
});

impl From<&str> for Capability {
    fn from(raw: &str) -> Self {
        Self::parse(raw)
    }
}

impl From<String> for Capability {
    fn from(raw: String) -> Self {
        Self::parse(&raw)
    }
}

impl Serialize for Capability {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_unstable_string())
    }
}

impl<'de> Deserialize<'de> for Capability {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let raw = String::deserialize(deserializer)?;
        Ok(Self::parse(&raw))
    }
}

/// Convenience for a list of capabilities.
pub trait CapabilitySet {
    fn allows_send(&self, event_type: &str, state_key: Option<&str>) -> bool;
    fn allows_receive(&self, event_type: &str, state_key: Option<&str>) -> bool;
    fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool;
}

impl<T: AsRef<[Capability]>> CapabilitySet for T {
    fn allows_send(&self, event_type: &str, state_key: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_send(event_type, state_key))
    }

    fn allows_receive(&self, event_type: &str, state_key: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_receive(event_type, state_key))
    }

    fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool {
        self.as_ref().iter().any(|c| c.allows_read_type(event_type, is_state))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_format() {
        let cases = [
            ("org.matrix.msc2762.send.event:m.room.message", Capability::send_event("m.room.message")),
            ("m.receive.event:m.reaction", Capability::receive_event("m.reaction")),
            ("m.send.state_event:m.room.topic", Capability::send_state_event("m.room.topic", None::<&str>)),
            (
                "org.matrix.msc2762.receive.state_event:m.room.member#@a:b",
                Capability::receive_state_event("m.room.member", Some("@a:b")),
            ),
            ("m.send.state_event:org.x.foo#", Capability::send_state_event("org.x.foo", Some(""))),
            ("org.matrix.msc3819.turn_servers", Capability::Other { raw: "org.matrix.msc3819.turn_servers".into() }),
            ("garbage", Capability::Other { raw: "garbage".into() }),
        ];
        for (raw, expected) in cases {
            assert_eq!(Capability::parse(raw), expected, "{raw}");
        }

        assert_eq!(
            Capability::receive_state_event("m.room.member", Some("@a:b")).to_string(),
            "org.matrix.msc2762.receive.state_event:m.room.member#@a:b"
        );
        assert_eq!(Capability::send_event("x").to_stable_string(), "m.send.event:x");
        assert_eq!(Capability::parse("custom.cap").to_stable_string(), "custom.cap");
    }

    #[test]
    fn matching() {
        let caps = vec![
            Capability::send_event("m.room.message"),
            Capability::send_state_event("m.room.topic", None::<&str>),
            Capability::receive_state_event("m.room.member", Some("@me:x")),
        ];
        assert!(caps.allows_send("m.room.message", None));
        assert!(!caps.allows_send("m.room.message", Some("")));
        assert!(!caps.allows_send("m.reaction", None));
        assert!(caps.allows_send("m.room.topic", Some("")));
        assert!(caps.allows_send("m.room.topic", Some("anything")));
        assert!(!caps.allows_send("m.room.topic", None));
        assert!(caps.allows_receive("m.room.member", Some("@me:x")));
        assert!(!caps.allows_receive("m.room.member", Some("@you:x")));
        assert!(caps.allows_read_type("m.room.member", true));
        assert!(!caps.allows_read_type("m.room.member", false));
    }

    #[test]
    fn serde_as_string() {
        let v: Vec<Capability> = serde_json::from_str(r#"["m.send.event:a", "zzz"]"#).unwrap();
        assert_eq!(v[0], Capability::send_event("a"));
        assert_eq!(serde_json::to_string(&v).unwrap(), r#"["org.matrix.msc2762.send.event:a","zzz"]"#);
    }

    #[test]
    fn context_capabilities() {
        assert_eq!(Capability::parse("m.client_context"), Capability::ClientContext);
        assert_eq!(Capability::parse("m.matrix_context"), Capability::MatrixContext);
        assert_eq!(Capability::ClientContext.to_unstable_string(), "m.client_context");
        assert_eq!(Capability::MatrixContext.to_stable_string(), "m.matrix_context");
        assert_eq!(Capability::send_event("x").unstable_prefix(), "org.matrix.msc2762.");
        assert!(!Capability::ClientContext.allows_send("m.room.message", None));
    }
}
