use std::fmt;

use serde::{Deserialize, Serialize};

/// Stable prefix of every capability this crate models. Accepted when parsing; emitted by
/// [`Capability::to_stable_string`].
const STABLE_PREFIX: &str = "m.";

// Unstable prefixes, one per MSC. Each capability knows its own, see [`Capability::unstable_prefix`].
// [`Display`](fmt::Display) emits the unstable form because that is what deployed hosts understand.
const MSC2762_PREFIX: &str = "org.matrix.msc2762.";
const MSC3819_PREFIX: &str = "org.matrix.msc3819.";
const MSC4157_PREFIX: &str = "org.matrix.msc4157.";
const MSC4407_PREFIX: &str = "org.matrix.msc4407.";
const BEEPER_PREFIX: &str = "com.beeper.capabilities.";
const MSC3846_PREFIX: &str = "town.robin.msc3846.";
const MSC4515_PREFIX: &str = "org.matrix.msc4515.";
const MSC3973_PREFIX: &str = "org.matrix.msc3973.";
const MSC4039_PREFIX: &str = "org.matrix.msc4039.";
const MSC2931_PREFIX: &str = "org.matrix.msc2931.";
/// `matrix_context` / `client_context` are not in an MSC yet; they replace the URL templating
/// MSC4412 removes, so they live under its prefix until they get their own.
const MSC4412_PREFIX: &str = "org.matrix.msc4412.";

/// Every prefix [`Capability::parse`] strips before looking at the body.
const ALL_PREFIXES: &[&str] = &[
    MSC2762_PREFIX,
    MSC3819_PREFIX,
    MSC4157_PREFIX,
    MSC4407_PREFIX,
    BEEPER_PREFIX,
    MSC3846_PREFIX,
    MSC4515_PREFIX,
    MSC3973_PREFIX,
    MSC4039_PREFIX,
    MSC2931_PREFIX,
    MSC4412_PREFIX,
    STABLE_PREFIX,
];

// Bodies (the part after the prefix).
const SEND_EVENT: &str = "send.event:";
const RECEIVE_EVENT: &str = "receive.event:";
const SEND_STATE: &str = "send.state_event:";
const RECEIVE_STATE: &str = "receive.state_event:";
const TIMELINE: &str = "timeline:";
const SEND_TO_DEVICE: &str = "send.to_device:";
const RECEIVE_TO_DEVICE: &str = "receive.to_device:";
const SEND_DELAYED_EVENT: &str = "send.delayed_event";
const UPDATE_DELAYED_EVENT: &str = "update_delayed_event";
const SEND_STICKY_EVENT: &str = "send.sticky_event";
const RECEIVE_STICKY_EVENT: &str = "receive.sticky_event";
const RECEIVE_ROOM_ACCOUNT_DATA: &str = "receive.room_account_data:";
const TURN_SERVERS: &str = "turn_servers";
const RTC_TRANSPORTS: &str = "rtc_transports";
const USER_DIRECTORY_SEARCH: &str = "user_directory_search";
const UPLOAD_FILE: &str = "upload_file";
const DOWNLOAD_FILE: &str = "download_file";
const NAVIGATE: &str = "navigate";
const STICKER: &str = "sticker";
const ALWAYS_ON_SCREEN: &str = "always_on_screen";
const SCREENSHOT: &str = "capability.screenshot";
const CLIENT_CONTEXT: &str = "client_context";
const MATRIX_CONTEXT: &str = "matrix_context";

/// The event type whose `send.event` / `receive.event` capabilities may be narrowed to one
/// `msgtype` with `#<msgtype>` (matrix-widget-api only splits on `#` for this type).
const ROOM_MESSAGE: &str = "m.room.message";

/// A widget capability.
///
/// Capabilities are plain strings on the wire. This type understands every capability
/// matrix-widget-api knows so hosts can check permissions and widgets can build requests without
/// string fiddling. Unknown strings are preserved verbatim in [`Capability::Other`] so future MSCs
/// keep working.
///
/// Every capability is `<prefix><body>`. `<prefix>` is the MSC's unstable prefix (what deployed
/// hosts understand, emitted by `Display`) or the stable `m.` (accepted when parsing, emitted by
/// [`Capability::to_stable_string`]). The event capabilities (MSC2762) are
///
/// * `send.event:<type>` / `receive.event:<type>`, for `m.room.message` optionally
///   `m.room.message#<msgtype>`,
/// * `send.state_event:<type>` (any state key) or `send.state_event:<type>#<state_key>`, and the
///   `receive.state_event` pair,
/// * `timeline:<room_id>` (reading or writing another room's timeline; see `docs/parity.md`).
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Capability {
    /// Send timeline events of `event_type`; for `m.room.message` optionally one `msgtype` only.
    SendEvent {
        event_type: String,
        msgtype: Option<String>,
    },
    /// Receive timeline events of `event_type`; for `m.room.message` optionally one `msgtype` only.
    ReceiveEvent {
        event_type: String,
        msgtype: Option<String>,
    },
    SendStateEvent {
        event_type: String,
        state_key: Option<String>,
    },
    ReceiveStateEvent {
        event_type: String,
        state_key: Option<String>,
    },
    /// Access to the timeline of another room (MSC2762 `timeline:<room_id>`).
    Timeline {
        room_id: String,
    },
    /// Send to-device messages of `event_type` (MSC3819).
    SendToDevice {
        event_type: String,
    },
    /// Receive to-device messages of `event_type` (MSC3819).
    ReceiveToDevice {
        event_type: String,
    },
    /// May use `delay` on `send_event` (MSC4157).
    SendDelayedEvent,
    /// May call `update_delayed_event` (MSC4157).
    UpdateDelayedEvent,
    /// May use `sticky_duration_ms` on `send_event` (MSC4407).
    SendStickyEvent,
    /// May receive sticky events (MSC4407).
    ReceiveStickyEvent,
    /// May read room account data of `event_type` (Beeper extension).
    ReceiveRoomAccountData {
        event_type: String,
    },
    /// May watch TURN servers (MSC3846).
    TurnServers,
    /// May read the homeserver's RTC transports (MSC4515).
    RtcTransports,
    /// May search the user directory (MSC3973).
    UserDirectorySearch,
    /// May upload media and read the media config (MSC4039).
    UploadFile,
    /// May download media (MSC4039).
    DownloadFile,
    /// May ask the client to navigate to a `matrix.to` URI (MSC2931).
    Navigate,
    /// May send stickers (`m.sticker`).
    Sticker,
    /// May ask to stay on screen (`m.always_on_screen`).
    AlwaysOnScreen,
    /// The client may ask the widget for screenshots (`m.capability.screenshot`).
    Screenshot,
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
        Self::SendEvent { event_type: event_type.into(), msgtype: None }
    }

    /// `send.event:m.room.message#<msgtype>`.
    pub fn send_message(msgtype: impl Into<String>) -> Self {
        Self::SendEvent { event_type: ROOM_MESSAGE.into(), msgtype: Some(msgtype.into()) }
    }

    pub fn receive_event(event_type: impl Into<String>) -> Self {
        Self::ReceiveEvent { event_type: event_type.into(), msgtype: None }
    }

    /// `receive.event:m.room.message#<msgtype>`.
    pub fn receive_message(msgtype: impl Into<String>) -> Self {
        Self::ReceiveEvent { event_type: ROOM_MESSAGE.into(), msgtype: Some(msgtype.into()) }
    }

    pub fn send_state_event(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::SendStateEvent { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    pub fn receive_state_event(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::ReceiveStateEvent { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    pub fn timeline(room_id: impl Into<String>) -> Self {
        Self::Timeline { room_id: room_id.into() }
    }

    pub fn send_to_device(event_type: impl Into<String>) -> Self {
        Self::SendToDevice { event_type: event_type.into() }
    }

    pub fn receive_to_device(event_type: impl Into<String>) -> Self {
        Self::ReceiveToDevice { event_type: event_type.into() }
    }

    pub fn receive_room_account_data(event_type: impl Into<String>) -> Self {
        Self::ReceiveRoomAccountData { event_type: event_type.into() }
    }

    /// Parse a capability string. Never fails: unknown strings become [`Capability::Other`].
    ///
    /// Both the capability's unstable prefix and the stable `m.` are accepted; a body behind the
    /// *wrong* unstable prefix (say `org.matrix.msc3819.send.event:x`) is `Other`.
    pub fn parse(raw: &str) -> Self {
        for prefix in ALL_PREFIXES {
            let Some(body) = raw.strip_prefix(prefix) else { continue };
            if let Some(cap) = Self::from_body(body) {
                if *prefix == STABLE_PREFIX || *prefix == cap.unstable_prefix() {
                    return cap;
                }
            }
        }
        Self::Other { raw: raw.to_owned() }
    }

    fn from_body(body: &str) -> Option<Self> {
        if let Some(rest) = body.strip_prefix(SEND_EVENT) {
            let (event_type, msgtype) = split_msgtype(rest);
            return Some(Self::SendEvent { event_type, msgtype });
        }
        if let Some(rest) = body.strip_prefix(RECEIVE_EVENT) {
            let (event_type, msgtype) = split_msgtype(rest);
            return Some(Self::ReceiveEvent { event_type, msgtype });
        }
        if let Some(rest) = body.strip_prefix(SEND_STATE) {
            let (event_type, state_key) = split_hash(rest);
            return Some(Self::SendStateEvent { event_type, state_key });
        }
        if let Some(rest) = body.strip_prefix(RECEIVE_STATE) {
            let (event_type, state_key) = split_hash(rest);
            return Some(Self::ReceiveStateEvent { event_type, state_key });
        }
        if let Some(room_id) = body.strip_prefix(TIMELINE) {
            return Some(Self::Timeline { room_id: room_id.to_owned() });
        }
        if let Some(t) = body.strip_prefix(SEND_TO_DEVICE) {
            return Some(Self::SendToDevice { event_type: t.to_owned() });
        }
        if let Some(t) = body.strip_prefix(RECEIVE_TO_DEVICE) {
            return Some(Self::ReceiveToDevice { event_type: t.to_owned() });
        }
        if let Some(t) = body.strip_prefix(RECEIVE_ROOM_ACCOUNT_DATA) {
            return Some(Self::ReceiveRoomAccountData { event_type: t.to_owned() });
        }
        Some(match body {
            SEND_DELAYED_EVENT => Self::SendDelayedEvent,
            UPDATE_DELAYED_EVENT => Self::UpdateDelayedEvent,
            SEND_STICKY_EVENT => Self::SendStickyEvent,
            RECEIVE_STICKY_EVENT => Self::ReceiveStickyEvent,
            TURN_SERVERS => Self::TurnServers,
            RTC_TRANSPORTS => Self::RtcTransports,
            USER_DIRECTORY_SEARCH => Self::UserDirectorySearch,
            UPLOAD_FILE => Self::UploadFile,
            DOWNLOAD_FILE => Self::DownloadFile,
            NAVIGATE => Self::Navigate,
            STICKER => Self::Sticker,
            ALWAYS_ON_SCREEN => Self::AlwaysOnScreen,
            SCREENSHOT => Self::Screenshot,
            CLIENT_CONTEXT => Self::ClientContext,
            MATRIX_CONTEXT => Self::MatrixContext,
            _ => return None,
        })
    }

    fn body(&self) -> Option<String> {
        Some(match self {
            Capability::SendEvent { event_type, msgtype } => {
                format!("{SEND_EVENT}{}", join_hash(event_type, msgtype.as_deref()))
            }
            Capability::ReceiveEvent { event_type, msgtype } => {
                format!("{RECEIVE_EVENT}{}", join_hash(event_type, msgtype.as_deref()))
            }
            Capability::SendStateEvent { event_type, state_key } => {
                format!("{SEND_STATE}{}", join_hash(event_type, state_key.as_deref()))
            }
            Capability::ReceiveStateEvent { event_type, state_key } => {
                format!("{RECEIVE_STATE}{}", join_hash(event_type, state_key.as_deref()))
            }
            Capability::Timeline { room_id } => format!("{TIMELINE}{room_id}"),
            Capability::SendToDevice { event_type } => format!("{SEND_TO_DEVICE}{event_type}"),
            Capability::ReceiveToDevice { event_type } => format!("{RECEIVE_TO_DEVICE}{event_type}"),
            Capability::ReceiveRoomAccountData { event_type } => format!("{RECEIVE_ROOM_ACCOUNT_DATA}{event_type}"),
            Capability::SendDelayedEvent => SEND_DELAYED_EVENT.to_owned(),
            Capability::UpdateDelayedEvent => UPDATE_DELAYED_EVENT.to_owned(),
            Capability::SendStickyEvent => SEND_STICKY_EVENT.to_owned(),
            Capability::ReceiveStickyEvent => RECEIVE_STICKY_EVENT.to_owned(),
            Capability::TurnServers => TURN_SERVERS.to_owned(),
            Capability::RtcTransports => RTC_TRANSPORTS.to_owned(),
            Capability::UserDirectorySearch => USER_DIRECTORY_SEARCH.to_owned(),
            Capability::UploadFile => UPLOAD_FILE.to_owned(),
            Capability::DownloadFile => DOWNLOAD_FILE.to_owned(),
            Capability::Navigate => NAVIGATE.to_owned(),
            Capability::Sticker => STICKER.to_owned(),
            Capability::AlwaysOnScreen => ALWAYS_ON_SCREEN.to_owned(),
            Capability::Screenshot => SCREENSHOT.to_owned(),
            Capability::ClientContext => CLIENT_CONTEXT.to_owned(),
            Capability::MatrixContext => MATRIX_CONTEXT.to_owned(),
            Capability::Other { .. } => return None,
        })
    }

    /// The prefix of this capability's unstable form. Capabilities that only exist in a stable
    /// spelling (`m.sticker`, ...) return the stable prefix.
    pub fn unstable_prefix(&self) -> &'static str {
        match self {
            Capability::SendEvent { .. }
            | Capability::ReceiveEvent { .. }
            | Capability::SendStateEvent { .. }
            | Capability::ReceiveStateEvent { .. }
            | Capability::Timeline { .. } => MSC2762_PREFIX,
            Capability::SendToDevice { .. } | Capability::ReceiveToDevice { .. } => MSC3819_PREFIX,
            Capability::SendDelayedEvent | Capability::UpdateDelayedEvent => MSC4157_PREFIX,
            Capability::SendStickyEvent | Capability::ReceiveStickyEvent => MSC4407_PREFIX,
            Capability::ReceiveRoomAccountData { .. } => BEEPER_PREFIX,
            Capability::TurnServers => MSC3846_PREFIX,
            Capability::RtcTransports => MSC4515_PREFIX,
            Capability::UserDirectorySearch => MSC3973_PREFIX,
            Capability::UploadFile | Capability::DownloadFile => MSC4039_PREFIX,
            Capability::Navigate => MSC2931_PREFIX,
            Capability::ClientContext | Capability::MatrixContext => MSC4412_PREFIX,
            Capability::Sticker | Capability::AlwaysOnScreen | Capability::Screenshot | Capability::Other { .. } => {
                STABLE_PREFIX
            }
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
    /// `state_key == None` means a timeline (non-state) event; `msgtype` is the content's
    /// `msgtype`, only relevant for `m.room.message`.
    pub fn allows_send(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        match (self, state_key) {
            (Capability::SendEvent { event_type: t, msgtype: m }, None) => {
                t == event_type && m.as_deref().is_none_or(|m| Some(m) == msgtype)
            }
            (Capability::SendStateEvent { event_type: t, state_key: k }, Some(sk)) => {
                t == event_type && k.as_deref().is_none_or(|k| k == sk)
            }
            _ => false,
        }
    }

    /// Does this capability allow *receiving* the given event? Arguments as in
    /// [`allows_send`](Self::allows_send).
    pub fn allows_receive(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        match (self, state_key) {
            (Capability::ReceiveEvent { event_type: t, msgtype: m }, None) => {
                t == event_type && m.as_deref().is_none_or(|m| Some(m) == msgtype)
            }
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
            (Capability::ReceiveEvent { event_type: t, .. }, false) => t == event_type,
            (Capability::ReceiveStateEvent { event_type: t, .. }, true) => t == event_type,
            _ => false,
        }
    }
}

/// `m.room.message#<msgtype>` splits into type and msgtype; any other event type is taken whole
/// (`#` is legal inside an event type).
fn split_msgtype(rest: &str) -> (String, Option<String>) {
    match rest.strip_prefix(ROOM_MESSAGE).and_then(|r| r.strip_prefix('#')) {
        Some(msgtype) => (ROOM_MESSAGE.to_owned(), Some(msgtype.to_owned())),
        None => (rest.to_owned(), None),
    }
}

fn split_hash(rest: &str) -> (String, Option<String>) {
    match rest.split_once('#') {
        Some((t, k)) => (t.to_owned(), Some(k.to_owned())),
        None => (rest.to_owned(), None),
    }
}

fn join_hash(event_type: &str, key: Option<&str>) -> String {
    match key {
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
    fn allows_send(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool;
    fn allows_receive(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool;
    fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool;
    fn allows_send_to_device(&self, event_type: &str) -> bool;
    fn allows_receive_to_device(&self, event_type: &str) -> bool;
    fn allows_receive_room_account_data(&self, event_type: &str) -> bool;
    /// Is this unit capability (`m.sticker`, `org.matrix.msc2931.navigate`, ...) in the set?
    fn has(&self, capability: &Capability) -> bool;
}

impl<T: AsRef<[Capability]>> CapabilitySet for T {
    fn allows_send(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_send(event_type, state_key, msgtype))
    }

    fn allows_receive(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_receive(event_type, state_key, msgtype))
    }

    fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool {
        self.as_ref().iter().any(|c| c.allows_read_type(event_type, is_state))
    }

    fn allows_send_to_device(&self, event_type: &str) -> bool {
        self.as_ref().iter().any(|c| matches!(c, Capability::SendToDevice { event_type: t } if t == event_type))
    }

    fn allows_receive_to_device(&self, event_type: &str) -> bool {
        self.as_ref().iter().any(|c| matches!(c, Capability::ReceiveToDevice { event_type: t } if t == event_type))
    }

    fn allows_receive_room_account_data(&self, event_type: &str) -> bool {
        self.as_ref()
            .iter()
            .any(|c| matches!(c, Capability::ReceiveRoomAccountData { event_type: t } if t == event_type))
    }

    fn has(&self, capability: &Capability) -> bool {
        self.as_ref().contains(capability)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_and_format() {
        let cases = [
            ("org.matrix.msc2762.send.event:m.room.message", Capability::send_event("m.room.message")),
            ("org.matrix.msc2762.send.event:m.room.message#m.text", Capability::send_message("m.text")),
            ("org.matrix.msc2762.receive.event:m.room.message#", Capability::receive_message("")),
            ("m.receive.event:m.reaction", Capability::receive_event("m.reaction")),
            // `#` only splits for m.room.message
            ("m.receive.event:org.x#y", Capability::receive_event("org.x#y")),
            ("m.send.state_event:m.room.topic", Capability::send_state_event("m.room.topic", None::<&str>)),
            (
                "org.matrix.msc2762.receive.state_event:m.room.member#@a:b",
                Capability::receive_state_event("m.room.member", Some("@a:b")),
            ),
            ("m.send.state_event:org.x.foo#", Capability::send_state_event("org.x.foo", Some(""))),
            ("org.matrix.msc2762.timeline:!r:x", Capability::timeline("!r:x")),
            ("org.matrix.msc3819.send.to_device:m.key", Capability::send_to_device("m.key")),
            ("m.receive.to_device:m.key", Capability::receive_to_device("m.key")),
            ("org.matrix.msc4157.send.delayed_event", Capability::SendDelayedEvent),
            ("org.matrix.msc4157.update_delayed_event", Capability::UpdateDelayedEvent),
            ("org.matrix.msc4407.send.sticky_event", Capability::SendStickyEvent),
            ("org.matrix.msc4407.receive.sticky_event", Capability::ReceiveStickyEvent),
            ("com.beeper.capabilities.receive.room_account_data:m.tag", Capability::receive_room_account_data("m.tag")),
            ("town.robin.msc3846.turn_servers", Capability::TurnServers),
            ("org.matrix.msc4515.rtc_transports", Capability::RtcTransports),
            ("org.matrix.msc3973.user_directory_search", Capability::UserDirectorySearch),
            ("org.matrix.msc4039.upload_file", Capability::UploadFile),
            ("org.matrix.msc4039.download_file", Capability::DownloadFile),
            ("org.matrix.msc2931.navigate", Capability::Navigate),
            ("m.sticker", Capability::Sticker),
            ("m.always_on_screen", Capability::AlwaysOnScreen),
            ("m.capability.screenshot", Capability::Screenshot),
            ("org.matrix.msc4412.matrix_context", Capability::MatrixContext),
            ("m.matrix_context", Capability::MatrixContext),
            ("m.client_context", Capability::ClientContext),
            // wrong unstable prefix for the body
            ("org.matrix.msc3819.send.event:x", Capability::Other { raw: "org.matrix.msc3819.send.event:x".into() }),
            ("io.element.requires_client", Capability::Other { raw: "io.element.requires_client".into() }),
            ("garbage", Capability::Other { raw: "garbage".into() }),
        ];
        for (raw, expected) in cases {
            assert_eq!(Capability::parse(raw), expected, "{raw}");
            // Every modelled capability roundtrips through its unstable form.
            if !matches!(expected, Capability::Other { .. }) {
                let unstable = expected.to_unstable_string();
                assert_eq!(Capability::parse(&unstable), expected, "{unstable}");
                let stable = expected.to_stable_string();
                assert!(stable.starts_with("m."));
                assert_eq!(Capability::parse(&stable), expected, "{stable}");
            }
        }

        assert_eq!(
            Capability::receive_state_event("m.room.member", Some("@a:b")).to_string(),
            "org.matrix.msc2762.receive.state_event:m.room.member#@a:b"
        );
        assert_eq!(
            Capability::send_message("m.text").to_string(),
            "org.matrix.msc2762.send.event:m.room.message#m.text"
        );
        assert_eq!(Capability::send_event("x").to_stable_string(), "m.send.event:x");
        assert_eq!(Capability::MatrixContext.to_string(), "org.matrix.msc4412.matrix_context");
        assert_eq!(Capability::Sticker.to_string(), "m.sticker");
        assert_eq!(Capability::parse("custom.cap").to_stable_string(), "custom.cap");
    }

    #[test]
    fn matching() {
        let caps = vec![
            Capability::send_event("m.room.message"),
            Capability::send_state_event("m.room.topic", None::<&str>),
            Capability::receive_state_event("m.room.member", Some("@me:x")),
            Capability::receive_message("m.text"),
            Capability::send_to_device("m.key"),
            Capability::receive_room_account_data("m.tag"),
            Capability::Navigate,
        ];
        assert!(caps.allows_send("m.room.message", None, None));
        assert!(caps.allows_send("m.room.message", None, Some("m.image")));
        assert!(!caps.allows_send("m.room.message", Some(""), None));
        assert!(!caps.allows_send("m.reaction", None, None));
        assert!(caps.allows_send("m.room.topic", Some(""), None));
        assert!(caps.allows_send("m.room.topic", Some("anything"), None));
        assert!(!caps.allows_send("m.room.topic", None, None));
        assert!(caps.allows_receive("m.room.member", Some("@me:x"), None));
        assert!(!caps.allows_receive("m.room.member", Some("@you:x"), None));
        assert!(caps.allows_receive("m.room.message", None, Some("m.text")));
        assert!(!caps.allows_receive("m.room.message", None, Some("m.image")));
        assert!(!caps.allows_receive("m.room.message", None, None));
        assert!(caps.allows_read_type("m.room.member", true));
        assert!(!caps.allows_read_type("m.room.member", false));
        assert!(caps.allows_read_type("m.room.message", false));
        assert!(caps.allows_send_to_device("m.key"));
        assert!(!caps.allows_receive_to_device("m.key"));
        assert!(caps.allows_receive_room_account_data("m.tag"));
        assert!(caps.has(&Capability::Navigate));
        assert!(!caps.has(&Capability::Sticker));
    }

    #[test]
    fn serde_as_string() {
        let v: Vec<Capability> = serde_json::from_str(r#"["m.send.event:a", "zzz"]"#).unwrap();
        assert_eq!(v[0], Capability::send_event("a"));
        assert_eq!(serde_json::to_string(&v).unwrap(), r#"["org.matrix.msc2762.send.event:a","zzz"]"#);
    }

    #[test]
    fn context_capabilities() {
        assert_eq!(Capability::ClientContext.to_unstable_string(), "org.matrix.msc4412.client_context");
        assert_eq!(Capability::MatrixContext.to_stable_string(), "m.matrix_context");
        assert_eq!(Capability::send_event("x").unstable_prefix(), "org.matrix.msc2762.");
        assert!(!Capability::ClientContext.allows_send("m.room.message", None, None));
    }
}
