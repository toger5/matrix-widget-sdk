use std::cell::RefCell;
use std::collections::HashMap;
use std::future::Future;
use std::rc::{Rc, Weak};

use futures_channel::oneshot;
use serde::{Deserialize, Serialize};
use serde_json::Value;
// TODO consider splitting those into widget_actions::widget and widget_actions::host so that they are more explicit here.
use widget_actions::{
    ActionError, Base64File, Capability, ClientContextResponse, DownloadFileRequest, HostRequest, JsonValue,
    MatrixContextResponse, MatrixEvent, MediaConfigResponse, MessageKind, NavigateRequest, OpenIdCredentialsRequest,
    OpenIdState, OpenIdToken, ReadEventsRequest, ReadRelationsRequest, ReadRelationsResponse,
    ReadRoomAccountDataRequest, RequestCapabilitiesRequest, RoomAccountData, RtcLivekitDelegateDelayedLeaveRequest,
    RtcLivekitGetTokenRequest, SendEventRequest, SendEventResponse, SendToDeviceRequest, SetAlwaysOnScreenRequest,
    StateKeySelector, StickerRequest, ToDeviceEvent, TurnServer, UpdateDelayedEventAction, UpdateDelayedEventRequest,
    UploadFileRequest, UploadFileResponse, UserDirectorySearchRequest, UserDirectorySearchResponse, WidgetError,
    WidgetRequest, WidgetResponse, WireMessage, API_VERSION_V1,
};

use crate::WidgetClientError;

/// Callbacks from the [`WidgetClient`] into the widget application / transport.
///
/// Only [`send_to_host`](WidgetDelegate::send_to_host) is mandatory. The others have empty
/// default implementations.
pub trait WidgetDelegate {
    /// Deliver a JSON encoded message to the host, e.g. `window.parent.postMessage(...)`.
    fn send_to_host(&self, json: String);

    /// A room event the host forwarded to this widget (`send_event` from the host).
    fn on_matrix_event(&self, _event: MatrixEvent) {}

    /// The host pushed (part of) the current room state (`update_state`).
    fn on_state_update(&self, _state: Vec<MatrixEvent>) {}

    /// A to-device message the host forwarded to this widget (`send_to_device` from the host).
    fn on_to_device_message(&self, _message: ToDeviceEvent) {}

    /// New TURN credentials while watching them (`update_turn_servers`).
    fn on_turn_server(&self, _server: TurnServer) {}

    /// The client's theme changed (`theme_change`); the object's shape is up to the client.
    fn on_theme_change(&self, _theme: Value) {}

    /// The client's UI language changed (`language_change`); a BCP 47 tag.
    fn on_language_change(&self, _lang: String) {}

    /// The client started or stopped showing the widget (`visibility`).
    fn on_visibility_change(&self, _visible: bool) {}

    /// A capability negotiation finished. `approved` is the complete set now held.
    fn on_capabilities_changed(&self, _requested: Vec<Capability>, _approved: Vec<Capability>) {}
}

/// Snapshot of what the client knows about its session with the host.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetState {
    /// `content_loaded` was sent and acknowledged.
    pub content_loaded: bool,
    /// Capabilities of the most recent `request_capabilities` that is still unanswered.
    pub pending_requested: Vec<Capability>,
    /// All capabilities the host has approved so far.
    pub approved: Vec<Capability>,
}

#[derive(Default)]
struct Inner {
    state: WidgetState,
    pending: HashMap<String, oneshot::Sender<WireMessage>>,
    /// `get_openid` requests answered with `state: request`, waiting for `openid_credentials`.
    openid_waiters: HashMap<String, oneshot::Sender<OpenIdCredentialsRequest>>,
}

/// The widget side state machine. See the crate documentation.
pub struct WidgetClient {
    delegate: Rc<dyn WidgetDelegate>,
    inner: Rc<RefCell<Inner>>,
    next_id: Box<dyn Fn() -> String>,
}

impl WidgetClient {
    /// Create a client that generates uuid v4 request ids.
    pub fn new(delegate: Rc<dyn WidgetDelegate>) -> Self {
        Self::with_id_generator(delegate, || uuid::Uuid::new_v4().to_string())
    }

    /// Create a client with a custom request id generator (deterministic ids in tests, ...).
    pub fn with_id_generator(delegate: Rc<dyn WidgetDelegate>, next_id: impl Fn() -> String + 'static) -> Self {
        Self { delegate, inner: Rc::new(RefCell::new(Inner::default())), next_id: Box::new(next_id) }
    }

    pub fn state(&self) -> WidgetState {
        self.inner.borrow().state.clone()
    }

    /// Whether `capability` has been approved by the host.
    pub fn has_capability(&self, capability: &Capability) -> bool {
        self.inner.borrow().state.approved.contains(capability)
    }

    // ---- outgoing ---------------------------------------------------------------------------

    /// Send any widget request. The returned future is `'static` and resolves once the host's
    /// response has been fed into [`handle_message_from_host`](Self::handle_message_from_host).
    /// The request itself is sent synchronously, before this returns.
    pub fn request(
        &self,
        request: WidgetRequest,
    ) -> impl Future<Output = Result<WidgetResponse, WidgetClientError>> + 'static {
        self.request_with_id(request).1
    }

    /// [`request`](Self::request), also returning the request id it was sent with.
    pub fn request_with_id(
        &self,
        request: WidgetRequest,
    ) -> (String, impl Future<Output = Result<WidgetResponse, WidgetClientError>> + 'static) {
        let id = (self.next_id)();
        let (tx, rx) = oneshot::channel();
        self.inner.borrow_mut().pending.insert(id.clone(), tx);
        self.delegate.send_to_host(request.into_wire(id.clone()).to_json());
        let fut = async move {
            let msg = rx.await.map_err(|_| WidgetClientError::Cancelled)?;
            match WidgetResponse::from_wire(&msg) {
                Ok(response) => Ok(response),
                Err(ActionError::ErrorResponse { error }) => Err(WidgetClientError::Host(error)),
                Err(other) => Err(other.into()),
            }
        };
        (id, fut)
    }

    /// Ask the host for an OpenID token (MSC1960). Resolves with the token once the host (and
    /// possibly the user) allowed it, which may take a while; fails with
    /// [`WidgetClientError::OpenIdBlocked`] when refused.
    pub fn request_openid_token(&self) -> impl Future<Output = Result<OpenIdToken, WidgetClientError>> + 'static {
        let (id, fut) = self.request_with_id(WidgetRequest::GetOpenId);
        let (tx, rx) = oneshot::channel();
        self.inner.borrow_mut().openid_waiters.insert(id.clone(), tx);
        let inner: Weak<RefCell<Inner>> = Rc::downgrade(&self.inner);
        async move {
            let unexpected = || WidgetClientError::UnexpectedResponse { action: "get_openid".into() };
            let response = match fut.await? {
                WidgetResponse::GetOpenId { response } => response,
                _ => return Err(unexpected()),
            };
            if response.state != OpenIdState::PendingUserConfirmation {
                if let Some(inner) = inner.upgrade() {
                    inner.borrow_mut().openid_waiters.remove(&id);
                }
                return match response.state {
                    OpenIdState::Allowed => response.token().ok_or_else(unexpected),
                    _ => Err(WidgetClientError::OpenIdBlocked),
                };
            }
            // Phase two: the host sends `openid_credentials` once the user decided.
            let credentials = rx.await.map_err(|_| WidgetClientError::Cancelled)?;
            match credentials.state {
                OpenIdState::Allowed => credentials.token().ok_or_else(unexpected),
                _ => Err(WidgetClientError::OpenIdBlocked),
            }
        }
    }

    /// Tell the host the widget is ready to be shown. Required when the widget state event has
    /// `usesWidgetAPI: true`; the host shows a spinner until this arrives.
    pub fn content_loaded(&self) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        // Only a weak handle: dropping the client must cancel the future, not keep state alive.
        let inner: Weak<RefCell<Inner>> = Rc::downgrade(&self.inner);
        let fut = self.request(WidgetRequest::ContentLoaded);
        async move {
            fut.await?;
            if let Some(inner) = inner.upgrade() {
                inner.borrow_mut().state.content_loaded = true;
            }
            Ok(())
        }
    }

    /// Ask the host about the embedding client (id, theme, language). Needs `m.client_context`.
    pub fn get_client_context(
        &self,
    ) -> impl Future<Output = Result<ClientContextResponse, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::ClientContext);
        async move {
            match fut.await? {
                WidgetResponse::ClientContext { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "client_context".into() }),
            }
        }
    }

    /// Ask the host who and where this widget is on Matrix (user, device, room, display name,
    /// avatar, homeserver). Needs `m.matrix_context`.
    pub fn get_matrix_context(
        &self,
    ) -> impl Future<Output = Result<MatrixContextResponse, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::MatrixContext);
        async move {
            match fut.await? {
                WidgetResponse::MatrixContext { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "matrix_context".into() }),
            }
        }
    }

    /// Ask the host for capabilities. Resolves when the host *acknowledged* the request; the
    /// actual decision arrives later through [`WidgetDelegate::on_capabilities_changed`] and
    /// is visible in [`state`](Self::state).
    pub fn request_capabilities(
        &self,
        capabilities: Vec<Capability>,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.inner.borrow_mut().state.pending_requested = capabilities.clone();
        let fut =
            self.request(WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities } });
        async move { fut.await.map(|_| ()) }
    }

    /// Send a timeline event. Needs an approved `send.event:<type>` capability.
    pub fn send_event(
        &self,
        event_type: impl Into<String>,
        content: Value,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        self.send_event_request(SendEventRequest::room_event(event_type, content.into()))
    }

    /// Send a state event. Needs an approved `send.state_event:<type>[#<state_key>]` capability.
    pub fn send_state_event(
        &self,
        event_type: impl Into<String>,
        state_key: impl Into<String>,
        content: Value,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        self.send_event_request(SendEventRequest::state_event(event_type, state_key, content.into()))
    }

    /// Send a sticky event (MSC4407) that the homeserver keeps for `duration_ms`. Needs the
    /// matching `send.event` capability and `org.matrix.msc4407.send.sticky_event`.
    pub fn send_sticky_event(
        &self,
        event_type: impl Into<String>,
        content: Value,
        duration_ms: u64,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        let mut request = SendEventRequest::room_event(event_type, content.into());
        request.sticky_duration_ms = Some(duration_ms);
        self.send_event_request(request)
    }

    /// Schedule an event (MSC4157): a state event with `state_key`, a timeline event without.
    /// Resolves with the **delay id** for [`update_delayed_event`](Self::update_delayed_event).
    /// Needs the matching `send.*` capability and `org.matrix.msc4157.send.delayed_event`.
    pub fn send_delayed_event(
        &self,
        event_type: impl Into<String>,
        state_key: Option<String>,
        content: Value,
        delay_ms: u64,
    ) -> impl Future<Output = Result<String, WidgetClientError>> + 'static {
        let mut request = SendEventRequest::room_event(event_type, content.into());
        request.state_key = state_key;
        request.delay = Some(delay_ms);
        let fut = self.send_event_request(request);
        async move { fut.await?.delay_id.ok_or(WidgetClientError::UnexpectedResponse { action: "send_event".into() }) }
    }

    /// Cancel, restart or fire a delayed event. Needs `org.matrix.msc4157.update_delayed_event`.
    pub fn update_delayed_event(
        &self,
        delay_id: impl Into<String>,
        action: UpdateDelayedEventAction,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::UpdateDelayedEvent {
            request: UpdateDelayedEventRequest { delay_id: delay_id.into(), action },
        });
        async move {
            match fut.await? {
                WidgetResponse::UpdateDelayedEvent => Ok(()),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "update_delayed_event".into() }),
            }
        }
    }

    /// Send any `send_event` request as is (every MSC2762 / MSC4157 / MSC4407 field).
    pub fn send_event_request(
        &self,
        request: SendEventRequest,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::SendEvent { request });
        async move {
            match fut.await? {
                WidgetResponse::SendEvent { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "send_event".into() }),
            }
        }
    }

    /// Read recent timeline events of a type. Needs `receive.event:<type>`.
    pub fn read_events(
        &self,
        event_type: impl Into<String>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        self.read_events_request(ReadEventsRequest::timeline(event_type, limit))
    }

    /// Read current state events of a type. Needs `receive.state_event:<type>[#<state_key>]`.
    pub fn read_state(
        &self,
        event_type: impl Into<String>,
        state_key: StateKeySelector,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        self.read_events_request(ReadEventsRequest::state(event_type, state_key))
    }

    /// Send a to-device message (MSC3819): `messages` is `user_id -> device_id -> content`
    /// (`*` as device id means every device of the user). Needs
    /// `org.matrix.msc3819.send.to_device:<type>`.
    pub fn send_to_device(
        &self,
        event_type: impl Into<String>,
        encrypted: bool,
        messages: HashMap<String, HashMap<String, Value>>,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        let messages = messages
            .into_iter()
            .map(|(user, devices)| (user, devices.into_iter().map(|(d, c)| (d, JsonValue::from(c))).collect()))
            .collect();
        let fut = self.request(WidgetRequest::SendToDevice {
            request: SendToDeviceRequest { event_type: event_type.into(), encrypted, messages },
        });
        async move {
            match fut.await? {
                WidgetResponse::SendToDevice => Ok(()),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "send_to_device".into() }),
            }
        }
    }

    /// Ask the client to open a `https://matrix.to/#/` permalink (MSC2931). Needs
    /// `org.matrix.msc2931.navigate`.
    pub fn navigate(&self, uri: impl Into<String>) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.unit_request(WidgetRequest::Navigate { request: NavigateRequest { uri: uri.into() } }, "navigate")
    }

    /// Ask the client to send a sticker (`m.sticker`). Needs `m.sticker`.
    pub fn send_sticker(
        &self,
        sticker: StickerRequest,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.unit_request(WidgetRequest::SendSticker { request: sticker }, "m.sticker")
    }

    /// Ask the client to keep the widget on screen (or stop). Resolves with whether it will.
    /// Needs `m.always_on_screen`.
    pub fn set_always_on_screen(&self, value: bool) -> impl Future<Output = Result<bool, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::SetAlwaysOnScreen { request: SetAlwaysOnScreenRequest { value } });
        async move {
            match fut.await? {
                WidgetResponse::SetAlwaysOnScreen { response } => Ok(response.success),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "set_always_on_screen".into() }),
            }
        }
    }

    /// Start receiving TURN credentials through [`WidgetDelegate::on_turn_server`] (MSC3846).
    /// Needs `town.robin.msc3846.turn_servers`.
    pub fn watch_turn_servers(&self) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.unit_request(WidgetRequest::WatchTurnServers, "watch_turn_servers")
    }

    /// Stop receiving TURN credentials.
    pub fn unwatch_turn_servers(&self) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.unit_request(WidgetRequest::UnwatchTurnServers, "unwatch_turn_servers")
    }

    /// The homeserver's MatrixRTC transports (MSC4515), each `{ "type": ..., ... }`. Needs
    /// `org.matrix.msc4515.rtc_transports`.
    pub fn get_rtc_transports(&self) -> impl Future<Output = Result<Vec<Value>, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::GetRtcTransports);
        async move {
            match fut.await? {
                WidgetResponse::GetRtcTransports { response } => {
                    Ok(response.rtc_transports.into_iter().map(JsonValue::into_inner).collect())
                }
                _ => Err(WidgetClientError::UnexpectedResponse { action: "get_rtc_transports".into() }),
            }
        }
    }

    /// Search the user directory (MSC3973). Needs `org.matrix.msc3973.user_directory_search`.
    pub fn search_user_directory(
        &self,
        search_term: impl Into<String>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<UserDirectorySearchResponse, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::UserDirectorySearch {
            request: UserDirectorySearchRequest { search_term: search_term.into(), limit },
        });
        async move {
            match fut.await? {
                WidgetResponse::UserDirectorySearch { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "user_directory_search".into() }),
            }
        }
    }

    /// The homeserver's media config (MSC4039). Needs `org.matrix.msc4039.upload_file`.
    pub fn get_media_config(&self) -> impl Future<Output = Result<MediaConfigResponse, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::GetMediaConfig);
        async move {
            match fut.await? {
                WidgetResponse::GetMediaConfig { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "get_media_config".into() }),
            }
        }
    }

    /// Upload a file to the media repository and get its `mxc://` URI. Needs
    /// `org.matrix.msc4039.upload_file`.
    pub fn upload_file(
        &self,
        file: Base64File,
    ) -> impl Future<Output = Result<UploadFileResponse, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::UploadFile { request: UploadFileRequest { file } });
        async move {
            match fut.await? {
                WidgetResponse::UploadFile { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "upload_file".into() }),
            }
        }
    }

    /// Download an `mxc://` URI. Needs `org.matrix.msc4039.download_file`.
    pub fn download_file(
        &self,
        content_uri: impl Into<String>,
    ) -> impl Future<Output = Result<Base64File, WidgetClientError>> + 'static {
        let fut = self
            .request(WidgetRequest::DownloadFile { request: DownloadFileRequest { content_uri: content_uri.into() } });
        async move {
            match fut.await? {
                WidgetResponse::DownloadFile { response } => Ok(response.file),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "download_file".into() }),
            }
        }
    }

    /// Read room account data of `event_type`. Needs
    /// `com.beeper.capabilities.receive.room_account_data:<type>`.
    pub fn read_room_account_data(
        &self,
        event_type: impl Into<String>,
    ) -> impl Future<Output = Result<Vec<RoomAccountData>, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::ReadRoomAccountData {
            request: ReadRoomAccountDataRequest { event_type: event_type.into(), room_ids: None },
        });
        async move {
            match fut.await? {
                WidgetResponse::ReadRoomAccountData { response } => Ok(response.events),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "read_room_account_data".into() }),
            }
        }
    }

    /// A LiveKit JWT from the client (MSC4533). Needs `org.matrix.msc4533.rtc_livekit_get_token`.
    pub fn rtc_livekit_get_token(
        &self,
        request: RtcLivekitGetTokenRequest,
    ) -> impl Future<Output = Result<String, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::RtcLivekitGetToken { request });
        async move {
            match fut.await? {
                WidgetResponse::RtcLivekitGetToken { response } => Ok(response.jwt),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "rtc_livekit_get_token".into() }),
            }
        }
    }

    /// Hand a delayed leave to the client's LiveKit service (MSC4533). Needs
    /// `org.matrix.msc4533.rtc_livekit_delegate_delayed_leave`.
    pub fn rtc_livekit_delegate_delayed_leave(
        &self,
        request: RtcLivekitDelegateDelayedLeaveRequest,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.unit_request(
            WidgetRequest::RtcLivekitDelegateDelayedLeave { request },
            "rtc_livekit_delegate_delayed_leave",
        )
    }

    /// A request whose success response is `{}`.
    fn unit_request(
        &self,
        request: WidgetRequest,
        action: &'static str,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        let fut = self.request(request);
        async move {
            match fut.await? {
                WidgetResponse::Unknown => Err(WidgetClientError::UnexpectedResponse { action: action.into() }),
                _ => Ok(()),
            }
        }
    }

    /// Read the events relating to `request.event_id` (MSC3869). The host filters the page by
    /// the `receive.*` capabilities.
    pub fn read_relations(
        &self,
        request: ReadRelationsRequest,
    ) -> impl Future<Output = Result<ReadRelationsResponse, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::ReadRelations { request });
        async move {
            match fut.await? {
                WidgetResponse::ReadRelations { response } => Ok(response),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "read_relations".into() }),
            }
        }
    }

    /// Send any `read_events` request as is (`msgtype`, `room_ids`, `since`, ...).
    pub fn read_events_request(
        &self,
        request: ReadEventsRequest,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        let fut = self.request(WidgetRequest::ReadEvents { request });
        async move {
            match fut.await? {
                WidgetResponse::ReadEvents { response } => Ok(response.events),
                _ => Err(WidgetClientError::UnexpectedResponse { action: "read_events".into() }),
            }
        }
    }

    // ---- incoming ---------------------------------------------------------------------------

    /// Feed a JSON message received from the host. Acknowledgements are sent through the
    /// delegate and pending request futures are resolved before this returns.
    pub fn handle_message_from_host(&self, json: &str) -> Result<(), WidgetClientError> {
        self.handle_message(WireMessage::from_json(json)?)
    }

    /// Like [`handle_message_from_host`](Self::handle_message_from_host) for an already parsed envelope.
    pub fn handle_message(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        match msg.version.as_deref() {
            Some(API_VERSION_V1) => {}
            other => return Err(WidgetClientError::UnsupportedVersion { version: other.unwrap_or("").to_owned() }),
        }
        // Responses are parsed by the future awaiting them (see `request`), so a malformed body
        // is reported to the caller instead of failing here.
        match msg.kind() {
            MessageKind::WidgetResponse => self.resolve_response(msg),
            MessageKind::HostRequest => self.handle_host_request(msg),
            kind => Err(WidgetClientError::WrongDirection { message: format!("widget received a {kind:?} message") }),
        }
    }

    fn resolve_response(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        let sender = self.inner.borrow_mut().pending.remove(&msg.request_id);
        match sender {
            Some(tx) => {
                // The receiver may have been dropped; that is not an error.
                let _ = tx.send(msg);
                Ok(())
            }
            None => Err(WidgetClientError::UnknownRequestId { request_id: msg.request_id }),
        }
    }

    fn handle_host_request(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        let request = match HostRequest::from_wire(&msg) {
            Ok(r) => r,
            Err(ActionError::InvalidBody { message, .. }) => {
                self.send(msg.error_response_to(WidgetError::new(format!("Invalid request body: {message}"))));
                return Ok(());
            }
            Err(e) => return Err(e.into()),
        };
        match request {
            HostRequest::NotifyCapabilities { request } => {
                let approved = {
                    let mut inner = self.inner.borrow_mut();
                    inner.state.pending_requested.clear();
                    for cap in request.approved {
                        if !inner.state.approved.contains(&cap) {
                            inner.state.approved.push(cap);
                        }
                    }
                    inner.state.approved.clone()
                };
                self.send(msg.ack());
                self.delegate.on_capabilities_changed(request.requested, approved);
            }
            HostRequest::SendEvent { event } => {
                self.send(msg.ack());
                self.delegate.on_matrix_event(event);
            }
            HostRequest::UpdateState { request } => {
                self.send(msg.ack());
                self.delegate.on_state_update(request.state);
            }
            HostRequest::SendToDevice { message } => {
                self.send(msg.ack());
                self.delegate.on_to_device_message(message);
            }
            HostRequest::UpdateTurnServers { server } => {
                self.send(msg.ack());
                self.delegate.on_turn_server(server);
            }
            HostRequest::ThemeChange { theme } => {
                self.send(msg.ack());
                self.delegate.on_theme_change(theme.into_inner());
            }
            HostRequest::LanguageChange { request } => {
                self.send(msg.ack());
                self.delegate.on_language_change(request.lang);
            }
            HostRequest::Visibility { request } => {
                self.send(msg.ack());
                self.delegate.on_visibility_change(request.visible);
            }
            HostRequest::OpenIdCredentials { request } => {
                self.send(msg.ack());
                let waiter = self.inner.borrow_mut().openid_waiters.remove(&request.original_request_id);
                if let Some(tx) = waiter {
                    let _ = tx.send(request);
                }
            }
            HostRequest::Unknown => {
                self.send(msg.error_response_to(WidgetError::new(format!("Unknown action `{}`", msg.action))));
            }
        }
        Ok(())
    }

    fn send(&self, msg: WireMessage) {
        self.delegate.send_to_host(msg.to_json());
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use serde_json::json;
    use widget_actions::{NotifyCapabilitiesRequest, Source};

    use super::*;

    #[derive(Default)]
    struct Recorder {
        sent: RefCell<Vec<WireMessage>>,
        events: RefCell<Vec<MatrixEvent>>,
        caps_changed: Cell<u32>,
    }

    impl Recorder {
        fn drain(&self) -> Vec<WireMessage> {
            std::mem::take(&mut *self.sent.borrow_mut())
        }
    }

    impl WidgetDelegate for Recorder {
        fn send_to_host(&self, json: String) {
            self.sent.borrow_mut().push(WireMessage::from_json(&json).unwrap());
        }
        fn on_matrix_event(&self, event: MatrixEvent) {
            self.events.borrow_mut().push(event);
        }
        fn on_capabilities_changed(&self, _requested: Vec<Capability>, _approved: Vec<Capability>) {
            self.caps_changed.set(self.caps_changed.get() + 1);
        }
    }

    fn setup() -> (WidgetClient, Rc<Recorder>) {
        let rec = Rc::new(Recorder::default());
        let counter = Cell::new(0);
        let client = WidgetClient::with_id_generator(rec.clone(), move || {
            counter.set(counter.get() + 1);
            format!("req-{}", counter.get())
        });
        (client, rec)
    }

    fn block<F: Future>(f: F) -> F::Output {
        futures::executor::block_on(f)
    }

    #[test]
    fn content_loaded_roundtrip() {
        let (client, rec) = setup();
        let fut = client.content_loaded();
        let sent = rec.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, "content_loaded");
        assert_eq!(sent[0].request_id, "req-1");
        assert_eq!(sent[0].source, Source::Widget);
        assert!(sent[0].is_v1());
        assert!(!client.state().content_loaded);

        client.handle_message_from_host(&sent[0].ack().to_json()).unwrap();
        block(fut).unwrap();
        assert!(client.state().content_loaded);
    }

    #[test]
    fn send_event_and_error() {
        let (client, rec) = setup();
        let fut = client.send_event("m.room.message", json!({"body": "x"}));
        let sent = rec.drain();
        assert_eq!(sent[0].request_body()["content"]["body"], "x");
        client
            .handle_message_from_host(&sent[0].response_to(json!({"room_id": "!r", "event_id": "$e"})).to_json())
            .unwrap();
        assert_eq!(block(fut).unwrap(), SendEventResponse::sent("!r", "$e"));

        let fut = client.send_state_event("m.room.topic", "", json!({"topic": "t"}));
        let sent = rec.drain();
        assert_eq!(sent[0].request_body()["state_key"], "");
        client.handle_message_from_host(&sent[0].error_response_to(WidgetError::new("denied")).to_json()).unwrap();
        assert_eq!(block(fut), Err(WidgetClientError::Host(WidgetError::new("denied"))));

        // Delayed: the delay id is the result.
        let fut = client.send_delayed_event("m.room.message", None, json!({}), 5000);
        let sent = rec.drain();
        assert_eq!(sent[0].request_body()["delay"], 5000);
        client
            .handle_message_from_host(&sent[0].response_to(json!({"room_id": "!r", "delay_id": "d"})).to_json())
            .unwrap();
        assert_eq!(block(fut).unwrap(), "d");
        let fut = client.update_delayed_event("d", UpdateDelayedEventAction::Cancel);
        let sent = rec.drain();
        assert_eq!(sent[0].action, "org.matrix.msc4157.update_delayed_event");
        assert_eq!(sent[0].request_body()["action"], "cancel");
        client.handle_message_from_host(&sent[0].ack().to_json()).unwrap();
        block(fut).unwrap();

        // Wrong shaped success body
        let fut = client.read_events("m.room.message", Some(3));
        let sent = rec.drain();
        assert_eq!(sent[0].request_body()["limit"], 3);
        client.handle_message_from_host(&sent[0].response_to(json!({"events": "nope"})).to_json()).unwrap();
        assert!(matches!(block(fut), Err(WidgetClientError::Protocol(ActionError::InvalidBody { .. }))));
    }

    #[test]
    fn capabilities_flow() {
        let (client, rec) = setup();
        let caps = vec![Capability::send_event("a"), Capability::receive_event("b")];
        let fut = client.request_capabilities(caps.clone());
        assert_eq!(client.state().pending_requested, caps);
        let sent = rec.drain();
        client.handle_message(sent[0].ack()).unwrap();
        block(fut).unwrap();

        let notify = HostRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest { requested: caps, approved: vec![Capability::send_event("a")] },
        }
        .into_wire("host-1");
        client.handle_message(notify.clone()).unwrap();
        let sent = rec.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].request_id, "host-1");
        assert_eq!(sent[0].source, Source::Host);
        assert_eq!(sent[0].response_body(), json!({}));
        assert_eq!(rec.caps_changed.get(), 1);
        assert!(client.has_capability(&Capability::send_event("a")));
        assert!(!client.has_capability(&Capability::receive_event("b")));
        assert!(client.state().pending_requested.is_empty());

        // Re-exchange merges.
        let notify2 = HostRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest {
                requested: vec![Capability::receive_event("b")],
                approved: vec![Capability::receive_event("b")],
            },
        }
        .into_wire("host-2");
        client.handle_message(notify2).unwrap();
        assert_eq!(client.state().approved.len(), 2);
    }

    #[test]
    fn openid_phases() {
        let (client, rec) = setup();
        let token = OpenIdToken {
            access_token: "t".into(),
            token_type: "Bearer".into(),
            matrix_server_name: "x".into(),
            expires_in: 1,
        };
        // Allowed right away.
        let fut = client.request_openid_token();
        let sent = rec.drain();
        assert_eq!(sent[0].action, "get_openid");
        client
            .handle_message(
                sent[0].response_to(json!({"state": "allowed", "access_token": "t", "token_type": "Bearer",
                                           "matrix_server_name": "x", "expires_in": 1})),
            )
            .unwrap();
        assert_eq!(block(fut).unwrap(), token);

        // Blocked right away.
        let fut = client.request_openid_token();
        let sent = rec.drain();
        client.handle_message(sent[0].response_to(json!({"state": "blocked"}))).unwrap();
        assert_eq!(block(fut), Err(WidgetClientError::OpenIdBlocked));

        // Pending, then credentials for that request id.
        let fut = client.request_openid_token();
        let sent = rec.drain();
        let id = sent[0].request_id.clone();
        client.handle_message(sent[0].response_to(json!({"state": "request"}))).unwrap();
        let creds = HostRequest::OpenIdCredentials { request: OpenIdCredentialsRequest::allowed(id, token.clone()) }
            .into_wire("h");
        client.handle_message(creds).unwrap();
        assert_eq!(rec.drain()[0].response_body(), json!({}));
        assert_eq!(block(fut).unwrap(), token);

        // Credentials for an unknown request are acknowledged and ignored.
        client
            .handle_message(
                HostRequest::OpenIdCredentials { request: OpenIdCredentialsRequest::blocked("nope") }.into_wire("h2"),
            )
            .unwrap();
        assert_eq!(rec.drain()[0].response_body(), json!({}));
    }

    #[test]
    fn incoming_event_is_acked_and_delivered() {
        let (client, rec) = setup();
        let event = MatrixEvent {
            event_type: "m.room.message".into(),
            sender: "@a:b".into(),
            event_id: "$1".into(),
            room_id: "!r".into(),
            origin_server_ts: 1,
            state_key: None,
            content: json!({"body": "hello"}).into(),
            unsigned: None,
        };
        client.handle_message(HostRequest::SendEvent { event: event.clone() }.into_wire("h")).unwrap();
        assert_eq!(rec.drain()[0].response_body(), json!({}));
        assert_eq!(rec.events.borrow().as_slice(), &[event]);

        let unknown = WireMessage::request(Source::Host, "org.example.x", "u", json!({}));
        client.handle_message(unknown).unwrap();
        assert!(rec.drain()[0].error().unwrap().message.contains("Unknown action"));
    }

    #[test]
    fn protocol_errors() {
        let (client, rec) = setup();
        let stray = WireMessage::request(Source::Widget, "content_loaded", "zzz", json!({})).ack();
        assert_eq!(client.handle_message(stray), Err(WidgetClientError::UnknownRequestId { request_id: "zzz".into() }));

        let widget_req = WidgetRequest::ContentLoaded.into_wire("w");
        assert!(matches!(client.handle_message(widget_req), Err(WidgetClientError::WrongDirection { .. })));

        let mut legacy = WidgetRequest::ContentLoaded.into_wire("w").ack();
        legacy.version = None;
        assert!(matches!(client.handle_message(legacy), Err(WidgetClientError::UnsupportedVersion { .. })));
        assert!(rec.drain().is_empty());

        // Dropping the client cancels outstanding futures.
        let fut = client.content_loaded();
        drop(client);
        assert_eq!(block(fut), Err(WidgetClientError::Cancelled));
    }
}
