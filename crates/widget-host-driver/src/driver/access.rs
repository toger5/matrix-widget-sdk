//! The driver's permission rules: which capability a request needs, which rooms a widget may name
//! and which events it may see.
//!
//! Every function here only looks at the approved capabilities and the request, so the rules can
//! be tested without a driver, backend or platform.

use widget_actions::{
    Capability, CapabilitySet, MatrixEvent, RoomSelector, SendEventRequest, WidgetError, WidgetRequest,
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
        R::WatchTurnServers | R::UnwatchTurnServers => Capability::TurnServers,
        R::GetRtcTransports => Capability::RtcTransports,
        R::UserDirectorySearch { .. } => Capability::UserDirectorySearch,
        // An uploader needs the media config, so reading it comes with the upload capability.
        R::GetMediaConfig | R::UploadFile { .. } => Capability::UploadFile,
        R::DownloadFile { .. } => Capability::DownloadFile,
        R::RtcLivekitGetToken { .. } => Capability::RtcLivekitGetToken,
        R::RtcLivekitDelegateDelayedLeave { .. } => Capability::RtcLivekitDelegateDelayedLeave,
        R::Navigate { .. } => Capability::Navigate,
        R::SendSticker { .. } => Capability::Sticker,
        R::SetAlwaysOnScreen { .. } => Capability::AlwaysOnScreen,
        R::MatrixContext => Capability::MatrixContext,
        R::ClientContext => Capability::ClientContext,
        // Always allowed. `get_openid` asks the user instead.
        R::ContentLoaded | R::RequestCapabilities { .. } | R::GetOpenId | R::Unknown => return None,
        // Checked against the body by the handler.
        R::SendEvent { .. }
        | R::SendToDevice { .. }
        | R::ReadEvents { .. }
        | R::ReadRelations { .. }
        | R::ReadRoomAccountData { .. } => return None,
    })
}

/// The error for a request that lacks `capability`.
pub(super) fn missing(capability: &Capability) -> WidgetError {
    WidgetError::new(format!("Missing capability for {capability}"))
}

/// Check a room the widget named explicitly (`room_id` or `room_ids` in a request).
///
/// Naming a room needs `timeline:<room_id>` or `timeline:*`, even for the widget's own room
/// (as in matrix-widget-api). This host serves only `own_room`, so any other room fails.
pub(super) fn check_room(approved: &[Capability], own_room: &str, room_id: &str) -> Result<(), WidgetError> {
    if !may_access_timeline(approved, room_id) {
        return Err(WidgetError::new(format!("Unable to access room timeline: {room_id}")));
    }
    if room_id != own_room {
        return Err(WidgetError::new(format!(
            "Unable to access room timeline: {room_id} (this host serves {own_room})"
        )));
    }
    Ok(())
}

/// Which rooms a read with a `room_ids` selector covers on this single-room host.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum ReadScope {
    /// Read the widget's own room.
    OwnRoom,
    /// The widget asked for `*` but may not read any room: answer with an empty result.
    Nothing,
}

/// Resolve the `room_ids` of `read_events` / `read_room_account_data`.
///
/// No selector means the own room. `*` means every room the widget may read, which here is the
/// own room or nothing. Explicitly named rooms must each pass [`check_room`].
pub(super) fn read_scope(
    approved: &[Capability],
    own_room: &str,
    room_ids: Option<&RoomSelector>,
) -> Result<ReadScope, WidgetError> {
    match room_ids {
        None => Ok(ReadScope::OwnRoom),
        Some(RoomSelector::Any) if may_access_timeline(approved, own_room) => Ok(ReadScope::OwnRoom),
        Some(RoomSelector::Any) => Ok(ReadScope::Nothing),
        Some(RoomSelector::Rooms { room_ids }) => {
            for room_id in room_ids {
                check_room(approved, own_room, room_id)?;
            }
            Ok(ReadScope::OwnRoom)
        }
    }
}

fn may_access_timeline(approved: &[Capability], room_id: &str) -> bool {
    approved.has(&Capability::timeline(room_id)) || approved.has(&Capability::timeline("*"))
}

/// Check every capability a `send_event` request needs: the event type itself, plus the
/// capabilities of the extensions it uses (another room, a delay, a sticky duration).
pub(super) fn check_send_event(
    approved: &[Capability],
    own_room: &str,
    request: &SendEventRequest,
) -> Result<(), WidgetError> {
    if let Some(room_id) = &request.room_id {
        check_room(approved, own_room, room_id)?;
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
    let msgtype = request.content.get("msgtype").and_then(|m| m.as_str());
    if !approved.allows_send(&request.event_type, request.state_key.as_deref(), msgtype) {
        return Err(missing(&match &request.state_key {
            Some(key) => Capability::send_state_event(&request.event_type, Some(key.as_str())),
            None => Capability::send_event(&request.event_type),
        }));
    }
    Ok(())
}

/// May the widget see `event`, either pushed by the driver or in a read result?
pub(super) fn may_receive(approved: &[Capability], event: &MatrixEvent) -> bool {
    let msgtype = event.content.get("msgtype").and_then(|m| m.as_str());
    approved.allows_receive(&event.event_type, event.state_key.as_deref(), msgtype)
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    const OWN: &str = "!own:x";

    #[test]
    fn unit_capabilities() {
        assert_eq!(required_capability(&WidgetRequest::GetMediaConfig), Some(Capability::UploadFile));
        assert_eq!(required_capability(&WidgetRequest::UnwatchTurnServers), Some(Capability::TurnServers));
        assert_eq!(required_capability(&WidgetRequest::GetOpenId), None);
        assert_eq!(missing(&Capability::Navigate).message, "Missing capability for org.matrix.msc2931.navigate");
    }

    #[test]
    fn rooms() {
        let none: Vec<Capability> = vec![];
        let own = vec![Capability::timeline(OWN)];
        let any = vec![Capability::timeline("*")];

        assert!(check_room(&none, OWN, OWN).is_err());
        assert!(check_room(&own, OWN, OWN).is_ok());
        assert!(check_room(&any, OWN, OWN).is_ok());
        // Even `timeline:*` cannot reach a room this host does not serve.
        assert!(check_room(&any, OWN, "!other:x").unwrap_err().message.contains("this host serves"));

        assert_eq!(read_scope(&none, OWN, None), Ok(ReadScope::OwnRoom));
        assert_eq!(read_scope(&none, OWN, Some(&RoomSelector::Any)), Ok(ReadScope::Nothing));
        assert_eq!(read_scope(&own, OWN, Some(&RoomSelector::Any)), Ok(ReadScope::OwnRoom));
        let named = RoomSelector::Rooms { room_ids: vec![OWN.into()] };
        assert!(read_scope(&none, OWN, Some(&named)).is_err());
        assert_eq!(read_scope(&own, OWN, Some(&named)), Ok(ReadScope::OwnRoom));
    }

    #[test]
    fn send_event() {
        let approved = vec![Capability::send_message("m.text"), Capability::SendDelayedEvent];
        let text = SendEventRequest::room_event("m.room.message", json!({"msgtype": "m.text"}).into());
        assert!(check_send_event(&approved, OWN, &text).is_ok());

        let image = SendEventRequest::room_event("m.room.message", json!({"msgtype": "m.image"}).into());
        let err = check_send_event(&approved, OWN, &image).unwrap_err();
        assert!(err.message.contains("send.event:m.room.message"), "{}", err.message);

        let mut delayed = text.clone();
        delayed.delay = Some(1);
        assert!(check_send_event(&approved, OWN, &delayed).is_ok());

        let mut sticky = text.clone();
        sticky.sticky_duration_ms = Some(1);
        assert!(check_send_event(&approved, OWN, &sticky).unwrap_err().message.contains("send.sticky_event"));

        let mut other_room = text;
        other_room.room_id = Some(OWN.into());
        assert!(check_send_event(&approved, OWN, &other_room).unwrap_err().message.contains("timeline"));

        let state = SendEventRequest::state_event("m.room.topic", "", json!({}).into());
        let err = check_send_event(&approved, OWN, &state).unwrap_err();
        assert!(err.message.contains("send.state_event:m.room.topic#"), "{}", err.message);
    }
}
