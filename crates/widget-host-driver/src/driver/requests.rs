//! Answering the widget's requests.
//!
//! [`handle_request`](WidgetHostDriver::handle_request) first checks the request's capability
//! (see [`access`]). A few requests must reply before their side effect and send their reply
//! themselves. All others go through [`answer`](WidgetHostDriver::answer), which computes the
//! response, and `handle_request` sends it.

use widget_actions::{
    Base64File, Capability, CapabilitySet, ClientContextResponse, DownloadFileRequest, DownloadFileResponse,
    GetOpenIdResponse, MatrixContextResponse, ReadEventsRequest, ReadEventsResponse, ReadRelationsRequest,
    ReadRelationsResponse, ReadRoomAccountDataRequest, ReadRoomAccountDataResponse, RtcLivekitGetTokenResponse,
    RtcTransportsResponse, SendEventRequest, SendEventResponse, SendToDeviceRequest, SetAlwaysOnScreenResponse,
    UpdateDelayedEventAction, UpdateDelayedEventRequest, UploadFileRequest, UploadFileResponse, WidgetError,
    WidgetRequest, WidgetResponse, WireMessage,
};
use widget_matrix_backend::{BackendError, MediaFile, ToDeviceMessage};

use super::access::{self, ReadScope};
use super::WidgetHostDriver;
use crate::PlatformError;

/// Number of events `read_events` returns when the widget gives no `limit`.
const DEFAULT_READ_LIMIT: u32 = 50;
/// Upper bound for the `limit` of `read_events`.
const MAX_READ_LIMIT: u32 = 1000;

impl WidgetHostDriver {
    pub(super) async fn handle_request(&self, msg: WireMessage, request: WidgetRequest) {
        if let Some(capability) = access::required_capability(&request) {
            if !self.approved().has(&capability) {
                return self.send(&msg.error_response_to(access::missing(&capability)));
            }
        }
        match request {
            // These reply first, so that the widget sees the reply before what the request causes.
            WidgetRequest::ContentLoaded => {
                self.lock().content_loaded = true;
                self.send(&msg.ack());
                self.platform.on_content_loaded();
            }
            WidgetRequest::RequestCapabilities { request } => self.request_capabilities(&msg, request.capabilities),
            WidgetRequest::GetOpenId if !self.lock().openid_auto_approved => self.ask_for_openid(&msg),
            WidgetRequest::WatchTurnServers => self.watch_turn_servers(&msg),
            request => {
                let reply = match self.answer(request, &msg.action).await {
                    Ok(response) => response.into_wire_reply(&msg),
                    Err(error) => msg.error_response_to(error),
                };
                self.send(&reply);
            }
        }
    }

    /// The response to a request that is answered after its work is done. The capability from
    /// [`access::required_capability`] has already been checked.
    async fn answer(&self, request: WidgetRequest, action: &str) -> Result<WidgetResponse, WidgetError> {
        use WidgetRequest as R;
        use WidgetResponse as W;
        let backend = &self.backend;
        Ok(match request {
            R::SendEvent { request } => W::SendEvent { response: self.send_event(request).await? },
            R::SendToDevice { request } => {
                self.send_to_device(request).await?;
                W::SendToDevice
            }
            R::ReadEvents { request } => W::ReadEvents { response: self.read_events(request).await? },
            R::ReadRelations { request } => W::ReadRelations { response: self.read_relations(request).await? },
            R::ReadRoomAccountData { request } => {
                W::ReadRoomAccountData { response: self.read_room_account_data(request).await? }
            }
            R::UpdateDelayedEvent { request } => {
                self.update_delayed_event(request).await?;
                W::UpdateDelayedEvent
            }
            // Only reached when OpenID is auto-approved; otherwise `ask_for_openid` replies.
            R::GetOpenId => W::GetOpenId {
                response: match backend.openid_token().await {
                    Ok(token) => GetOpenIdResponse::allowed(token),
                    Err(_) => GetOpenIdResponse::blocked(),
                },
            },
            R::UnwatchTurnServers => {
                self.turn_subscription.cancel();
                W::UnwatchTurnServers
            }
            R::GetRtcTransports => W::GetRtcTransports { response: self.rtc_transports().await? },
            R::UserDirectorySearch { request } => W::UserDirectorySearch {
                response: backend
                    .search_user_directory(request.search_term, request.limit)
                    .await
                    .map_err(backend_error("Failed to search the user directory"))?,
            },
            R::GetMediaConfig => W::GetMediaConfig {
                response: backend.media_config().await.map_err(backend_error("Failed to get the media config"))?,
            },
            R::UploadFile { request } => W::UploadFile { response: self.upload_file(request).await? },
            R::DownloadFile { request } => W::DownloadFile { response: self.download_file(request).await? },
            R::RtcLivekitGetToken { request } => W::RtcLivekitGetToken {
                response: RtcLivekitGetTokenResponse {
                    jwt: backend
                        .rtc_livekit_get_token(
                            request.server_name,
                            request.url,
                            request.room_id,
                            request.slot_id,
                            request.member_id,
                        )
                        .await
                        .map_err(backend_error("Failed to get a LiveKit token"))?,
                },
            },
            R::RtcLivekitDelegateDelayedLeave { request } => {
                backend
                    .rtc_livekit_delegate_delayed_leave(
                        request.url,
                        request.room_id,
                        request.slot_id,
                        request.member_id,
                        request.delay_id,
                    )
                    .await
                    .map_err(backend_error("Failed to delegate the delayed leave"))?;
                W::RtcLivekitDelegateDelayedLeave
            }
            R::Navigate { request } => {
                if !request.uri.starts_with("https://matrix.to/#") {
                    return Err(WidgetError::new("Invalid matrix.to URI"));
                }
                self.platform.navigate(request.uri).map_err(platform_error("Error handling navigation"))?;
                W::Navigate
            }
            R::SetAlwaysOnScreen { request } => W::SetAlwaysOnScreen {
                response: SetAlwaysOnScreenResponse { success: self.platform.set_always_on_screen(request.value) },
            },
            R::MatrixContext => W::MatrixContext {
                response: MatrixContextResponse {
                    user_id: backend.own_user_id(),
                    device_id: backend.own_device_id(),
                    room_id: backend.room_id(),
                    display_name: backend.display_name(),
                    avatar_url: backend.avatar_url(),
                    matrix_base_url: backend.base_url(),
                },
            },
            R::ClientContext => W::ClientContext {
                response: ClientContextResponse {
                    client_id: self.platform.client_id(),
                    client_theme: self.platform.client_theme(),
                    client_language: self.platform.client_language(),
                },
            },
            R::Unknown => return Err(WidgetError::new(format!("Unknown action `{action}`"))),
            R::ContentLoaded | R::RequestCapabilities { .. } | R::WatchTurnServers => {
                unreachable!("`handle_request` replies to these itself")
            }
        })
    }

    /// `request_capabilities`: acknowledge, grant the auto-approved capabilities and ask the
    /// platform about the rest. When nothing is left to ask, the negotiation completes at once.
    fn request_capabilities(&self, msg: &WireMessage, requested: Vec<Capability>) {
        let to_ask: Vec<Capability> = {
            let mut state = self.lock();
            let to_ask = requested.iter().filter(|c| !state.auto_approved.contains(c)).cloned().collect();
            state.pending_requested = Some(requested);
            to_ask
        };
        self.send(&msg.ack());
        if to_ask.is_empty() {
            self.approve_capabilities(Vec::new());
        } else {
            self.platform.on_capabilities_requested(to_ask);
        }
    }

    /// `get_openid` without auto-approval: tell the widget that the user is being asked, then ask.
    /// [`resolve_openid`](Self::resolve_openid) sends the outcome later.
    fn ask_for_openid(&self, msg: &WireMessage) {
        self.lock().pending_openid.push(msg.request_id.clone());
        self.send(&WidgetResponse::GetOpenId { response: GetOpenIdResponse::pending() }.into_wire_reply(msg));
        self.platform.on_openid_requested();
    }

    /// `send_event`: check every capability involved, then call the backend method for the kind
    /// of event (plain, state, sticky, delayed or delayed sticky).
    async fn send_event(&self, request: SendEventRequest) -> Result<SendEventResponse, WidgetError> {
        let room_id = self.backend.room_id();
        access::check_send_event(&self.approved(), &room_id, &request)?;

        let SendEventRequest { event_type, state_key, content, delay, sticky_duration_ms, .. } = request;
        let backend = &self.backend;
        let room = room_id.clone();
        let response = match (state_key, delay, sticky_duration_ms) {
            (state_key, Some(delay), None) => backend
                .send_delayed_event(room, event_type, state_key, content, delay)
                .await
                .map(|id| SendEventResponse::delayed(&room_id, id)),
            (None, Some(delay), Some(duration)) => backend
                .send_delayed_sticky_event(room, event_type, content, delay, duration)
                .await
                .map(|id| SendEventResponse::delayed(&room_id, id)),
            (Some(key), None, None) => backend
                .send_state_event(room, event_type, key, content)
                .await
                .map(|id| SendEventResponse::sent(&room_id, id)),
            (None, None, Some(duration)) => backend
                .send_sticky_event(room, event_type, content, duration)
                .await
                .map(|id| SendEventResponse::sent(&room_id, id)),
            (None, None, None) => {
                backend.send_room_event(room, event_type, content).await.map(|id| SendEventResponse::sent(&room_id, id))
            }
            (Some(_), _, Some(_)) => unreachable!("`check_send_event` refuses sticky state events"),
        };
        response.map_err(backend_error("Failed to send event"))
    }

    /// `send_to_device`: one backend call for all recipients. If any recipient fails, the whole
    /// request fails, because the widget api cannot report a partial result.
    async fn send_to_device(&self, request: SendToDeviceRequest) -> Result<(), WidgetError> {
        if !self.approved().allows_send_to_device(&request.event_type) {
            return Err(access::missing(&Capability::send_to_device(&request.event_type)));
        }
        let messages: Vec<ToDeviceMessage> = request
            .messages
            .into_iter()
            .flat_map(|(user_id, devices)| {
                devices.into_iter().map(move |(device_id, content)| ToDeviceMessage {
                    user_id: user_id.clone(),
                    device_id,
                    content,
                })
            })
            .collect();
        let deliveries = self
            .backend
            .send_to_device_message(request.encrypted, request.event_type, messages)
            .await
            .map_err(backend_error("Failed to send to-device message"))?;
        let failed: Vec<String> = deliveries
            .into_iter()
            .filter_map(|d| d.error.map(|e| format!("{}/{}: {e}", d.user_id, d.device_id)))
            .collect();
        if !failed.is_empty() {
            return Err(WidgetError::new(format!("Failed to send to-device message to {}", failed.join(", "))));
        }
        Ok(())
    }

    /// `read_events`: check the rooms and the event type, read from the backend, and drop what the
    /// widget may not receive (e.g. other state keys or msgtypes).
    async fn read_events(&self, request: ReadEventsRequest) -> Result<ReadEventsResponse, WidgetError> {
        let approved = self.approved();
        let room_id = self.backend.room_id();
        if access::read_scope(&approved, &room_id, request.room_ids.as_ref())? == ReadScope::Nothing {
            return Ok(ReadEventsResponse::default());
        }
        if !approved.allows_read_type(&request.event_type, request.is_state()) {
            let needed = if request.is_state() {
                Capability::receive_state_event(&request.event_type, None::<&str>)
            } else {
                Capability::receive_event(&request.event_type)
            };
            return Err(access::missing(&needed));
        }
        let limit = request.limit.unwrap_or(DEFAULT_READ_LIMIT).clamp(1, MAX_READ_LIMIT);
        let events = match request.state_key {
            Some(selector) => self.backend.read_room_state(room_id, request.event_type, selector).await,
            None => {
                self.backend.read_room_events(room_id, request.event_type, request.msgtype, limit, request.since).await
            }
        }
        .map_err(backend_error("Failed to read events"))?;
        let mut events: Vec<_> = events.into_iter().filter(|e| access::may_receive(&approved, e)).collect();
        events.truncate(limit as usize);
        Ok(ReadEventsResponse { events })
    }

    /// `read_relations`: needs no capability of its own. The page is reduced to the events the
    /// widget may receive, as in matrix-widget-api.
    async fn read_relations(&self, request: ReadRelationsRequest) -> Result<ReadRelationsResponse, WidgetError> {
        let approved = self.approved();
        let room_id = self.backend.room_id();
        if let Some(requested) = &request.room_id {
            access::check_room(&approved, &room_id, requested)?;
        }
        let ReadRelationsRequest { event_id, rel_type, event_type, limit, from, to, direction, .. } = request;
        let page = self
            .backend
            .relations(room_id, event_id, rel_type, event_type, from, to, limit, direction)
            .await
            .map_err(backend_error("Failed to read relations"))?;
        Ok(ReadRelationsResponse {
            chunk: page.chunk.into_iter().filter(|e| access::may_receive(&approved, e)).collect(),
            next_batch: page.next_batch,
            prev_batch: page.prev_batch,
        })
    }

    /// `read_room_account_data`: the room rules of `read_events`, then the capability for the type.
    async fn read_room_account_data(
        &self,
        request: ReadRoomAccountDataRequest,
    ) -> Result<ReadRoomAccountDataResponse, WidgetError> {
        let approved = self.approved();
        let room_id = self.backend.room_id();
        if access::read_scope(&approved, &room_id, request.room_ids.as_ref())? == ReadScope::Nothing {
            return Ok(ReadRoomAccountDataResponse::default());
        }
        if !approved.allows_receive_room_account_data(&request.event_type) {
            return Err(access::missing(&Capability::receive_room_account_data(&request.event_type)));
        }
        let events = self
            .backend
            .read_room_account_data(room_id, request.event_type)
            .await
            .map_err(backend_error("Failed to read room account data"))?;
        Ok(ReadRoomAccountDataResponse { events })
    }

    async fn update_delayed_event(&self, request: UpdateDelayedEventRequest) -> Result<(), WidgetError> {
        let (room_id, delay_id) = (self.backend.room_id(), request.delay_id);
        match request.action {
            UpdateDelayedEventAction::Cancel => self.backend.cancel_delayed_event(room_id, delay_id).await,
            UpdateDelayedEventAction::Restart => self.backend.restart_delayed_event(room_id, delay_id).await,
            UpdateDelayedEventAction::Send => self.backend.send_delayed_event_now(room_id, delay_id).await,
        }
        .map_err(backend_error("Failed to update delayed event"))
    }

    /// `get_rtc_transports`: the backend returns the raw `rtc_transports` JSON; `null` counts as
    /// no transports.
    async fn rtc_transports(&self) -> Result<RtcTransportsResponse, WidgetError> {
        let transports =
            self.backend.rtc_transports().await.map_err(backend_error("Failed to get the RTC transports"))?;
        match transports.into_inner() {
            serde_json::Value::Array(items) => {
                Ok(RtcTransportsResponse { rtc_transports: items.into_iter().map(Into::into).collect() })
            }
            serde_json::Value::Null => Ok(RtcTransportsResponse::default()),
            other => Err(WidgetError::new(format!("The backend returned no transport list: {other}"))),
        }
    }

    /// `upload_file`: decode the widget's base64 and hand the raw bytes to the backend.
    async fn upload_file(&self, request: UploadFileRequest) -> Result<UploadFileResponse, WidgetError> {
        let data = request.file.to_bytes().map_err(|e| WidgetError::new(format!("Invalid base64 file: {e}")))?;
        let file = MediaFile { data, mimetype: request.file.mimetype };
        let content_uri = self.backend.upload_media(file).await.map_err(backend_error("Failed to upload the file"))?;
        Ok(UploadFileResponse { content_uri })
    }

    /// `download_file`: fetch the raw bytes from the backend and encode them as base64.
    async fn download_file(&self, request: DownloadFileRequest) -> Result<DownloadFileResponse, WidgetError> {
        let media = self
            .backend
            .download_media(request.content_uri)
            .await
            .map_err(backend_error("Failed to download the file"))?;
        Ok(DownloadFileResponse { file: Base64File::from_bytes(&media.data, media.mimetype) })
    }
}

/// Turns a failed backend call into the widget's error: `"<context>: <reason>"` as the message,
/// plus the Matrix error details (if the backend had any) as `matrix_api_error`.
fn backend_error(context: &'static str) -> impl FnOnce(BackendError) -> WidgetError {
    move |err| {
        WidgetError::with_matrix_error(
            format!("{context}: {}", err.reason()),
            err.errcode().map(str::to_owned),
            err.status(),
            err.reason(),
        )
    }
}

/// Turns a failed platform call into the widget's error: `"<context>: <reason>"`.
fn platform_error(context: &'static str) -> impl FnOnce(PlatformError) -> WidgetError {
    move |err| WidgetError::new(format!("{context}: {}", err.reason()))
}
