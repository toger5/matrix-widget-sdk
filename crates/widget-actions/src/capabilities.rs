use std::fmt;

use serde::{Deserialize, Serialize};

use crate::{PLACEHOLDER_NAMESPACE, STABLE_NAMESPACE};

/// The unstable namespace of the action a capability head (`action[.modifier]`) belongs to.
///
/// A capability embeds the wire name of its action (MSC4412 "Capability format"), so this is the
/// namespace of the `#[serde(rename = ...)]` of that action in `actions/*/mod.rs`; the test
/// `capabilities_embed_the_action_name` keeps the two in step.
fn namespace_of(head: &str) -> &'static str {
    match head.split('.').next().unwrap_or(head) {
        "read_events" => "org.matrix.msc2876",
        "read_relations" => "org.matrix.msc3869",
        "update_delayed_event" => "org.matrix.msc4157",
        "get_rtc_transports" => "org.matrix.msc4515",
        "search_user_directory" => "org.matrix.msc3973",
        "get_media_config" | "upload_file" | "download_file" => "org.matrix.msc4039",
        "get_rtc_livekit_token" | "delegate_rtc_livekit_delayed_leave" => "org.matrix.msc4533",
        "navigate" => "org.matrix.msc2931",
        "read_room_account_data" => "com.beeper",
        _ => PLACEHOLDER_NAMESPACE,
    }
}

/// Split `<namespace>.<action>[.<modifier>]` and return the head (`action[.modifier]`) if the
/// namespace is the stable one or the unstable one of that action.
fn strip_namespace(full: &str) -> Option<&str> {
    // Action and modifier contain no `.`, so the head is the last segment or the last two.
    let mut dots = full.rmatch_indices('.').map(|(i, _)| i);
    [dots.next(), dots.next()].into_iter().flatten().find_map(|i| {
        let (namespace, head) = (&full[..i], &full[i + 1..]);
        (namespace == STABLE_NAMESPACE || namespace == namespace_of(head)).then_some(head)
    })
}

// Sources: who sends the action the capability is about.
const WIDGET: &str = "widget";
const HOST: &str = "host";

// Heads (`action[.modifier]`) of the capabilities that carry an event type as data.
const SEND_EVENT_TIMELINE: &str = "send_event.timeline";
const SEND_EVENT_STATE: &str = "send_event.state";
const READ_EVENTS_TIMELINE: &str = "read_events.timeline";
const READ_EVENTS_STATE: &str = "read_events.state";
const READ_RELATIONS: &str = "read_relations";
const READ_ROOM_ACCOUNT_DATA: &str = "read_room_account_data";
const SEND_TO_DEVICE: &str = "send_to_device";
const FORWARD_EVENT_TIMELINE: &str = "forward_event.timeline";
const FORWARD_EVENT_STATE: &str = "forward_event.state";
const UPDATE_STATE: &str = "update_state";
const FORWARD_TO_DEVICE: &str = "forward_to_device";

/// The capabilities without data: `(source, head, capability)`.
static UNIT_CAPABILITIES: &[(&str, &str, Capability)] = &[
    (WIDGET, "send_event.delayed", Capability::SendDelayedEvent),
    (WIDGET, "send_event.sticky", Capability::SendStickyEvent),
    (WIDGET, "update_delayed_event", Capability::UpdateDelayedEvent),
    (WIDGET, "get_openid", Capability::GetOpenId),
    (WIDGET, "get_rtc_transports", Capability::GetRtcTransports),
    (WIDGET, "search_user_directory", Capability::SearchUserDirectory),
    (WIDGET, "get_media_config", Capability::GetMediaConfig),
    (WIDGET, "upload_file", Capability::UploadFile),
    (WIDGET, "download_file", Capability::DownloadFile),
    (WIDGET, "get_rtc_livekit_token", Capability::GetRtcLivekitToken),
    (WIDGET, "delegate_rtc_livekit_delayed_leave", Capability::DelegateRtcLivekitDelayedLeave),
    (WIDGET, "navigate", Capability::Navigate),
    (WIDGET, "set_always_on_screen", Capability::SetAlwaysOnScreen),
    (WIDGET, "get_matrix_context", Capability::GetMatrixContext),
    (WIDGET, "get_client_context", Capability::GetClientContext),
    (HOST, "forward_event.sticky", Capability::ForwardStickyEvent),
    (HOST, "update_turn_servers", Capability::UpdateTurnServers),
    (HOST, "update_theme", Capability::UpdateTheme),
    (HOST, "update_language", Capability::UpdateLanguage),
    (HOST, "update_visibility", Capability::UpdateVisibility),
];

/// The event type whose timeline capabilities may be narrowed to one `msgtype` with `#<msgtype>`
/// (matrix-widget-api only splits on `#` for this type).
const ROOM_MESSAGE: &str = "m.room.message";

/// A widget capability.
///
/// Capabilities are plain strings on the wire, one (or more) per action, following MSC4412
/// "Capability format" and `docs/spec-appendix/capability-naming-proposal.md`:
///
/// ```text
/// source ":" action [ "." modifier ] [ ":" data ]        action = namespace "." name
///
/// widget:org.matrix.mscXXXX.send_event.timeline:m.room.message#m.text
/// widget:org.matrix.msc2876.read_events.state:m.room.topic
/// widget:org.matrix.msc2931.navigate
/// host:org.matrix.mscXXXX.update_state:m.room.member#@a:x
/// ```
///
/// * `source` is who sends the action: `widget` (a request the widget may make) or `host` (a
///   subscription: the host sends the action whenever there is something to send). Either way the
///   capability is held by the widget.
/// * `action` is the value of the `action` property of the action the capability is about: the
///   unstable name of the MSC that defines it (emitted by `Display`) or the stable `m.<name>`
///   (accepted when parsing, emitted by [`Capability::to_stable_string`]). The same name under
///   any other namespace is a different action and not a capability of this crate.
/// * `send_event`, `read_events` and `forward_event` always carry a `timeline` or `state`
///   modifier; there is no bare `widget:m.send_event:<type>`.
/// * The data is an event type. For timeline events `m.room.message#<msgtype>` narrows to one
///   `msgtype`; for state events `<type>#<state_key>` narrows to one state key.
///
/// No capability names a room: a widget acts in the room it is embedded in.
///
/// Parsing never fails. Unknown strings, including every legacy matrix-widget-api capability, are
/// preserved verbatim in [`Capability::Other`] and grant nothing.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Capability {
    // ---- widget actions ------------------------------------------------------------------------
    /// `send_event` of timeline events of `event_type`; for `m.room.message` optionally one
    /// `msgtype` only.
    SendEvent { event_type: String, msgtype: Option<String> },
    /// `send_event` of state events of `event_type`, optionally one state key only.
    SendStateEvent { event_type: String, state_key: Option<String> },
    /// May use `delay` on `send_event`. Held in addition to the event's own capability.
    SendDelayedEvent,
    /// May use `sticky_duration_ms` on `send_event`. Held in addition to the event's own capability.
    SendStickyEvent,
    /// May call `update_delayed_event`.
    UpdateDelayedEvent,
    /// `read_events` of timeline events of `event_type`; for `m.room.message` optionally one
    /// `msgtype` only.
    ReadEvents { event_type: String, msgtype: Option<String> },
    /// `read_events` of state events of `event_type`, optionally one state key only.
    ReadStateEvents { event_type: String, state_key: Option<String> },
    /// `read_relations` returning related events of `event_type`; for `m.room.message` optionally
    /// one `msgtype` only.
    ReadRelations { event_type: String, msgtype: Option<String> },
    /// `read_room_account_data` of `event_type`.
    ReadRoomAccountData { event_type: String },
    /// `send_to_device` of messages of `event_type`.
    SendToDevice { event_type: String },
    /// May call `get_openid` (the user may still be asked).
    GetOpenId,
    /// May call `get_rtc_transports`.
    GetRtcTransports,
    /// May call `search_user_directory`.
    SearchUserDirectory,
    /// May call `get_media_config`.
    GetMediaConfig,
    /// May call `upload_file`.
    UploadFile,
    /// May call `download_file`.
    DownloadFile,
    /// May call `get_rtc_livekit_token`.
    GetRtcLivekitToken,
    /// May call `delegate_rtc_livekit_delayed_leave`.
    DelegateRtcLivekitDelayedLeave,
    /// May call `navigate`.
    Navigate,
    /// May call `set_always_on_screen`.
    SetAlwaysOnScreen,
    /// May call `get_matrix_context`.
    GetMatrixContext,
    /// May call `get_client_context`.
    GetClientContext,

    // ---- host actions (subscriptions) ----------------------------------------------------------
    /// The host sends `forward_event` for new timeline events of `event_type`; for
    /// `m.room.message` optionally one `msgtype` only.
    ForwardEvent { event_type: String, msgtype: Option<String> },
    /// The host sends `forward_event` for state events of `event_type` as they arrive in the
    /// timeline, optionally one state key only.
    ForwardStateEvent { event_type: String, state_key: Option<String> },
    /// The host forwards sticky events. Held in addition to the event's own capability.
    ForwardStickyEvent,
    /// The host sends `update_state` with the current state of `event_type`, optionally one state
    /// key only.
    UpdateState { event_type: String, state_key: Option<String> },
    /// The host sends `forward_to_device` for to-device messages of `event_type`.
    ForwardToDevice { event_type: String },
    /// The host sends `update_turn_servers`.
    UpdateTurnServers,
    /// The host sends `update_theme`.
    UpdateTheme,
    /// The host sends `update_language`.
    UpdateLanguage,
    /// The host sends `update_visibility`.
    UpdateVisibility,

    /// Any string that is not a capability of this scheme.
    Other { raw: String },
}

impl Capability {
    /// `widget:…send_event.timeline:<event_type>`.
    pub fn send_event(event_type: impl Into<String>) -> Self {
        Self::SendEvent { event_type: event_type.into(), msgtype: None }
    }

    /// `widget:…send_event.timeline:m.room.message#<msgtype>`.
    pub fn send_message(msgtype: impl Into<String>) -> Self {
        Self::SendEvent { event_type: ROOM_MESSAGE.into(), msgtype: Some(msgtype.into()) }
    }

    /// `widget:…send_event.state:<event_type>[#<state_key>]`.
    pub fn send_state_event(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::SendStateEvent { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    /// `widget:…read_events.timeline:<event_type>`.
    pub fn read_events(event_type: impl Into<String>) -> Self {
        Self::ReadEvents { event_type: event_type.into(), msgtype: None }
    }

    /// `widget:…read_events.timeline:m.room.message#<msgtype>`.
    pub fn read_messages(msgtype: impl Into<String>) -> Self {
        Self::ReadEvents { event_type: ROOM_MESSAGE.into(), msgtype: Some(msgtype.into()) }
    }

    /// `widget:…read_events.state:<event_type>[#<state_key>]`.
    pub fn read_state_events(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::ReadStateEvents { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    /// `widget:…read_relations:<event_type>`.
    pub fn read_relations(event_type: impl Into<String>) -> Self {
        Self::ReadRelations { event_type: event_type.into(), msgtype: None }
    }

    /// `widget:…read_room_account_data:<event_type>`.
    pub fn read_room_account_data(event_type: impl Into<String>) -> Self {
        Self::ReadRoomAccountData { event_type: event_type.into() }
    }

    /// `widget:…send_to_device:<event_type>`.
    pub fn send_to_device(event_type: impl Into<String>) -> Self {
        Self::SendToDevice { event_type: event_type.into() }
    }

    /// `host:…forward_event.timeline:<event_type>`.
    pub fn forward_event(event_type: impl Into<String>) -> Self {
        Self::ForwardEvent { event_type: event_type.into(), msgtype: None }
    }

    /// `host:…forward_event.timeline:m.room.message#<msgtype>`.
    pub fn forward_messages(msgtype: impl Into<String>) -> Self {
        Self::ForwardEvent { event_type: ROOM_MESSAGE.into(), msgtype: Some(msgtype.into()) }
    }

    /// `host:…forward_event.state:<event_type>[#<state_key>]`.
    pub fn forward_state_event(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::ForwardStateEvent { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    /// `host:…update_state:<event_type>[#<state_key>]`.
    pub fn update_state(event_type: impl Into<String>, state_key: Option<impl Into<String>>) -> Self {
        Self::UpdateState { event_type: event_type.into(), state_key: state_key.map(Into::into) }
    }

    /// `host:…forward_to_device:<event_type>`.
    pub fn forward_to_device(event_type: impl Into<String>) -> Self {
        Self::ForwardToDevice { event_type: event_type.into() }
    }

    /// Parse a capability string. Never fails: anything that is not a capability of this scheme
    /// becomes [`Capability::Other`].
    pub fn parse(raw: &str) -> Self {
        Self::parse_known(raw).unwrap_or_else(|| Self::Other { raw: raw.to_owned() })
    }

    fn parse_known(raw: &str) -> Option<Self> {
        let (source, rest) = raw.split_once(':')?;
        // The action and modifier contain no `:`, the data may (`m.room.member#@a:x`).
        match rest.split_once(':') {
            Some((action, data)) if !data.is_empty() => Self::with_data(source, strip_namespace(action)?, data),
            Some(_) => None,
            None => {
                let head = strip_namespace(rest)?;
                UNIT_CAPABILITIES.iter().find(|(s, h, _)| *s == source && *h == head).map(|(_, _, c)| c.clone())
            }
        }
    }

    fn with_data(source: &str, head: &str, data: &str) -> Option<Self> {
        let timeline = || split_msgtype(data);
        let state = || split_hash(data);
        let event_type = data.to_owned();
        Some(match (source, head) {
            (WIDGET, SEND_EVENT_TIMELINE) => {
                let (event_type, msgtype) = timeline();
                Self::SendEvent { event_type, msgtype }
            }
            (WIDGET, SEND_EVENT_STATE) => {
                let (event_type, state_key) = state();
                Self::SendStateEvent { event_type, state_key }
            }
            (WIDGET, READ_EVENTS_TIMELINE) => {
                let (event_type, msgtype) = timeline();
                Self::ReadEvents { event_type, msgtype }
            }
            (WIDGET, READ_EVENTS_STATE) => {
                let (event_type, state_key) = state();
                Self::ReadStateEvents { event_type, state_key }
            }
            (WIDGET, READ_RELATIONS) => {
                let (event_type, msgtype) = timeline();
                Self::ReadRelations { event_type, msgtype }
            }
            (WIDGET, READ_ROOM_ACCOUNT_DATA) => Self::ReadRoomAccountData { event_type },
            (WIDGET, SEND_TO_DEVICE) => Self::SendToDevice { event_type },
            (HOST, FORWARD_EVENT_TIMELINE) => {
                let (event_type, msgtype) = timeline();
                Self::ForwardEvent { event_type, msgtype }
            }
            (HOST, FORWARD_EVENT_STATE) => {
                let (event_type, state_key) = state();
                Self::ForwardStateEvent { event_type, state_key }
            }
            (HOST, UPDATE_STATE) => {
                let (event_type, state_key) = state();
                Self::UpdateState { event_type, state_key }
            }
            (HOST, FORWARD_TO_DEVICE) => Self::ForwardToDevice { event_type },
            _ => return None,
        })
    }

    /// `(source, head, data)` of a modelled capability; `None` for `Other`.
    fn parts(&self) -> Option<(&'static str, &'static str, Option<String>)> {
        let typed = |source, head, event_type: &str, key: &Option<String>| {
            Some((source, head, Some(join_hash(event_type, key.as_deref()))))
        };
        match self {
            Self::SendEvent { event_type, msgtype } => typed(WIDGET, SEND_EVENT_TIMELINE, event_type, msgtype),
            Self::SendStateEvent { event_type, state_key } => typed(WIDGET, SEND_EVENT_STATE, event_type, state_key),
            Self::ReadEvents { event_type, msgtype } => typed(WIDGET, READ_EVENTS_TIMELINE, event_type, msgtype),
            Self::ReadStateEvents { event_type, state_key } => typed(WIDGET, READ_EVENTS_STATE, event_type, state_key),
            Self::ReadRelations { event_type, msgtype } => typed(WIDGET, READ_RELATIONS, event_type, msgtype),
            Self::ReadRoomAccountData { event_type } => typed(WIDGET, READ_ROOM_ACCOUNT_DATA, event_type, &None),
            Self::SendToDevice { event_type } => typed(WIDGET, SEND_TO_DEVICE, event_type, &None),
            Self::ForwardEvent { event_type, msgtype } => typed(HOST, FORWARD_EVENT_TIMELINE, event_type, msgtype),
            Self::ForwardStateEvent { event_type, state_key } => {
                typed(HOST, FORWARD_EVENT_STATE, event_type, state_key)
            }
            Self::UpdateState { event_type, state_key } => typed(HOST, UPDATE_STATE, event_type, state_key),
            Self::ForwardToDevice { event_type } => typed(HOST, FORWARD_TO_DEVICE, event_type, &None),
            Self::Other { .. } => None,
            unit => {
                UNIT_CAPABILITIES.iter().find(|(_, _, c)| c == unit).map(|(source, head, _)| (*source, *head, None))
            }
        }
    }

    /// Format with the stable namespace, or with the unstable one of the capability's action.
    fn format(&self, stable: bool) -> String {
        let parts = self.parts();
        let namespace = match &parts {
            Some((_, head, _)) if !stable => namespace_of(head),
            _ => STABLE_NAMESPACE,
        };
        match (self, parts) {
            (_, Some((source, head, Some(data)))) => format!("{source}:{namespace}.{head}:{data}"),
            (_, Some((source, head, None))) => format!("{source}:{namespace}.{head}"),
            (Self::Other { raw }, None) => raw.clone(),
            (unit, None) => unreachable!("{unit:?} is missing from UNIT_CAPABILITIES"),
        }
    }

    /// Whether this is a capability of the scheme, i.e. not [`Capability::Other`]. An unknown
    /// string can be granted, but it allows nothing.
    pub fn is_known(&self) -> bool {
        !matches!(self, Self::Other { .. })
    }

    /// The unstable representation, e.g. `widget:org.matrix.mscXXXX.send_event.timeline:m.room.message`
    /// or `widget:org.matrix.msc2931.navigate` (or the raw string for `Other`).
    pub fn to_unstable_string(&self) -> String {
        self.format(false)
    }

    /// The stable representation, e.g. `widget:m.send_event.timeline:m.room.message` (or the raw
    /// string for `Other`).
    pub fn to_stable_string(&self) -> String {
        self.format(true)
    }

    /// Does this capability allow *sending* the given event with `send_event`?
    /// `state_key == None` means a timeline (non-state) event; `msgtype` is the content's
    /// `msgtype`, only relevant for `m.room.message`.
    pub fn allows_send(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        match (self, state_key) {
            (Self::SendEvent { event_type: t, msgtype: m }, None) => matches_timeline(t, m, event_type, msgtype),
            (Self::SendStateEvent { event_type: t, state_key: k }, Some(sk)) => matches_state(t, k, event_type, sk),
            _ => false,
        }
    }

    /// Does this capability allow returning the given event from `read_events`? Arguments as in
    /// [`allows_send`](Self::allows_send).
    pub fn allows_read(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        match (self, state_key) {
            (Self::ReadEvents { event_type: t, msgtype: m }, None) => matches_timeline(t, m, event_type, msgtype),
            (Self::ReadStateEvents { event_type: t, state_key: k }, Some(sk)) => matches_state(t, k, event_type, sk),
            _ => false,
        }
    }

    /// Does this capability allow a `read_events` request for this type at all? Individual results
    /// still need [`allows_read`](Self::allows_read).
    pub fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool {
        match (self, is_state) {
            (Self::ReadEvents { event_type: t, .. }, false) => t == event_type,
            (Self::ReadStateEvents { event_type: t, .. }, true) => t == event_type,
            _ => false,
        }
    }

    /// Does this capability allow returning a related event of this type from `read_relations`?
    /// The state key plays no role.
    pub fn allows_read_relation(&self, event_type: &str, msgtype: Option<&str>) -> bool {
        match self {
            Self::ReadRelations { event_type: t, msgtype: m } => matches_timeline(t, m, event_type, msgtype),
            _ => false,
        }
    }

    /// Does this capability make the host send the given new event as `forward_event`? Arguments
    /// as in [`allows_send`](Self::allows_send).
    pub fn allows_forward(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        match (self, state_key) {
            (Self::ForwardEvent { event_type: t, msgtype: m }, None) => matches_timeline(t, m, event_type, msgtype),
            (Self::ForwardStateEvent { event_type: t, state_key: k }, Some(sk)) => matches_state(t, k, event_type, sk),
            _ => false,
        }
    }

    /// Does this capability make the host include the given state event in `update_state`?
    pub fn allows_update_state(&self, event_type: &str, state_key: &str) -> bool {
        match self {
            Self::UpdateState { event_type: t, state_key: k } => matches_state(t, k, event_type, state_key),
            _ => false,
        }
    }
}

fn matches_timeline(cap_type: &str, cap_msgtype: &Option<String>, event_type: &str, msgtype: Option<&str>) -> bool {
    cap_type == event_type && cap_msgtype.as_deref().is_none_or(|m| Some(m) == msgtype)
}

fn matches_state(cap_type: &str, cap_key: &Option<String>, event_type: &str, state_key: &str) -> bool {
    cap_type == event_type && cap_key.as_deref().is_none_or(|k| k == state_key)
}

/// `m.room.message#<msgtype>` splits into type and msgtype; any other event type is taken whole
/// (`#` is legal inside an event type).
fn split_msgtype(data: &str) -> (String, Option<String>) {
    match data.strip_prefix(ROOM_MESSAGE).and_then(|r| r.strip_prefix('#')) {
        Some(msgtype) => (ROOM_MESSAGE.to_owned(), Some(msgtype.to_owned())),
        None => (data.to_owned(), None),
    }
}

fn split_hash(data: &str) -> (String, Option<String>) {
    match data.split_once('#') {
        Some((t, k)) => (t.to_owned(), Some(k.to_owned())),
        None => (data.to_owned(), None),
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
// `widget:org.matrix.mscXXXX.send_event.timeline:m.room.message` & co. and never needs the parsed
// shape.
#[cfg(feature = "uniffi")]
uniffi::custom_type!(Capability, String, {
    try_lift: |raw| Ok(Capability::parse(&raw)),
    lower: |cap| cap.to_string(),
});

/// Whether `capability` is a capability of the scheme ([`Capability::is_known`]). For foreign
/// code, where a capability is its string: a permission prompt can tell what this crate acts on
/// from what it does not know (also a known action name under a foreign namespace).
#[cfg_attr(feature = "uniffi", uniffi::export)]
pub fn capability_is_known(capability: Capability) -> bool {
    capability.is_known()
}

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
    fn allows_read(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool;
    fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool;
    fn allows_read_relation(&self, event_type: &str, msgtype: Option<&str>) -> bool;
    fn allows_forward(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool;
    fn allows_update_state(&self, event_type: &str, state_key: &str) -> bool;
    fn allows_send_to_device(&self, event_type: &str) -> bool;
    fn allows_forward_to_device(&self, event_type: &str) -> bool;
    fn allows_read_room_account_data(&self, event_type: &str) -> bool;
    /// Is this capability (usually one without data, like [`Capability::Navigate`]) in the set?
    fn has(&self, capability: &Capability) -> bool;
}

impl<T: AsRef<[Capability]>> CapabilitySet for T {
    fn allows_send(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_send(event_type, state_key, msgtype))
    }

    fn allows_read(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_read(event_type, state_key, msgtype))
    }

    fn allows_read_type(&self, event_type: &str, is_state: bool) -> bool {
        self.as_ref().iter().any(|c| c.allows_read_type(event_type, is_state))
    }

    fn allows_read_relation(&self, event_type: &str, msgtype: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_read_relation(event_type, msgtype))
    }

    fn allows_forward(&self, event_type: &str, state_key: Option<&str>, msgtype: Option<&str>) -> bool {
        self.as_ref().iter().any(|c| c.allows_forward(event_type, state_key, msgtype))
    }

    fn allows_update_state(&self, event_type: &str, state_key: &str) -> bool {
        self.as_ref().iter().any(|c| c.allows_update_state(event_type, state_key))
    }

    fn allows_send_to_device(&self, event_type: &str) -> bool {
        self.as_ref().iter().any(|c| matches!(c, Capability::SendToDevice { event_type: t } if t == event_type))
    }

    fn allows_forward_to_device(&self, event_type: &str) -> bool {
        self.as_ref().iter().any(|c| matches!(c, Capability::ForwardToDevice { event_type: t } if t == event_type))
    }

    fn allows_read_room_account_data(&self, event_type: &str) -> bool {
        self.as_ref().iter().any(|c| matches!(c, Capability::ReadRoomAccountData { event_type: t } if t == event_type))
    }

    fn has(&self, capability: &Capability) -> bool {
        self.as_ref().contains(capability)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn other(raw: &str) -> Capability {
        Capability::Other { raw: raw.into() }
    }

    /// Every capability of the scheme, in its stable spelling.
    fn all() -> Vec<(&'static str, Capability)> {
        let none = None::<&str>;
        vec![
            ("widget:m.send_event.timeline:m.room.message", Capability::send_event("m.room.message")),
            ("widget:m.send_event.timeline:m.room.message#m.text", Capability::send_message("m.text")),
            ("widget:m.send_event.state:m.room.topic", Capability::send_state_event("m.room.topic", none)),
            ("widget:m.send_event.state:org.x.foo#", Capability::send_state_event("org.x.foo", Some(""))),
            ("widget:m.send_event.delayed", Capability::SendDelayedEvent),
            ("widget:m.send_event.sticky", Capability::SendStickyEvent),
            ("widget:m.update_delayed_event", Capability::UpdateDelayedEvent),
            ("widget:m.read_events.timeline:m.reaction", Capability::read_events("m.reaction")),
            ("widget:m.read_events.timeline:m.room.message#", Capability::read_messages("")),
            // `#` only splits for m.room.message
            ("widget:m.read_events.timeline:org.x#y", Capability::read_events("org.x#y")),
            (
                "widget:m.read_events.state:m.room.member#@a:b",
                Capability::read_state_events("m.room.member", Some("@a:b")),
            ),
            ("widget:m.read_relations:m.reaction", Capability::read_relations("m.reaction")),
            (
                "widget:m.read_relations:m.room.message#m.text",
                Capability::ReadRelations { event_type: "m.room.message".into(), msgtype: Some("m.text".into()) },
            ),
            ("widget:m.read_room_account_data:m.tag", Capability::read_room_account_data("m.tag")),
            ("widget:m.send_to_device:m.key", Capability::send_to_device("m.key")),
            ("widget:m.get_openid", Capability::GetOpenId),
            ("widget:m.get_rtc_transports", Capability::GetRtcTransports),
            ("widget:m.search_user_directory", Capability::SearchUserDirectory),
            ("widget:m.get_media_config", Capability::GetMediaConfig),
            ("widget:m.upload_file", Capability::UploadFile),
            ("widget:m.download_file", Capability::DownloadFile),
            ("widget:m.get_rtc_livekit_token", Capability::GetRtcLivekitToken),
            ("widget:m.delegate_rtc_livekit_delayed_leave", Capability::DelegateRtcLivekitDelayedLeave),
            ("widget:m.navigate", Capability::Navigate),
            ("widget:m.set_always_on_screen", Capability::SetAlwaysOnScreen),
            ("widget:m.get_matrix_context", Capability::GetMatrixContext),
            ("widget:m.get_client_context", Capability::GetClientContext),
            ("host:m.forward_event.timeline:m.room.message", Capability::forward_event("m.room.message")),
            ("host:m.forward_event.timeline:m.room.message#m.text", Capability::forward_messages("m.text")),
            ("host:m.forward_event.state:m.room.member", Capability::forward_state_event("m.room.member", none)),
            (
                "host:m.forward_event.state:m.room.member#@a:b",
                Capability::forward_state_event("m.room.member", Some("@a:b")),
            ),
            ("host:m.forward_event.sticky", Capability::ForwardStickyEvent),
            ("host:m.update_state:m.room.member#@a:b", Capability::update_state("m.room.member", Some("@a:b"))),
            ("host:m.update_state:m.room.topic#", Capability::update_state("m.room.topic", Some(""))),
            ("host:m.forward_to_device:m.key", Capability::forward_to_device("m.key")),
            ("host:m.update_turn_servers", Capability::UpdateTurnServers),
            ("host:m.update_theme", Capability::UpdateTheme),
            ("host:m.update_language", Capability::UpdateLanguage),
            ("host:m.update_visibility", Capability::UpdateVisibility),
        ]
    }

    #[test]
    fn parses_and_formats_every_capability_in_both_namespaces() {
        for (stable, expected) in all() {
            assert_eq!(Capability::parse(stable), expected, "{stable}");
            assert_eq!(expected.to_stable_string(), stable);

            let (_, head, _) = expected.parts().unwrap();
            let unstable = stable.replacen(":m.", &format!(":{}.", namespace_of(head)), 1);
            assert_ne!(unstable, stable);
            assert_eq!(Capability::parse(&unstable), expected, "{unstable}");
            assert_eq!(expected.to_unstable_string(), unstable);
            assert_eq!(expected.to_string(), unstable, "Display emits the unstable namespace");
            assert!(
                capability_is_known(Capability::parse(stable)) && capability_is_known(Capability::parse(&unstable))
            );
        }
    }

    #[test]
    fn unstable_capabilities_use_the_namespace_of_their_action() {
        let cases = [
            ("widget:org.matrix.mscXXXX.send_event.timeline:m.x", Capability::send_event("m.x")),
            ("widget:org.matrix.mscXXXX.send_event.delayed", Capability::SendDelayedEvent),
            ("widget:org.matrix.msc4157.update_delayed_event", Capability::UpdateDelayedEvent),
            ("widget:org.matrix.msc2876.read_events.timeline:m.x", Capability::read_events("m.x")),
            ("widget:org.matrix.msc3869.read_relations:m.x", Capability::read_relations("m.x")),
            ("widget:com.beeper.read_room_account_data:m.tag", Capability::read_room_account_data("m.tag")),
            ("widget:org.matrix.msc4039.upload_file", Capability::UploadFile),
            ("widget:org.matrix.msc4533.get_rtc_livekit_token", Capability::GetRtcLivekitToken),
            ("widget:org.matrix.msc2931.navigate", Capability::Navigate),
            ("widget:org.matrix.mscXXXX.get_matrix_context", Capability::GetMatrixContext),
            ("host:org.matrix.mscXXXX.forward_event.state:m.room.member", {
                Capability::forward_state_event("m.room.member", None::<&str>)
            }),
            ("host:org.matrix.mscXXXX.update_theme", Capability::UpdateTheme),
        ];
        for (raw, expected) in cases {
            assert_eq!(Capability::parse(raw), expected, "{raw}");
            assert_eq!(expected.to_string(), raw);
        }
    }

    /// MSC4412: the action part of a capability is the value of the `action` property. Every
    /// capability's action must therefore be a known action of its source, in both spellings.
    #[test]
    fn capabilities_embed_the_action_name() {
        use crate::{HostRequest, Source, WidgetRequest, WireMessage};
        use serde_json::json;

        for (stable, capability) in all() {
            for raw in [stable.to_owned(), capability.to_unstable_string()] {
                let (source, rest) = raw.split_once(':').unwrap();
                let action = rest.split(':').next().unwrap();
                let (_, head, _) = capability.parts().unwrap();
                // Without the modifier, if the capability has one.
                let action = match head.split_once('.') {
                    Some((_, modifier)) => action.strip_suffix(modifier).unwrap().trim_end_matches('.'),
                    None => action,
                };
                let known = match source {
                    "widget" => {
                        let wire = WireMessage::request(Source::Widget, action, "r", json!({}));
                        WidgetRequest::from_wire(&wire) != Ok(WidgetRequest::Unknown)
                    }
                    _ => {
                        let wire = WireMessage::request(Source::Host, action, "r", json!({}));
                        HostRequest::from_wire(&wire) != Ok(HostRequest::Unknown)
                    }
                };
                assert!(known, "`{action}` (from `{raw}`) is not an action sent by the {source}");
            }
        }
    }

    #[test]
    fn every_unit_variant_is_in_the_table_once() {
        for (i, (source, head, capability)) in UNIT_CAPABILITIES.iter().enumerate() {
            assert!(capability.parts().is_some_and(|p| p == (*source, *head, None)), "{head}");
            for (_, other_head, other_capability) in &UNIT_CAPABILITIES[i + 1..] {
                assert_ne!(capability, other_capability);
                assert_ne!(head, other_head);
            }
        }
        // 20 of the 39 strings in `all()` are unit capabilities; every one must be in the table.
        let units = all().into_iter().filter(|(raw, _)| raw.matches(':').count() == 1).count();
        assert_eq!(units, UNIT_CAPABILITIES.len());
    }

    #[test]
    fn strings_outside_the_scheme_are_other() {
        let cases = [
            // An action with modifiers has no capability without one.
            "widget:m.send_event:m.room.message",
            "widget:m.send_event",
            "widget:m.read_events:m.room.message",
            "host:m.forward_event:m.room.message",
            // Unknown modifier, or a modifier on an action that has none.
            "widget:m.send_event.type:m.room.message",
            "widget:m.send_event.room:!r:x",
            "widget:m.read_events.room:!r:x",
            "host:m.update_state.state:m.room.topic",
            "widget:m.navigate.now",
            // Wrong source for the action.
            "host:m.send_event.timeline:m.room.message",
            "widget:m.forward_event.timeline:m.room.message",
            "widget:m.update_theme",
            "host:m.navigate",
            "runtime:m.update_theme",
            // Data missing, empty or unexpected.
            "widget:m.send_event.timeline",
            "widget:m.send_event.timeline:",
            "widget:m.send_to_device",
            "widget:m.navigate:somewhere",
            "widget:m.send_event.delayed:m.room.message",
            // Wrong namespace or shape. The same name under another namespace is another action.
            "widget:org.matrix.msc4412.navigate",
            "widget:org.matrix.mscXXXX.navigate",
            "widget:org.matrix.mscXXXX.read_events.timeline:m.room.message",
            "widget:org.matrix.msc2876.send_event.timeline:m.room.message",
            "widget:org.matrix.msc4412.get_matrix_context",
            "host:org.matrix.msc2762.forward_event.timeline:m.room.message",
            "widget:org.matrix.msc2876.read_events",
            "widget:.navigate",
            "widget:navigate",
            "widget.m.navigate",
            "m.widget.navigate",
            "m.widget.send_event:m.room.message",
            "widget:mnavigate",
            // Legacy matrix-widget-api capabilities grant nothing here.
            "org.matrix.msc2762.send.event:m.room.message",
            "m.send.event:m.room.message",
            "org.matrix.msc2762.receive.state_event:m.room.member#@a:b",
            "org.matrix.msc2762.timeline:!r:x",
            "org.matrix.msc2762.timeline:*",
            "org.matrix.msc3819.send.to_device:m.key",
            "org.matrix.msc4157.send.delayed_event",
            "town.robin.msc3846.turn_servers",
            "com.beeper.capabilities.receive.room_account_data:m.tag",
            "org.matrix.msc2931.navigate",
            "m.always_on_screen",
            "org.matrix.msc4412.matrix_context",
            "m.sticker",
            "io.element.requires_client",
            "garbage",
            "",
        ];
        for raw in cases {
            let parsed = Capability::parse(raw);
            assert_eq!(parsed, other(raw), "{raw}");
            assert!(!capability_is_known(parsed.clone()), "{raw}");
            // Unknown strings survive unchanged in every spelling.
            assert_eq!(parsed.to_string(), raw);
            assert_eq!(parsed.to_stable_string(), raw);
        }
    }

    #[test]
    fn data_may_contain_separators() {
        // `:` in a state key, `#` inside the key, and a namespace-like event type.
        assert_eq!(
            Capability::parse("host:org.matrix.mscXXXX.update_state:m.room.member#@a:b.c:8448"),
            Capability::update_state("m.room.member", Some("@a:b.c:8448"))
        );
        assert_eq!(
            Capability::parse("widget:m.send_event.state:org.x#a#b"),
            Capability::send_state_event("org.x", Some("a#b"))
        );
        assert_eq!(
            Capability::parse("widget:m.send_event.timeline:widget:m.navigate"),
            Capability::send_event("widget:m.navigate")
        );
        // The stable namespace is `m`, so an `m.`-prefixed unstable-looking rest is still stable.
        assert_eq!(
            Capability::parse("widget:m.send_to_device:org.matrix.msc2931.navigate"),
            Capability::send_to_device("org.matrix.msc2931.navigate")
        );
    }

    #[test]
    fn matching() {
        let caps = vec![
            Capability::send_event("m.room.message"),
            Capability::send_state_event("m.room.topic", None::<&str>),
            Capability::read_state_events("m.room.member", Some("@me:x")),
            Capability::read_messages("m.text"),
            Capability::read_relations("m.reaction"),
            Capability::forward_messages("m.image"),
            Capability::forward_state_event("m.room.topic", Some("")),
            Capability::update_state("m.room.name", None::<&str>),
            Capability::send_to_device("m.key"),
            Capability::forward_to_device("m.other"),
            Capability::read_room_account_data("m.tag"),
            Capability::Navigate,
        ];
        assert!(caps.allows_send("m.room.message", None, None));
        assert!(caps.allows_send("m.room.message", None, Some("m.image")));
        assert!(!caps.allows_send("m.room.message", Some(""), None));
        assert!(!caps.allows_send("m.reaction", None, None));
        assert!(caps.allows_send("m.room.topic", Some(""), None));
        assert!(caps.allows_send("m.room.topic", Some("anything"), None));
        assert!(!caps.allows_send("m.room.topic", None, None));

        assert!(caps.allows_read("m.room.member", Some("@me:x"), None));
        assert!(!caps.allows_read("m.room.member", Some("@you:x"), None));
        assert!(caps.allows_read("m.room.message", None, Some("m.text")));
        assert!(!caps.allows_read("m.room.message", None, Some("m.image")));
        assert!(!caps.allows_read("m.room.message", None, None));
        assert!(caps.allows_read_type("m.room.member", true));
        assert!(!caps.allows_read_type("m.room.member", false));
        assert!(caps.allows_read_type("m.room.message", false));

        assert!(caps.allows_read_relation("m.reaction", None));
        assert!(!caps.allows_read_relation("m.room.message", Some("m.text")));

        assert!(caps.allows_send_to_device("m.key"));
        assert!(!caps.allows_forward_to_device("m.key"));
        assert!(caps.allows_forward_to_device("m.other"));
        assert!(caps.allows_read_room_account_data("m.tag"));
        assert!(caps.has(&Capability::Navigate));
        assert!(!caps.has(&Capability::SetAlwaysOnScreen));
    }

    #[test]
    fn each_action_has_its_own_capability() {
        // Sending, reading, forwarding and state updates never imply each other.
        let read = vec![Capability::read_events("m.x"), Capability::read_state_events("m.s", None::<&str>)];
        assert!(read.allows_read("m.x", None, None));
        assert!(!read.allows_forward("m.x", None, None));
        assert!(!read.allows_read_relation("m.x", None));
        assert!(!read.allows_send("m.x", None, None));
        assert!(!read.allows_update_state("m.s", ""));
        assert!(!read.allows_forward("m.s", Some(""), None));

        let forward = vec![Capability::forward_event("m.x"), Capability::forward_state_event("m.s", None::<&str>)];
        assert!(forward.allows_forward("m.x", None, None));
        assert!(forward.allows_forward("m.s", Some("k"), None));
        assert!(!forward.allows_read("m.x", None, None));
        assert!(!forward.allows_read_type("m.x", false));
        assert!(!forward.allows_update_state("m.s", "k"));

        let update = vec![Capability::update_state("m.s", Some("k"))];
        assert!(update.allows_update_state("m.s", "k"));
        assert!(!update.allows_update_state("m.s", "other"));
        assert!(!update.allows_forward("m.s", Some("k"), None));
        assert!(!update.allows_read("m.s", Some("k"), None));

        let relations = vec![Capability::read_relations("m.x")];
        assert!(relations.allows_read_relation("m.x", None));
        assert!(!relations.allows_read("m.x", None, None));
    }

    #[test]
    fn serde_as_string() {
        let v: Vec<Capability> =
            serde_json::from_str(r#"["widget:m.send_event.timeline:a", "m.send.event:a", "zzz"]"#).unwrap();
        assert_eq!(v, [Capability::send_event("a"), other("m.send.event:a"), other("zzz")]);
        assert_eq!(
            serde_json::to_string(&v).unwrap(),
            r#"["widget:org.matrix.mscXXXX.send_event.timeline:a","m.send.event:a","zzz"]"#
        );
    }
}
