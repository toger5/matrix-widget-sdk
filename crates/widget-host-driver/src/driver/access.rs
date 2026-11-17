//! The driver's permission rules: which capability a request or a push needs, which room a widget
//! may name and which events it may see.
//!
//! Every action has its own capability (`docs/spec-appendix/capability-naming-proposal.md`), so
//! reading, being forwarded new events and receiving state updates are checked separately.
//!
//! Every function here only looks at the approved capabilities and the request, so the rules can
//! be tested without a driver, backend or platform.

use widget_actions::{
    Capability, CapabilitySet, HostRequest, JsonValue, MatrixEvent, RoomSelector, SendEventRequest, TimelineFilter,
    WidgetError, WidgetRequest,
};

/// The single capability that allows or denies `request` as a whole.
///
/// `None` means either that no capability is needed, or that the check depends on the request
/// body and happens in the request's handler (`send_event`, `read_timeline`, ...).
///
/// The list is exhaustive on purpose: a new action does not compile until it has a rule here.
pub(super) fn required_capability(request: &WidgetRequest) -> Option<Capability> {
    use WidgetRequest as R;
    Some(match request {
        R::UpdateDelayedEvent { .. } => Capability::UpdateDelayedEvent,
        // Watching is how the widget starts the `update_turn_servers` pushes.
        R::WatchTurnServers | R::UnwatchTurnServers => Capability::UpdateTurnServers,
        // Single use by default (`WidgetHostDriver::set_single_use`).
        R::GetOpenId => Capability::GetOpenId,
        R::GetRtcTransports => Capability::GetRtcTransports,
        R::SearchUserDirectory { .. } => Capability::SearchUserDirectory,
        R::GetMediaConfig => Capability::GetMediaConfig,
        R::UploadFile { .. } => Capability::UploadFile,
        R::DownloadFile { .. } => Capability::DownloadFile,
        R::GetRtcLivekitToken { .. } => Capability::GetRtcLivekitToken,
        R::DelegateRtcLivekitDelayedLeave { .. } => Capability::DelegateRtcLivekitDelayedLeave,
        R::Navigate { .. } => Capability::Navigate,
        R::SetAlwaysOnScreen { .. } => Capability::SetAlwaysOnScreen,
        R::GetMatrixContext => Capability::GetMatrixContext,
        R::GetClientContext => Capability::GetClientContext,
        R::PaginateTimeline { .. } => Capability::PaginateTimeline,
        // The handshake works before any capability exists.
        R::NotifyReady | R::RequestCapabilities { .. } | R::Unknown => return None,
        // Checked against the body by the handler.
        R::SendEvent { .. }
        | R::SendToDevice { .. }
        | R::ReadTimeline { .. }
        | R::ReadRelations { .. }
        | R::ReadRoomAccountData { .. } => return None,
    })
}

/// The single capability the widget must hold for the driver to send it `request`.
///
/// `None` means either that no capability is needed, or that the check depends on the body and
/// happens where the push is built (`forward_event`, `update_state`, `forward_to_device`).
///
/// Exhaustive for the same reason as [`required_capability`].
pub(super) fn push_capability(request: &HostRequest) -> Option<Capability> {
    use HostRequest as H;
    Some(match request {
        H::UpdateTurnServers { .. } => Capability::UpdateTurnServers,
        H::UpdateTheme { .. } => Capability::UpdateTheme,
        H::UpdateLanguage { .. } => Capability::UpdateLanguage,
        H::UpdateVisibility { .. } => Capability::UpdateVisibility,
        H::NotifyTimelineUpdate { .. } => Capability::NotifyTimelineUpdate,
        // The handshake.
        H::UpdateCapabilities { .. } | H::Unknown => return None,
        // Checked against the event by the forwarding code.
        H::ForwardEvent { .. } | H::UpdateState { .. } | H::ForwardToDevice { .. } => return None,
    })
}

/// The error for a request that lacks `capability`.
pub(super) fn missing(capability: &Capability) -> WidgetError {
    WidgetError::missing_capability(capability)
}

/// Check a room the widget named explicitly (`room_id` in a request).
///
/// One widget, one room: no capability reaches another room, and naming the own room needs none.
pub(super) fn check_room(own_room: &str, room_id: &str) -> Result<(), WidgetError> {
    if room_id != own_room {
        return Err(WidgetError::invalid_request(format!(
            "Unable to access room {room_id}: a widget can only act in its own room ({own_room})"
        )));
    }
    Ok(())
}

/// Check the `room_ids` of `read_room_account_data`.
///
/// No selector and `*` both mean the widget's own room, the only room it can read. Explicitly
/// named rooms must each pass [`check_room`].
pub(super) fn check_rooms(own_room: &str, room_ids: Option<&RoomSelector>) -> Result<(), WidgetError> {
    match room_ids {
        None | Some(RoomSelector::Any) => Ok(()),
        Some(RoomSelector::Rooms { room_ids }) => room_ids.iter().try_for_each(|room_id| check_room(own_room, room_id)),
    }
}

/// Check every capability a `send_event` request needs: the event type itself, plus the
/// capabilities of the extensions it uses (a delay, a sticky duration).
pub(super) fn check_send_event(
    approved: &[Capability],
    own_room: &str,
    request: &SendEventRequest,
) -> Result<(), WidgetError> {
    if let Some(room_id) = &request.room_id {
        check_room(own_room, room_id)?;
    }
    if request.is_delayed() && !approved.has(&Capability::SendDelayedEvent) {
        return Err(missing(&Capability::SendDelayedEvent));
    }
    if request.is_sticky() && !approved.has(&Capability::SendStickyEvent) {
        return Err(missing(&Capability::SendStickyEvent));
    }
    if request.is_sticky() && request.is_state() {
        return Err(WidgetError::invalid_request("Cannot send a state event with a sticky duration"));
    }
    if !approved.allows_send(&request.event_type, request.state_key.as_deref(), msgtype(&request.content)) {
        return Err(missing(&match &request.state_key {
            Some(key) => Capability::send_state_event(&request.event_type, Some(key.as_str())),
            None => Capability::send_event(&request.event_type),
        }));
    }
    Ok(())
}

/// The filter the backend reads the timeline cache with for a `read_timeline`: the widget's
/// `filter` (every type when absent) reduced to what its `read_timeline:<type>[#<msgtype>]`
/// capabilities allow.
///
/// A filter entry the widget may not read is dropped, not an error. It is
/// `missing_capability` only when nothing is left: the widget holds no `read_timeline`
/// capability at all, or none for any entry of its filter. An empty `filter` is invalid.
pub(super) fn timeline_filter(
    approved: &[Capability],
    requested: Option<&[TimelineFilter]>,
) -> Result<Vec<TimelineFilter>, WidgetError> {
    let granted: Vec<TimelineFilter> = approved
        .iter()
        .filter_map(|c| match c {
            Capability::ReadTimeline { event_type, msgtype } => {
                Some(TimelineFilter { event_type: event_type.clone(), msgtype: msgtype.clone() })
            }
            _ => None,
        })
        .collect();
    let mut filter: Vec<TimelineFilter> = Vec::new();
    let mut add = |entry: TimelineFilter| {
        if !filter.contains(&entry) {
            filter.push(entry);
        }
    };
    match requested {
        None => granted.iter().cloned().for_each(&mut add),
        Some([]) => {
            return Err(WidgetError::invalid_request("`filter` must not be empty; leave it out to read every type"))
        }
        Some(requested) => {
            for wanted in requested {
                granted.iter().filter_map(|g| intersect(wanted, g)).for_each(&mut add);
            }
        }
    }
    if filter.is_empty() {
        let needed = match requested.and_then(|r| r.first()) {
            Some(TimelineFilter { event_type, msgtype }) => {
                Capability::ReadTimeline { event_type: event_type.clone(), msgtype: msgtype.clone() }.to_string()
            }
            None => Capability::read_timeline("<event type>").to_string(),
        };
        return Err(WidgetError::missing_capability(needed));
    }
    Ok(filter)
}

/// The events both filters match: the same type, and the stricter `msgtype`. `None` when they
/// match no event in common (other type, other `msgtype`).
fn intersect(a: &TimelineFilter, b: &TimelineFilter) -> Option<TimelineFilter> {
    if a.event_type != b.event_type {
        return None;
    }
    let msgtype = match (&a.msgtype, &b.msgtype) {
        (Some(x), Some(y)) if x != y => return None,
        (Some(m), _) | (None, Some(m)) => Some(m.clone()),
        (None, None) => None,
    };
    Some(TimelineFilter { event_type: a.event_type.clone(), msgtype })
}

/// May `event` be part of a `read_timeline` result, or named in `notify_timeline_update.decrypted`?
pub(super) fn may_read_timeline(approved: &[Capability], event: &MatrixEvent) -> bool {
    approved.allows_read_timeline(&event.event_type, msgtype(&event.content))
}

/// May `event` be part of a `read_relations` result?
pub(super) fn may_read_relation(approved: &[Capability], event: &MatrixEvent) -> bool {
    approved.allows_read_relation(&event.event_type, msgtype(&event.content))
}

/// Does the widget get the new timeline event `event` as `forward_event`?
pub(super) fn may_forward(approved: &[Capability], event: &MatrixEvent) -> bool {
    approved.allows_forward(&event.event_type, event.state_key.as_deref(), msgtype(&event.content))
}

/// Does the widget get the state event `event` in an `update_state`?
pub(super) fn may_update_state(approved: &[Capability], event: &MatrixEvent) -> bool {
    event.state_key.as_deref().is_some_and(|state_key| approved.allows_update_state(&event.event_type, state_key))
}

fn msgtype(content: &JsonValue) -> Option<&str> {
    content.get("msgtype").and_then(|m| m.as_str())
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};

    use super::*;

    const OWN: &str = "!own:x";

    fn event(event_type: &str, state_key: Option<&str>, content: Value) -> MatrixEvent {
        MatrixEvent {
            event_type: event_type.into(),
            sender: "@other:x".into(),
            event_id: "$in".into(),
            room_id: OWN.into(),
            origin_server_ts: 5,
            state_key: state_key.map(Into::into),
            content: content.into(),
            unsigned: None,
        }
    }

    #[test]
    fn every_action_has_its_own_capability() {
        // Today's shared capabilities are split: one per action.
        assert_eq!(required_capability(&WidgetRequest::GetMediaConfig), Some(Capability::GetMediaConfig));
        assert_eq!(required_capability(&WidgetRequest::GetOpenId), Some(Capability::GetOpenId));
        assert_eq!(required_capability(&WidgetRequest::UnwatchTurnServers), Some(Capability::UpdateTurnServers));
        assert_eq!(required_capability(&WidgetRequest::GetMatrixContext), Some(Capability::GetMatrixContext));
        // The handshake needs none.
        assert_eq!(required_capability(&WidgetRequest::NotifyReady), None);
        assert_eq!(missing(&Capability::Navigate).message, "Missing capability: widget:org.matrix.msc2931.navigate");
    }

    #[test]
    fn pushes_need_their_capability() {
        let theme = HostRequest::UpdateTheme { theme: json!({}).into() };
        assert_eq!(push_capability(&theme), Some(Capability::UpdateTheme));
        let notify = HostRequest::UpdateCapabilities { request: Default::default() };
        assert_eq!(push_capability(&notify), None);
    }

    #[test]
    fn a_widget_can_only_name_its_own_room() {
        assert!(check_room(OWN, OWN).is_ok());
        assert!(check_room(OWN, "!other:x").unwrap_err().message.contains("its own room"));

        assert!(check_rooms(OWN, None).is_ok());
        assert!(check_rooms(OWN, Some(&RoomSelector::Any)).is_ok());
        assert!(check_rooms(OWN, Some(&RoomSelector::Rooms { room_ids: vec![OWN.into()] })).is_ok());
        let mixed = RoomSelector::Rooms { room_ids: vec![OWN.into(), "!other:x".into()] };
        assert!(check_rooms(OWN, Some(&mixed)).is_err());
    }

    #[test]
    fn send_event() {
        let approved = vec![Capability::send_message("m.text"), Capability::SendDelayedEvent];
        let text = SendEventRequest::room_event("m.room.message", json!({"msgtype": "m.text"}).into());
        assert!(check_send_event(&approved, OWN, &text).is_ok());

        let image = SendEventRequest::room_event("m.room.message", json!({"msgtype": "m.image"}).into());
        let err = check_send_event(&approved, OWN, &image).unwrap_err();
        assert!(err.message.contains("send_event.timeline:m.room.message"), "{}", err.message);

        let mut delayed = text.clone();
        delayed.delay = Some(1);
        assert!(check_send_event(&approved, OWN, &delayed).is_ok());
        // The flag alone sends nothing: the event's own capability is still needed.
        let mut delayed_image = image;
        delayed_image.delay = Some(1);
        assert!(check_send_event(&approved, OWN, &delayed_image).is_err());

        let mut sticky = text.clone();
        sticky.sticky_duration_ms = Some(1);
        assert!(check_send_event(&approved, OWN, &sticky).unwrap_err().message.contains("send_event.sticky"));

        // Naming the own room needs no capability; another room cannot be reached at all.
        let mut own_room = text.clone();
        own_room.room_id = Some(OWN.into());
        assert!(check_send_event(&approved, OWN, &own_room).is_ok());
        let mut other_room = text;
        other_room.room_id = Some("!other:x".into());
        assert!(check_send_event(&approved, OWN, &other_room).unwrap_err().message.contains("its own room"));

        let state = SendEventRequest::state_event("m.room.topic", "", json!({}).into());
        let err = check_send_event(&approved, OWN, &state).unwrap_err();
        assert!(err.message.contains("send_event.state:m.room.topic#"), "{}", err.message);
    }

    #[test]
    fn read_forward_and_update_are_separate() {
        let message = event("m.room.message", None, json!({"msgtype": "m.text"}));
        let topic = event("m.room.topic", Some(""), json!({}));
        let none = None::<&str>;

        let read = vec![Capability::read_timeline("m.room.message"), Capability::read_timeline("m.room.topic")];
        assert!(may_read_timeline(&read, &message) && may_read_timeline(&read, &topic));
        assert!(!may_forward(&read, &message) && !may_forward(&read, &topic));
        assert!(!may_read_relation(&read, &message));
        assert!(!may_update_state(&read, &topic));

        let forward =
            vec![Capability::forward_event("m.room.message"), Capability::forward_state_event("m.room.topic", none)];
        assert!(may_forward(&forward, &message) && may_forward(&forward, &topic));
        assert!(!may_read_timeline(&forward, &message) && !may_update_state(&forward, &topic));

        let update = vec![Capability::update_state("m.room.topic", Some(""))];
        assert!(may_update_state(&update, &topic));
        assert!(!may_forward(&update, &topic) && !may_read_timeline(&update, &topic));
        // A timeline event is never part of a state update.
        assert!(!may_update_state(&[Capability::update_state("m.room.message", none)], &message));

        let relations = vec![Capability::read_relations("m.room.message")];
        assert!(may_read_relation(&relations, &message));
        assert!(!may_read_timeline(&relations, &message));
    }

    #[test]
    fn timeline_filter_is_what_the_widget_may_read() {
        let f = |t: &str, m: Option<&str>| TimelineFilter::new(t, m);
        let approved = vec![
            Capability::read_timeline("m.reaction"),
            Capability::read_timeline_messages("m.text"),
            Capability::read_timeline_messages("m.emote"),
            Capability::forward_event("m.room.topic"),
        ];
        let text = f("m.room.message", Some("m.text"));
        let emote = f("m.room.message", Some("m.emote"));
        // No filter: everything granted.
        assert_eq!(timeline_filter(&approved, None).unwrap(), [f("m.reaction", None), text.clone(), emote.clone()]);
        // A wider filter entry is narrowed to the granted msgtypes; an unreadable entry is dropped.
        let wanted = [f("m.room.message", None), f("m.room.topic", None), text.clone()];
        assert_eq!(timeline_filter(&approved, Some(&wanted)).unwrap(), [text.clone(), emote]);
        // A narrower entry stays narrow, another msgtype matches nothing.
        let wanted = [f("m.room.message", Some("m.text")), f("m.room.message", Some("m.image"))];
        assert_eq!(timeline_filter(&approved, Some(&wanted)).unwrap(), [text]);
        // Nothing left: missing capability, named after the first entry.
        let err = timeline_filter(&approved, Some(&[f("m.room.topic", None)])).unwrap_err();
        assert_eq!(err.kind(), widget_actions::ErrorKind::MissingCapability);
        assert!(err.message.contains("widget:org.matrix.mscXXXX.read_timeline:m.room.topic"), "{}", err.message);
        let err = timeline_filter(&approved, Some(&[f("m.room.message", Some("m.image"))])).unwrap_err();
        assert!(err.message.ends_with("read_timeline:m.room.message#m.image"), "{}", err.message);
        let err = timeline_filter(&[Capability::Navigate], None).unwrap_err();
        assert_eq!(err.kind(), widget_actions::ErrorKind::MissingCapability);
        assert_eq!(
            timeline_filter(&approved, Some(&[])).unwrap_err().kind(),
            widget_actions::ErrorKind::InvalidRequest
        );
        // A capability for all msgtypes keeps the entry's own msgtype.
        let all_messages = vec![Capability::read_timeline("m.room.message")];
        assert_eq!(
            timeline_filter(&all_messages, Some(&[f("m.room.message", Some("m.notice"))])).unwrap(),
            [f("m.room.message", Some("m.notice"))]
        );
    }

    #[test]
    fn timeline_actions_need_their_capabilities() {
        use widget_actions::{NotifyTimelineUpdateRequest, PaginateTimelineRequest, ReadTimelineRequest};
        let paginate = WidgetRequest::PaginateTimeline { request: PaginateTimelineRequest::default() };
        assert_eq!(required_capability(&paginate), Some(Capability::PaginateTimeline));
        // Checked against the body.
        assert_eq!(required_capability(&WidgetRequest::ReadTimeline { request: ReadTimelineRequest::newest(1) }), None);
        let notify = HostRequest::NotifyTimelineUpdate { request: NotifyTimelineUpdateRequest::default() };
        assert_eq!(push_capability(&notify), Some(Capability::NotifyTimelineUpdate));
    }
}
