//! The driver's permission rules: which capability a request or a push needs, which room a widget
//! may name and which events it may see.
//!
//! Every action has its own capability (`docs/spec-appendix/capability-naming-proposal.md`), so
//! reading, being forwarded new events and receiving state updates are checked separately.
//!
//! Every function here only looks at the approved capabilities and the request, so the rules can
//! be tested without a driver, backend or platform.

use widget_actions::{
    Capability, CapabilitySet, HostRequest, JsonValue, MatrixEvent, RoomSelector, SendEventRequest, WidgetError,
    WidgetRequest,
};

/// The single capability that allows or denies `request` as a whole.
///
/// `None` means either that no capability is needed, or that the check depends on the request
/// body and happens in the request's handler (`send_event`, `read_events`, ...).
///
/// The list is exhaustive on purpose: a new action does not compile until it has a rule here.
pub(super) fn required_capability(request: &WidgetRequest) -> Option<Capability> {
    use WidgetRequest as R;
    Some(match request {
        R::UpdateDelayedEvent { .. } => Capability::UpdateDelayedEvent,
        // Watching is how the widget starts the `update_turn_servers` pushes.
        R::WatchTurnServers | R::UnwatchTurnServers => Capability::UpdateTurnServers,
        // The capability allows asking; the user may still be asked per request.
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
        // The handshake works before any capability exists.
        R::ContentLoaded | R::RequestCapabilities { .. } | R::Unknown => return None,
        // Checked against the body by the handler.
        R::SendEvent { .. }
        | R::SendToDevice { .. }
        | R::ReadEvents { .. }
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
        // The handshake, and the late reply to a `get_openid` that was already allowed.
        H::NotifyCapabilities { .. } | H::ForwardOpenIdCredentials { .. } | H::Unknown => return None,
        // Checked against the event by the forwarding code.
        H::ForwardEvent { .. } | H::UpdateState { .. } | H::ForwardToDevice { .. } => return None,
    })
}

/// The error for a request that lacks `capability`.
pub(super) fn missing(capability: &Capability) -> WidgetError {
    WidgetError::new(format!("Missing capability for {capability}"))
}

/// Check a room the widget named explicitly (`room_id` in a request).
///
/// One widget, one room: no capability reaches another room, and naming the own room needs none.
pub(super) fn check_room(own_room: &str, room_id: &str) -> Result<(), WidgetError> {
    if room_id != own_room {
        return Err(WidgetError::new(format!(
            "Unable to access room {room_id}: a widget can only act in its own room ({own_room})"
        )));
    }
    Ok(())
}

/// Check the `room_ids` of `read_events` / `read_room_account_data`.
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
        return Err(WidgetError::new("Cannot send a state event with a sticky duration"));
    }
    if !approved.allows_send(&request.event_type, request.state_key.as_deref(), msgtype(&request.content)) {
        return Err(missing(&match &request.state_key {
            Some(key) => Capability::send_state_event(&request.event_type, Some(key.as_str())),
            None => Capability::send_event(&request.event_type),
        }));
    }
    Ok(())
}

/// May `event` be part of a `read_events` result?
pub(super) fn may_read(approved: &[Capability], event: &MatrixEvent) -> bool {
    approved.allows_read(&event.event_type, event.state_key.as_deref(), msgtype(&event.content))
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
        assert_eq!(required_capability(&WidgetRequest::ContentLoaded), None);
        assert_eq!(missing(&Capability::Navigate).message, "Missing capability for widget:org.matrix.mscXXXX.navigate");
    }

    #[test]
    fn pushes_need_their_capability() {
        let theme = HostRequest::UpdateTheme { theme: json!({}).into() };
        assert_eq!(push_capability(&theme), Some(Capability::UpdateTheme));
        let notify = HostRequest::NotifyCapabilities { request: Default::default() };
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

        let read = vec![Capability::read_events("m.room.message"), Capability::read_state_events("m.room.topic", none)];
        assert!(may_read(&read, &message) && may_read(&read, &topic));
        assert!(!may_forward(&read, &message) && !may_forward(&read, &topic));
        assert!(!may_read_relation(&read, &message));
        assert!(!may_update_state(&read, &topic));

        let forward =
            vec![Capability::forward_event("m.room.message"), Capability::forward_state_event("m.room.topic", none)];
        assert!(may_forward(&forward, &message) && may_forward(&forward, &topic));
        assert!(!may_read(&forward, &message) && !may_update_state(&forward, &topic));

        let update = vec![Capability::update_state("m.room.topic", Some(""))];
        assert!(may_update_state(&update, &topic));
        assert!(!may_forward(&update, &topic) && !may_read(&update, &topic));
        // A timeline event is never part of a state update.
        assert!(!may_update_state(&[Capability::update_state("m.room.message", none)], &message));

        let relations = vec![Capability::read_relations("m.room.message")];
        assert!(may_read_relation(&relations, &message));
        assert!(!may_read(&relations, &message));
    }
}
