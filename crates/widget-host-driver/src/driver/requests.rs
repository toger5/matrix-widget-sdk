//! Answering the widget's requests.
//!
//! [`handle_request`](WidgetHostDriver::handle_request) first checks the request's capability
//! (see [`access`]) and uses it up if it is single use. A few requests must reply before their side
//! effect and send their reply themselves. All others go through
//! [`answer`](WidgetHostDriver::answer), which computes the response, and `handle_request` sends
//! it. A used-up capability is announced after the reply.

use widget_actions::{
    Base64File, Capability, CapabilitySet, DownloadFileRequest, DownloadFileResponse, GetClientContextResponse,
    GetMatrixContextResponse, GetRtcLivekitTokenResponse, HostRequest, ReadEventsRequest, ReadEventsResponse,
    ReadRelationsRequest, ReadRelationsResponse, ReadRoomAccountDataRequest, ReadRoomAccountDataResponse,
    RtcTransportsResponse, SendEventRequest, SendEventResponse, SendToDeviceRequest, SetAlwaysOnScreenResponse,
    UpdateCapabilitiesRequest, UpdateDelayedEventAction, UpdateDelayedEventRequest, UploadFileRequest,
    UploadFileResponse, WidgetError, WidgetRequest, WidgetResponse, WireMessage,
};
use widget_matrix_backend::{BackendError, MediaFile, ToDeviceMessage};

use super::access;
use super::WidgetHostDriver;
use crate::{PlatformError, WebviewPolicy};

/// Number of events `read_events` returns when the widget gives no `limit`.
const DEFAULT_READ_LIMIT: u32 = 50;
/// Upper bound for the `limit` of `read_events`.
const MAX_READ_LIMIT: u32 = 1000;

/// A `limit` from the wire for the backend. On the wire a limit is a `u64`, so that any number a
/// widget sends parses and is cut down here instead of failing the whole request. The backend
/// takes a `u32`: no page is that large, and a `u64` would be a `bigint` in the TypeScript
/// bindings.
fn backend_limit(limit: u64) -> u32 {
    u32::try_from(limit).unwrap_or(u32::MAX)
}

impl WidgetHostDriver {
    pub(super) async fn handle_request(&self, msg: WireMessage, request: WidgetRequest) {
        let mut used_up = false;
        if let Some(capability) = access::required_capability(&request) {
            // A statement of its own: the lock must be released before anything is sent.
            let used = self.lock().use_capability(&capability);
            let Some(single_use) = used else {
                log::warn!("{} ({}) refused: the widget does not hold {capability}", msg.action, msg.request_id);
                return self.send(&msg.error_response_to(access::missing(&capability)));
            };
            if single_use {
                log::info!("{} ({}) used up the single-use {capability}", msg.action, msg.request_id);
            }
            used_up = single_use;
        }
        match request {
            // These reply first, so that the widget sees the reply before what the request causes.
            WidgetRequest::NotifyReady => {
                self.lock().ready = true;
                log::info!("the widget is ready");
                self.send(&msg.ack());
                self.platform.on_ready();
            }
            WidgetRequest::RequestCapabilities { request } => self.request_capabilities(&msg, request.capabilities),
            WidgetRequest::WatchTurnServers => self.watch_turn_servers(&msg),
            request => {
                let reply = match self.answer(request, &msg.action).await {
                    Ok(response) => response.into_wire_reply(&msg),
                    Err(error) => {
                        log::warn!("{} ({}) failed: {} ({})", msg.action, msg.request_id, error.message, error.code);
                        msg.error_response_to(error)
                    }
                };
                self.send(&reply);
            }
        }
        if used_up {
            // After the reply that used it (`spec/patch/msc4412/capability-lifetimes.md`), with the
            // list as it is now: the platform may have changed it while the request ran.
            let allowed = self.approved();
            self.send_request(HostRequest::UpdateCapabilities { request: UpdateCapabilitiesRequest { allowed } });
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
            R::GetOpenId => W::GetOpenId {
                response: backend.openid_token().await.map_err(backend_error("Failed to get an OpenID token"))?,
            },
            R::UnwatchTurnServers => {
                self.turn_subscription.cancel();
                W::UnwatchTurnServers
            }
            R::GetRtcTransports => W::GetRtcTransports { response: self.rtc_transports().await? },
            R::SearchUserDirectory { request } => W::SearchUserDirectory {
                response: backend
                    .search_user_directory(request.search_term, request.limit.map(backend_limit))
                    .await
                    .map_err(backend_error("Failed to search the user directory"))?,
            },
            R::GetMediaConfig => W::GetMediaConfig {
                response: backend.media_config().await.map_err(backend_error("Failed to get the media config"))?,
            },
            R::UploadFile { request } => W::UploadFile { response: self.upload_file(request).await? },
            R::DownloadFile { request } => W::DownloadFile { response: self.download_file(request).await? },
            R::GetRtcLivekitToken { request } => W::GetRtcLivekitToken {
                response: GetRtcLivekitTokenResponse {
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
            R::DelegateRtcLivekitDelayedLeave { request } => {
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
                W::DelegateRtcLivekitDelayedLeave
            }
            R::Navigate { request } => {
                if !request.uri.starts_with("https://matrix.to/#") {
                    return Err(WidgetError::invalid_request("Invalid matrix.to URI"));
                }
                self.platform.navigate(request.uri).map_err(platform_error("Error handling navigation"))?;
                W::Navigate
            }
            R::SetAlwaysOnScreen { request } => W::SetAlwaysOnScreen {
                response: SetAlwaysOnScreenResponse { success: self.platform.set_always_on_screen(request.value) },
            },
            R::GetMatrixContext => W::GetMatrixContext {
                response: GetMatrixContextResponse {
                    user_id: backend.own_user_id(),
                    device_id: backend.own_device_id(),
                    room_id: backend.room_id(),
                    display_name: backend.display_name(),
                    avatar_url: backend.avatar_url(),
                    matrix_base_url: backend.base_url(),
                },
            },
            R::GetClientContext => W::GetClientContext {
                response: GetClientContextResponse {
                    client_id: self.platform.client_id(),
                    client_theme: self.platform.client_theme(),
                    client_language: self.platform.client_language(),
                },
            },
            R::Unknown => return Err(WidgetError::unknown_action(action)),
            R::NotifyReady | R::RequestCapabilities { .. } | R::WatchTurnServers => {
                unreachable!("`handle_request` replies to these itself")
            }
        })
    }

    /// `request_capabilities`: acknowledge, then merge the request into the open question.
    ///
    /// * No question is open: if the widget holds or gets without asking everything it requests,
    ///   the negotiation completes at once; otherwise the platform is asked about the rest.
    /// * A question is open (the platform has not answered yet): the request joins it, and nothing
    ///   completes before the platform answers, so one `update_capabilities` answers every
    ///   request. If the request added something to decide, the platform is asked again, about
    ///   the whole question.
    ///
    /// Webview capabilities that are granted or refused by policy ([`WebviewPolicy`]: the base
    /// `sandbox` tokens, `allow-top-navigation`) need no decision; the platform is not asked about them.
    ///
    /// The ack grants nothing. A widget can only ever ask for more.
    fn request_capabilities(&self, msg: &WireMessage, requested: Vec<Capability>) {
        enum Next {
            Complete,
            Ask(Vec<Capability>),
            Wait,
        }
        let next = {
            let mut state = self.lock();
            let open = state.pending_requested.is_some();
            let before = state.question();
            let pending = state.pending_requested.get_or_insert_with(Vec::new);
            for capability in requested {
                if WebviewPolicy::of(&capability) == Some(WebviewPolicy::Never) {
                    log::warn!("the widget requests {capability}, which is never granted");
                }
                if !pending.contains(&capability) {
                    pending.push(capability);
                }
            }
            let question = state.question();
            log::info!(
                "the widget requests capabilities, {} of them wait for the platform's decision{}",
                question.len(),
                if open { " (joined the open question)" } else { "" }
            );
            if !open && question.is_empty() {
                Next::Complete
            } else if question.iter().any(|c| !before.contains(c)) {
                Next::Ask(question)
            } else {
                Next::Wait
            }
        };
        self.send(&msg.ack());
        match next {
            Next::Complete => self.approve_capabilities(Vec::new()),
            Next::Ask(question) => self.platform.on_capabilities_requested(question),
            Next::Wait => {}
        }
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
    /// widget may not read (e.g. other state keys or msgtypes).
    async fn read_events(&self, request: ReadEventsRequest) -> Result<ReadEventsResponse, WidgetError> {
        let approved = self.approved();
        let room_id = self.backend.room_id();
        access::check_rooms(&room_id, request.room_ids.as_ref())?;
        if !approved.allows_read_type(&request.event_type, request.is_state()) {
            let needed = if request.is_state() {
                Capability::read_state_events(&request.event_type, None::<&str>)
            } else {
                Capability::read_events(&request.event_type)
            };
            return Err(access::missing(&needed));
        }
        let limit = request.limit.map_or(DEFAULT_READ_LIMIT, backend_limit).clamp(1, MAX_READ_LIMIT);
        let events = match request.state_key {
            Some(selector) => self.backend.read_room_state(room_id, request.event_type, selector).await,
            None => {
                self.backend.read_room_events(room_id, request.event_type, request.msgtype, limit, request.since).await
            }
        }
        .map_err(backend_error("Failed to read events"))?;
        let mut events: Vec<_> = events.into_iter().filter(|e| access::may_read(&approved, e)).collect();
        events.truncate(limit as usize);
        Ok(ReadEventsResponse { events })
    }

    /// `read_relations`: the page is reduced to the related events the widget holds a
    /// `read_relations:<type>` capability for. Without any, the page is empty.
    async fn read_relations(&self, request: ReadRelationsRequest) -> Result<ReadRelationsResponse, WidgetError> {
        let approved = self.approved();
        let room_id = self.backend.room_id();
        if let Some(requested) = &request.room_id {
            access::check_room(&room_id, requested)?;
        }
        let ReadRelationsRequest { event_id, rel_type, event_type, limit, from, to, direction, .. } = request;
        let page = self
            .backend
            .relations(room_id, event_id, rel_type, event_type, from, to, limit.map(backend_limit), direction)
            .await
            .map_err(backend_error("Failed to read relations"))?;
        Ok(ReadRelationsResponse {
            chunk: page.chunk.into_iter().filter(|e| access::may_read_relation(&approved, e)).collect(),
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
        access::check_rooms(&room_id, request.room_ids.as_ref())?;
        if !approved.allows_read_room_account_data(&request.event_type) {
            return Err(access::missing(&Capability::read_room_account_data(&request.event_type)));
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
        let data =
            request.file.to_bytes().map_err(|e| WidgetError::invalid_request(format!("Invalid base64 file: {e}")))?;
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
