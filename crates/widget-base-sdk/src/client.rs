use std::cell::RefCell;
use std::collections::{HashMap, HashSet};
use std::future::Future;
use std::rc::{Rc, Weak};

use futures_channel::oneshot;
use serde::{Deserialize, Serialize};
use serde_json::Value;
// TODO consider splitting those into widget_actions::widget and widget_actions::host so that they are more explicit here.
use widget_actions::{
    ActionError, Base64File, Capability, DelegateRtcLivekitDelayedLeaveRequest, DownloadFileRequest, ErrorKind,
    GetClientContextResponse, GetMatrixContextResponse, GetRtcLivekitTokenRequest, HostRequest, JsonValue, MatrixEvent,
    MediaConfigResponse, MessageKind, NavigateRequest, OpenIdToken, ReadEventsRequest, ReadRelationsRequest,
    ReadRelationsResponse, ReadRoomAccountDataRequest, RequestCapabilitiesRequest, RoomAccountData,
    SearchUserDirectoryRequest, SearchUserDirectoryResponse, SendEventRequest, SendEventResponse, SendToDeviceRequest,
    SetAlwaysOnScreenRequest, StateKeySelector, ToDeviceEvent, TurnServer, UpdateDelayedEventAction,
    UpdateDelayedEventRequest, UploadFileRequest, UploadFileResponse, WidgetError, WidgetRequest, WidgetResponse,
    WireMessage,
};

use crate::WidgetClientError;

/// `pick!(Variant { response } => expr)` builds the closure that takes the expected variant out
/// of a [`WidgetResponse`] (see [`WidgetClient::call`]). `pick!(Variant => ())` is for the unit
/// variants of `{}` replies.
macro_rules! pick {
    ($variant:ident $({ $field:ident })? => $out:expr) => {
        |response| match response {
            WidgetResponse::$variant $({ $field })? => Some($out),
            _ => None,
        }
    };
}

/// Callbacks from the [`WidgetClient`] into the widget application / transport.
///
/// Only [`send_to_host`](WidgetDelegate::send_to_host) is mandatory. The others have empty
/// default implementations.
pub trait WidgetDelegate {
    /// Deliver a JSON encoded message to the host, e.g. `window.parent.postMessage(...)`.
    fn send_to_host(&self, json: String);

    /// A request was sent to the host. MSC4412 gives the host 10 seconds
    /// ([`ACTION_TIMEOUT_MS`](widget_actions::ACTION_TIMEOUT_MS)) to answer: start a timer and
    /// call [`WidgetClient::timeout_request`] with `request_id` when it fires. The client has no
    /// clock of its own; without this the request waits for as long as the host takes.
    fn on_request_sent(&self, _request_id: &str) {}

    /// A room event the host forwarded to this widget (`forward_event`).
    fn on_matrix_event(&self, _event: MatrixEvent) {}

    /// The host pushed (part of) the current room state (`update_state`).
    fn on_state_update(&self, _state: Vec<MatrixEvent>) {}

    /// A to-device message the host forwarded to this widget (`forward_to_device`).
    fn on_to_device_message(&self, _message: ToDeviceEvent) {}

    /// New TURN credentials while watching them (`update_turn_servers`).
    fn on_turn_server(&self, _server: TurnServer) {}

    /// The client's theme changed (`update_theme`); the object's shape is up to the client.
    fn on_theme_change(&self, _theme: Value) {}

    /// The client's UI language changed (`update_language`); a BCP 47 tag.
    fn on_language_change(&self, _lang: String) {}

    /// The client started or stopped showing the widget (`update_visibility`).
    fn on_visibility_change(&self, _visible: bool) {}

    /// The host sent `update_capabilities`. `allowed` is the complete set the widget holds now:
    /// it may have grown (a request was granted) or shrunk (the host took capabilities away).
    fn on_capabilities_changed(&self, _allowed: Vec<Capability>) {}
}

/// Snapshot of what the client knows about its session with the host.
#[derive(Debug, Clone, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WidgetState {
    /// `notify_ready` was sent and acknowledged.
    pub ready: bool,
    /// Capabilities requested since the host's last `update_capabilities`.
    pub pending_requested: Vec<Capability>,
    /// The capabilities the widget holds: `allowed` of the host's last `update_capabilities`.
    pub approved: Vec<Capability>,
}

#[derive(Default)]
struct Inner {
    state: WidgetState,
    /// Requests waiting for their response, with the action for error messages.
    pending: HashMap<String, (String, Waiter)>,
    /// Requests that timed out; their late responses are ignored.
    timed_out: HashSet<String>,
    /// The [`WidgetClient::request_openid_token`] in progress.
    openid: OpenIdFlow,
}

/// Who waits for the response to a request of the client.
enum Waiter {
    /// The future returned for the request.
    Caller(oneshot::Sender<Result<WireMessage, WidgetClientError>>),
    /// A step of [`WidgetClient::request_openid_token`]: the client goes on with it itself.
    OpenId,
}

/// One OpenID token in progress, for every [`WidgetClient::request_openid_token`] call that
/// arrives until it is there. It needs no future to drive it: the host's messages do.
#[derive(Default)]
struct OpenIdFlow {
    /// The callers; all get the same result.
    waiters: Vec<oneshot::Sender<Result<OpenIdToken, WidgetClientError>>>,
    /// The host acknowledged the request for `widget:…get_openid`: its next `update_capabilities`
    /// is the answer. (Updates before the ack answer earlier requests.)
    awaiting_update: bool,
    /// `widget:…get_openid` was requested in this flow. It is requested at most once per token.
    requested: bool,
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
        let (msg, fut) = self.send_request(request);
        (msg.request_id, fut)
    }

    /// Send `request` to the host; `waiter` gets the response. Returns the sent envelope.
    fn send_with(&self, request: WidgetRequest, waiter: Waiter) -> WireMessage {
        let id = (self.next_id)();
        let msg = request.into_wire(id.clone());
        self.inner.borrow_mut().pending.insert(id.clone(), (msg.action.clone(), waiter));
        log_sent(&msg);
        self.delegate.send_to_host(msg.to_json());
        self.delegate.on_request_sent(&id);
        msg
    }

    /// Send `request` and take the expected response variant out of the reply with `pick`.
    /// Any other variant is a [`WidgetClientError::UnexpectedResponse`].
    fn call<T>(
        &self,
        request: WidgetRequest,
        pick: impl FnOnce(WidgetResponse) -> Option<T> + 'static,
    ) -> impl Future<Output = Result<T, WidgetClientError>> + 'static {
        let (msg, fut) = self.send_request(request);
        let action = msg.action;
        async move { pick(fut.await?).ok_or(WidgetClientError::UnexpectedResponse { action }) }
    }

    /// Send `request` to the host. Returns the sent envelope and a future for the reply.
    fn send_request(
        &self,
        request: WidgetRequest,
    ) -> (WireMessage, impl Future<Output = Result<WidgetResponse, WidgetClientError>> + 'static) {
        let (tx, rx) = oneshot::channel();
        let msg = self.send_with(request, Waiter::Caller(tx));
        let fut = async move {
            let msg = rx.await.map_err(|_| WidgetClientError::Cancelled)??;
            match WidgetResponse::from_wire(&msg) {
                Ok(response) => Ok(response),
                Err(ActionError::ErrorResponse { error }) => Err(WidgetClientError::Host(error)),
                Err(other) => Err(other.into()),
            }
        };
        (msg, fut)
    }

    /// Fail the request `request_id` with [`WidgetClientError::Timeout`] if it is still
    /// unanswered. A response that arrives later is ignored. Returns whether the request was
    /// waiting. See [`WidgetDelegate::on_request_sent`].
    pub fn timeout_request(&self, request_id: &str) -> bool {
        let mut inner = self.inner.borrow_mut();
        let Some((action, waiter)) = inner.pending.remove(request_id) else {
            return false;
        };
        inner.timed_out.insert(request_id.to_owned());
        drop(inner);
        log::warn!("{action} ({request_id}) timed out: the host did not answer");
        match waiter {
            Waiter::Caller(tx) => {
                let _ = tx.send(Err(WidgetClientError::Timeout { action }));
            }
            Waiter::OpenId => self.finish_openid(Err(WidgetClientError::Timeout { action })),
        }
        true
    }

    /// Ask the host for an OpenID token (MSC1960) that proves the user's identity to a third
    /// party.
    ///
    /// Needs `widget:…get_openid`. A host usually grants it for one token only, after asking the
    /// user, and then takes it away again (`update_capabilities`). So this does everything: if the
    /// widget does not hold the capability, it requests it and waits for the host's next
    /// `update_capabilities`; granted, it asks for the token, refused, it fails with
    /// [`WidgetClientError::OpenIdBlocked`]. Calls while one is in progress share its result: one
    /// question to the user, one token.
    ///
    /// The next `update_capabilities` after the host acknowledged the request is taken as the
    /// answer. If the host takes capabilities away in between, that reads as refused.
    pub fn request_openid_token(&self) -> impl Future<Output = Result<OpenIdToken, WidgetClientError>> + 'static {
        let (tx, rx) = oneshot::channel();
        let first = {
            let mut inner = self.inner.borrow_mut();
            inner.openid.waiters.push(tx);
            inner.openid.waiters.len() == 1
        };
        if first {
            if self.has_capability(&Capability::GetOpenId) {
                self.send_with(WidgetRequest::GetOpenId, Waiter::OpenId);
            } else {
                self.request_openid_capability();
            }
        }
        async move { rx.await.map_err(|_| WidgetClientError::Cancelled)? }
    }

    /// The OpenID flow requests `widget:…get_openid`; the answer is the next `update_capabilities`
    /// after the ack.
    fn request_openid_capability(&self) {
        let capability = Capability::GetOpenId;
        {
            let mut inner = self.inner.borrow_mut();
            inner.openid.requested = true;
            if !inner.state.pending_requested.contains(&capability) {
                inner.state.pending_requested.push(capability.clone());
            }
        }
        log::info!("requesting {capability} for an OpenID token");
        let request = RequestCapabilitiesRequest { capabilities: vec![capability] };
        self.send_with(WidgetRequest::RequestCapabilities { request }, Waiter::OpenId);
    }

    /// The host answered a request of the OpenID flow.
    fn continue_openid(&self, msg: WireMessage) {
        match WidgetResponse::from_wire(&msg) {
            Ok(WidgetResponse::GetOpenId { response }) => self.finish_openid(Ok(response)),
            // The capability request was acknowledged; the answer follows as `update_capabilities`.
            Ok(WidgetResponse::RequestCapabilities) => self.inner.borrow_mut().openid.awaiting_update = true,
            Ok(_) => self.finish_openid(Err(WidgetClientError::UnexpectedResponse { action: msg.action })),
            // The grant ended before the request arrived (a use or a revoke whose update was still on
            // its way): request the capability, once per token.
            Err(ActionError::ErrorResponse { error })
                if error.kind() == ErrorKind::MissingCapability && !self.inner.borrow().openid.requested =>
            {
                self.request_openid_capability()
            }
            Err(ActionError::ErrorResponse { error }) => self.finish_openid(Err(WidgetClientError::Host(error))),
            Err(other) => self.finish_openid(Err(other.into())),
        }
    }

    /// The host's `update_capabilities` that answers the OpenID flow's capability request.
    fn openid_capability_answered(&self) {
        if self.has_capability(&Capability::GetOpenId) {
            self.send_with(WidgetRequest::GetOpenId, Waiter::OpenId);
        } else {
            self.finish_openid(Err(WidgetClientError::OpenIdBlocked));
        }
    }

    /// End the OpenID flow: every caller gets `result`.
    fn finish_openid(&self, result: Result<OpenIdToken, WidgetClientError>) {
        let waiters = std::mem::take(&mut self.inner.borrow_mut().openid).waiters;
        match &result {
            Ok(_) => log::info!("got an OpenID token for {} call(s)", waiters.len()),
            Err(error) => log::warn!("no OpenID token for {} call(s): {error}", waiters.len()),
        }
        for tx in waiters {
            let _ = tx.send(result.clone());
        }
    }

    /// Tell the host the widget is ready to be shown (`notify_ready`). Required when the widget
    /// state event has `uses_widget_api: true`; the host shows a loading state until this arrives
    /// and an error if it does not (after about 15 seconds). Do the initial loading before
    /// (capabilities, theme, first events), anything longer behind an own loading indicator.
    pub fn notify_ready(&self) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        // Only a weak handle: dropping the client must cancel the future, not keep state alive.
        let inner: Weak<RefCell<Inner>> = Rc::downgrade(&self.inner);
        let fut = self.call(WidgetRequest::NotifyReady, pick!(NotifyReady => ()));
        async move {
            fut.await?;
            if let Some(inner) = inner.upgrade() {
                inner.borrow_mut().state.ready = true;
            }
            Ok(())
        }
    }

    /// Ask the host about the embedding client (id, theme, language). Needs `widget:…get_client_context`.
    pub fn get_client_context(
        &self,
    ) -> impl Future<Output = Result<GetClientContextResponse, WidgetClientError>> + 'static {
        self.call(WidgetRequest::GetClientContext, pick!(GetClientContext { response } => response))
    }

    /// Ask the host who and where this widget is on Matrix (user, device, room, display name,
    /// avatar, homeserver). Needs `widget:…get_matrix_context`.
    pub fn get_matrix_context(
        &self,
    ) -> impl Future<Output = Result<GetMatrixContextResponse, WidgetClientError>> + 'static {
        self.call(WidgetRequest::GetMatrixContext, pick!(GetMatrixContext { response } => response))
    }

    /// Ask the host for initial or additional capabilities, at any time. Resolves when the host
    /// *acknowledged* the request, which grants nothing; what the widget holds arrives later
    /// through [`WidgetDelegate::on_capabilities_changed`] and is visible in
    /// [`state`](Self::state). A widget cannot give capabilities back.
    pub fn request_capabilities(
        &self,
        capabilities: Vec<Capability>,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        {
            let mut inner = self.inner.borrow_mut();
            for capability in &capabilities {
                if !inner.state.pending_requested.contains(capability) {
                    inner.state.pending_requested.push(capability.clone());
                }
            }
        }
        let request = WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities } };
        self.call(request, pick!(RequestCapabilities => ()))
    }

    /// Send a timeline event. Needs an approved `widget:…send_event.timeline:<type>` capability.
    pub fn send_event(
        &self,
        event_type: impl Into<String>,
        content: Value,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        self.send_event_request(SendEventRequest::room_event(event_type, content.into()))
    }

    /// Send a state event. Needs an approved `widget:…send_event.state:<type>[#<state_key>]` capability.
    pub fn send_state_event(
        &self,
        event_type: impl Into<String>,
        state_key: impl Into<String>,
        content: Value,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        self.send_event_request(SendEventRequest::state_event(event_type, state_key, content.into()))
    }

    /// Send a sticky event (MSC4407) that the homeserver keeps for `duration_ms`. Needs the
    /// matching `widget:…send_event.timeline` capability and `widget:…send_event.sticky`.
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
    /// Needs the matching `widget:…send_event.*` capability and `widget:…send_event.delayed`.
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
        // A delayed send is answered with a `delay_id` instead of an `event_id`.
        async move {
            fut.await?
                .delay_id
                .ok_or(WidgetClientError::UnexpectedResponse { action: "org.matrix.mscXXXX.send_event".into() })
        }
    }

    /// Cancel, restart or fire a delayed event. Needs `widget:…update_delayed_event`.
    pub fn update_delayed_event(
        &self,
        delay_id: impl Into<String>,
        action: UpdateDelayedEventAction,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.call(
            WidgetRequest::UpdateDelayedEvent {
                request: UpdateDelayedEventRequest { delay_id: delay_id.into(), action },
            },
            pick!(UpdateDelayedEvent => ()),
        )
    }

    /// Send any `send_event` request as is (every MSC2762 / MSC4157 / MSC4407 field).
    pub fn send_event_request(
        &self,
        request: SendEventRequest,
    ) -> impl Future<Output = Result<SendEventResponse, WidgetClientError>> + 'static {
        self.call(WidgetRequest::SendEvent { request }, pick!(SendEvent { response } => response))
    }

    /// Read recent timeline events of a type. Needs `widget:…read_events.timeline:<type>`.
    pub fn read_events(
        &self,
        event_type: impl Into<String>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        self.read_events_request(ReadEventsRequest::timeline(event_type, limit))
    }

    /// Read current state events of a type. Needs `widget:…read_events.state:<type>[#<state_key>]`.
    pub fn read_state(
        &self,
        event_type: impl Into<String>,
        state_key: StateKeySelector,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        self.read_events_request(ReadEventsRequest::state(event_type, state_key))
    }

    /// Send a to-device message (MSC3819): `messages` is `user_id -> device_id -> content`
    /// (`*` as device id means every device of the user). Needs
    /// `widget:…send_to_device:<type>`.
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
        self.call(
            WidgetRequest::SendToDevice {
                request: SendToDeviceRequest { event_type: event_type.into(), encrypted, messages },
            },
            pick!(SendToDevice => ()),
        )
    }

    /// Ask the client to open a `https://matrix.to/#/` permalink (MSC2931). Needs
    /// `widget:…navigate`.
    pub fn navigate(&self, uri: impl Into<String>) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.call(WidgetRequest::Navigate { request: NavigateRequest { uri: uri.into() } }, pick!(Navigate => ()))
    }

    /// Ask the client to keep the widget on screen (or stop). Resolves with whether it will.
    /// Needs `widget:…set_always_on_screen`.
    pub fn set_always_on_screen(&self, value: bool) -> impl Future<Output = Result<bool, WidgetClientError>> + 'static {
        self.call(
            WidgetRequest::SetAlwaysOnScreen { request: SetAlwaysOnScreenRequest { value } },
            pick!(SetAlwaysOnScreen { response } => response.success),
        )
    }

    /// Start receiving TURN credentials through [`WidgetDelegate::on_turn_server`] (MSC3846).
    /// Needs `host:…update_turn_servers`.
    pub fn watch_turn_servers(&self) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.call(WidgetRequest::WatchTurnServers, pick!(WatchTurnServers => ()))
    }

    /// Stop receiving TURN credentials.
    pub fn unwatch_turn_servers(&self) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.call(WidgetRequest::UnwatchTurnServers, pick!(UnwatchTurnServers => ()))
    }

    /// The homeserver's MatrixRTC transports (MSC4515), each `{ "type": ..., ... }`. Needs
    /// `widget:…get_rtc_transports`.
    pub fn get_rtc_transports(&self) -> impl Future<Output = Result<Vec<Value>, WidgetClientError>> + 'static {
        self.call(WidgetRequest::GetRtcTransports, pick!(GetRtcTransports { response } => response.rtc_transports.into_iter().map(JsonValue::into_inner).collect()))
    }

    /// Search the user directory (MSC3973). Needs `widget:…search_user_directory`.
    pub fn search_user_directory(
        &self,
        search_term: impl Into<String>,
        limit: Option<u32>,
    ) -> impl Future<Output = Result<SearchUserDirectoryResponse, WidgetClientError>> + 'static {
        self.call(
            WidgetRequest::SearchUserDirectory {
                request: SearchUserDirectoryRequest { search_term: search_term.into(), limit },
            },
            pick!(SearchUserDirectory { response } => response),
        )
    }

    /// The homeserver's media config (MSC4039). Needs `widget:…get_media_config`.
    pub fn get_media_config(&self) -> impl Future<Output = Result<MediaConfigResponse, WidgetClientError>> + 'static {
        self.call(WidgetRequest::GetMediaConfig, pick!(GetMediaConfig { response } => response))
    }

    /// Upload a file to the media repository and get its `mxc://` URI. Needs
    /// `widget:…upload_file`.
    pub fn upload_file(
        &self,
        file: Base64File,
    ) -> impl Future<Output = Result<UploadFileResponse, WidgetClientError>> + 'static {
        self.call(
            WidgetRequest::UploadFile { request: UploadFileRequest { file } },
            pick!(UploadFile { response } => response),
        )
    }

    /// Download an `mxc://` URI. Needs `widget:…download_file`.
    pub fn download_file(
        &self,
        content_uri: impl Into<String>,
    ) -> impl Future<Output = Result<Base64File, WidgetClientError>> + 'static {
        self.call(
            WidgetRequest::DownloadFile { request: DownloadFileRequest { content_uri: content_uri.into() } },
            pick!(DownloadFile { response } => response.file),
        )
    }

    /// Read room account data of `event_type`. Needs
    /// `widget:…read_room_account_data:<type>`.
    pub fn read_room_account_data(
        &self,
        event_type: impl Into<String>,
    ) -> impl Future<Output = Result<Vec<RoomAccountData>, WidgetClientError>> + 'static {
        self.call(
            WidgetRequest::ReadRoomAccountData {
                request: ReadRoomAccountDataRequest { event_type: event_type.into(), room_ids: None },
            },
            pick!(ReadRoomAccountData { response } => response.events),
        )
    }

    /// A LiveKit JWT from the client (MSC4533). Needs `widget:…get_rtc_livekit_token`.
    pub fn get_rtc_livekit_token(
        &self,
        request: GetRtcLivekitTokenRequest,
    ) -> impl Future<Output = Result<String, WidgetClientError>> + 'static {
        self.call(WidgetRequest::GetRtcLivekitToken { request }, pick!(GetRtcLivekitToken { response } => response.jwt))
    }

    /// Hand a delayed leave to the client's LiveKit service (MSC4533). Needs
    /// `widget:…delegate_rtc_livekit_delayed_leave`.
    pub fn delegate_rtc_livekit_delayed_leave(
        &self,
        request: DelegateRtcLivekitDelayedLeaveRequest,
    ) -> impl Future<Output = Result<(), WidgetClientError>> + 'static {
        self.call(
            WidgetRequest::DelegateRtcLivekitDelayedLeave { request },
            pick!(DelegateRtcLivekitDelayedLeave => ()),
        )
    }

    /// Read the events relating to `request.event_id` (MSC3869). The host filters the page by
    /// the `widget:…read_relations:<type>` capabilities.
    pub fn read_relations(
        &self,
        request: ReadRelationsRequest,
    ) -> impl Future<Output = Result<ReadRelationsResponse, WidgetClientError>> + 'static {
        self.call(WidgetRequest::ReadRelations { request }, pick!(ReadRelations { response } => response))
    }

    /// Send any `read_events` request as is (`msgtype`, `room_ids`, `since`, ...).
    pub fn read_events_request(
        &self,
        request: ReadEventsRequest,
    ) -> impl Future<Output = Result<Vec<MatrixEvent>, WidgetClientError>> + 'static {
        self.call(WidgetRequest::ReadEvents { request }, pick!(ReadEvents { response } => response.events))
    }

    // ---- incoming ---------------------------------------------------------------------------

    /// Feed a JSON message received from the host. Acknowledgements are sent through the
    /// delegate and pending request futures are resolved before this returns.
    pub fn handle_message_from_host(&self, json: &str) -> Result<(), WidgetClientError> {
        let msg = WireMessage::from_json(json)
            .inspect_err(|e| log::debug!("ignored a message that is not a widget api message: {e}"))?;
        self.handle_message(msg)
    }

    /// Like [`handle_message_from_host`](Self::handle_message_from_host) for an already parsed envelope.
    pub fn handle_message(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        // Responses are parsed by the future awaiting them (see `request`), so a malformed body
        // is reported to the caller instead of failing here.
        log::debug!("from host: {} {:?} ({})", msg.action, msg.kind(), msg.request_id);
        log::trace!("from host: {}", msg.to_log_json());
        let result = match msg.kind() {
            MessageKind::WidgetResponse => self.resolve_response(msg),
            MessageKind::HostRequest => self.handle_host_request(msg),
            kind => Err(WidgetClientError::WrongDirection { message: format!("widget received a {kind:?} message") }),
        };
        if let Err(error) = &result {
            log::warn!("rejected a message from the host: {error}");
        }
        result
    }

    fn resolve_response(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        let sender = {
            let mut inner = self.inner.borrow_mut();
            // A response to a request that timed out is ignored.
            if inner.timed_out.remove(&msg.request_id) {
                log::debug!("ignored the late response to {} ({}), it timed out", msg.action, msg.request_id);
                return Ok(());
            }
            inner.pending.remove(&msg.request_id)
        };
        match sender {
            Some((_, Waiter::Caller(tx))) => {
                // The receiver may have been dropped; that is not an error.
                let _ = tx.send(Ok(msg));
                Ok(())
            }
            Some((_, Waiter::OpenId)) => {
                self.continue_openid(msg);
                Ok(())
            }
            None => Err(WidgetClientError::UnknownRequestId { request_id: msg.request_id }),
        }
    }

    fn handle_host_request(&self, msg: WireMessage) -> Result<(), WidgetClientError> {
        let request = match HostRequest::from_wire(&msg) {
            Ok(r) => r,
            Err(ActionError::InvalidBody { message, .. }) => {
                log::warn!("{} ({}) has an invalid request body: {message}", msg.action, msg.request_id);
                let error = WidgetError::invalid_request(format!("Invalid request body: {message}"));
                self.send(msg.error_response_to(error));
                return Ok(());
            }
            Err(e) => return Err(e.into()),
        };
        match request {
            HostRequest::UpdateCapabilities { request } => {
                let answers_openid = {
                    // `allowed` is the full list: it replaces what the widget held, so the host
                    // can also take capabilities away.
                    let mut inner = self.inner.borrow_mut();
                    inner.state.pending_requested.clear();
                    inner.state.approved = request.allowed.clone();
                    std::mem::take(&mut inner.openid.awaiting_update)
                };
                log::info!("the host updated the capabilities, the widget holds {}", request.allowed.len());
                self.send(msg.ack());
                self.delegate.on_capabilities_changed(request.allowed);
                if answers_openid {
                    self.openid_capability_answered();
                }
            }
            HostRequest::ForwardEvent { event } => {
                self.send(msg.ack());
                self.delegate.on_matrix_event(event);
            }
            HostRequest::UpdateState { request } => {
                self.send(msg.ack());
                self.delegate.on_state_update(request.state);
            }
            HostRequest::ForwardToDevice { message } => {
                self.send(msg.ack());
                self.delegate.on_to_device_message(message);
            }
            HostRequest::UpdateTurnServers { server } => {
                self.send(msg.ack());
                self.delegate.on_turn_server(server);
            }
            HostRequest::UpdateTheme { theme } => {
                self.send(msg.ack());
                self.delegate.on_theme_change(theme.into_inner());
            }
            HostRequest::UpdateLanguage { request } => {
                self.send(msg.ack());
                self.delegate.on_language_change(request.lang);
            }
            HostRequest::UpdateVisibility { request } => {
                self.send(msg.ack());
                self.delegate.on_visibility_change(request.visible);
            }
            HostRequest::Unknown => {
                log::warn!("the host sent the unknown action {} ({})", msg.action, msg.request_id);
                self.send(msg.error_response_to(WidgetError::unknown_action(&msg.action)));
            }
        }
        Ok(())
    }

    fn send(&self, msg: WireMessage) {
        log_sent(&msg);
        self.delegate.send_to_host(msg.to_json());
    }
}

fn log_sent(msg: &WireMessage) {
    log::debug!("to host: {} {:?} ({})", msg.action, msg.kind(), msg.request_id);
    log::trace!("to host: {}", msg.to_log_json());
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use serde_json::json;
    use widget_actions::{ErrorKind, Source, UpdateCapabilitiesRequest};

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
        fn on_capabilities_changed(&self, _allowed: Vec<Capability>) {
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
    fn notify_ready_roundtrip() {
        let (client, rec) = setup();
        let fut = client.notify_ready();
        let sent = rec.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, "org.matrix.msc4412.notify_ready");
        assert_eq!(sent[0].request_id, "req-1");
        assert_eq!(sent[0].source, Source::Widget);
        assert!(!client.state().ready);

        client.handle_message_from_host(&sent[0].ack().to_json()).unwrap();
        block(fut).unwrap();
        assert!(client.state().ready);
    }

    #[test]
    fn unanswered_requests_time_out() {
        let (client, rec) = setup();
        let fut = client.notify_ready();
        let sent = rec.drain();
        assert!(!client.timeout_request("someone-else"));
        assert!(client.timeout_request("req-1"));
        assert_eq!(block(fut), Err(WidgetClientError::Timeout { action: "org.matrix.msc4412.notify_ready".into() }));
        assert!(!client.state().ready);
        // The late response is ignored, once; the request cannot time out twice.
        assert!(!client.timeout_request("req-1"));
        assert_eq!(client.handle_message(sent[0].ack()), Ok(()));
        assert!(matches!(client.handle_message(sent[0].ack()), Err(WidgetClientError::UnknownRequestId { .. })));

        // An answered request does not time out.
        let fut = client.notify_ready();
        client.handle_message(rec.drain()[0].ack()).unwrap();
        assert!(!client.timeout_request("req-2"));
        block(fut).unwrap();
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
        let caps = vec![Capability::send_event("a"), Capability::read_events("b")];
        let fut = client.request_capabilities(caps.clone());
        assert_eq!(client.state().pending_requested, caps);
        let sent = rec.drain();
        client.handle_message(sent[0].ack()).unwrap();
        block(fut).unwrap();

        let notify = HostRequest::UpdateCapabilities {
            request: UpdateCapabilitiesRequest { allowed: vec![Capability::send_event("a")] },
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
        assert!(!client.has_capability(&Capability::read_events("b")));
        assert!(client.state().pending_requested.is_empty());

        // `allowed` is the full list: it replaces what the widget held ...
        let update = |allowed: Vec<Capability>, id: &str| {
            HostRequest::UpdateCapabilities { request: UpdateCapabilitiesRequest { allowed } }.into_wire(id)
        };
        client
            .handle_message(update(vec![Capability::send_event("a"), Capability::read_events("b")], "host-2"))
            .unwrap();
        assert_eq!(client.state().approved.len(), 2);
        // ... so the host can take capabilities away again.
        client.handle_message(update(vec![Capability::read_events("b")], "host-3")).unwrap();
        assert_eq!(client.state().approved, vec![Capability::read_events("b")]);
        assert!(!client.has_capability(&Capability::send_event("a")));
        assert_eq!(rec.caps_changed.get(), 3);

        // Requests add up until the host answers.
        let _a = client.request_capabilities(vec![Capability::Navigate]);
        let _b = client.request_capabilities(vec![Capability::Navigate, Capability::UploadFile]);
        assert_eq!(client.state().pending_requested, vec![Capability::Navigate, Capability::UploadFile]);
    }

    fn token() -> OpenIdToken {
        OpenIdToken {
            access_token: "t".into(),
            token_type: "Bearer".into(),
            matrix_server_name: "x".into(),
            expires_in: 1,
        }
    }

    /// The host's reply with [`token`].
    fn token_reply(request: &WireMessage) -> WireMessage {
        request.response_to(
            json!({"access_token": "t", "token_type": "Bearer", "matrix_server_name": "x", "expires_in": 1}),
        )
    }

    fn update(allowed: Vec<Capability>, id: &str) -> WireMessage {
        HostRequest::UpdateCapabilities { request: UpdateCapabilitiesRequest { allowed } }.into_wire(id)
    }

    const GET_OPENID: &str = "org.matrix.mscXXXX.get_openid";
    const REQUEST_CAPABILITIES: &str = "org.matrix.msc4412.request_capabilities";

    #[test]
    fn openid_while_the_capability_is_held() {
        let (client, rec) = setup();
        client.handle_message(update(vec![Capability::GetOpenId], "h1")).unwrap();
        rec.drain();
        let fut = client.request_openid_token();
        let sent = rec.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, GET_OPENID);
        client.handle_message(token_reply(&sent[0])).unwrap();
        assert_eq!(block(fut).unwrap(), token());
    }

    #[test]
    fn openid_requests_the_capability_when_needed() {
        let (client, rec) = setup();
        let mut calls = vec![client.request_openid_token(), client.request_openid_token()];
        // One request for both calls.
        let sent = rec.drain();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].action, REQUEST_CAPABILITIES);
        assert_eq!(sent[0].request_body(), json!({"capabilities": ["widget:org.matrix.mscXXXX.get_openid"]}));
        assert_eq!(client.state().pending_requested, vec![Capability::GetOpenId]);

        // An update before the ack answers an earlier request, not this one.
        client.handle_message(update(vec![], "h0")).unwrap();
        assert_eq!(rec.drain().len(), 1);
        client.handle_message(sent[0].ack()).unwrap();
        client.handle_message(update(vec![Capability::GetOpenId], "h1")).unwrap();
        let sent = rec.drain();
        assert_eq!(
            sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(),
            ["org.matrix.msc4412.update_capabilities", GET_OPENID]
        );
        // A call while the token is on its way gets it too.
        calls.push(client.request_openid_token());
        assert!(rec.drain().is_empty());
        client.handle_message(token_reply(&sent[1])).unwrap();
        for call in calls {
            assert_eq!(block(call).unwrap(), token());
        }

        // The host ended the grant: the next call asks again, and a refusal is `OpenIdBlocked`.
        client.handle_message(update(vec![], "h2")).unwrap();
        rec.drain();
        let fut = client.request_openid_token();
        let sent = rec.drain();
        assert_eq!(sent[0].action, REQUEST_CAPABILITIES);
        client.handle_message(sent[0].ack()).unwrap();
        client.handle_message(update(vec![Capability::Navigate], "h3")).unwrap();
        assert_eq!(rec.drain().len(), 1);
        assert_eq!(block(fut), Err(WidgetClientError::OpenIdBlocked));
        assert!(client.has_capability(&Capability::Navigate));
    }

    #[test]
    fn openid_with_a_grant_that_ended_meanwhile_asks_once() {
        let (client, rec) = setup();
        let missing =
            |request: &WireMessage| request.error_response_to(WidgetError::missing_capability(&Capability::GetOpenId));
        // The widget has not heard yet that its grant ended: the host refuses, the client asks.
        client.handle_message(update(vec![Capability::GetOpenId], "h1")).unwrap();
        rec.drain();
        let fut = client.request_openid_token();
        let sent = rec.drain();
        assert_eq!(sent[0].action, GET_OPENID);
        client.handle_message(missing(&sent[0])).unwrap();
        let sent = rec.drain();
        assert_eq!(sent[0].action, REQUEST_CAPABILITIES);
        client.handle_message(sent[0].ack()).unwrap();
        client.handle_message(update(vec![Capability::GetOpenId], "h2")).unwrap();
        // Refused again after the grant: no loop, the host's error is the result.
        let sent = rec.drain();
        assert_eq!(sent[1].action, GET_OPENID);
        client.handle_message(missing(&sent[1])).unwrap();
        assert!(rec.drain().is_empty());
        assert!(matches!(block(fut), Err(WidgetClientError::Host(e)) if e.kind() == ErrorKind::MissingCapability));
    }

    #[test]
    fn openid_failures_reach_every_caller() {
        let (client, rec) = setup();
        // The host does not answer the capability request in time.
        let (a, b) = (client.request_openid_token(), client.request_openid_token());
        let id = rec.drain()[0].request_id.clone();
        assert!(client.timeout_request(&id));
        for call in [a, b] {
            assert_eq!(block(call), Err(WidgetClientError::Timeout { action: REQUEST_CAPABILITIES.into() }));
        }
        // The backend fails.
        client.handle_message(update(vec![Capability::GetOpenId], "h1")).unwrap();
        rec.drain();
        let fut = client.request_openid_token();
        let sent = rec.drain();
        client.handle_message(sent[0].error_response_to(WidgetError::new("no token"))).unwrap();
        assert_eq!(block(fut), Err(WidgetClientError::Host(WidgetError::new("no token"))));
        // The legacy shape is no token.
        let fut = client.request_openid_token();
        let sent = rec.drain();
        client.handle_message(sent[0].response_to(json!({"state": "request"}))).unwrap();
        assert!(matches!(block(fut), Err(WidgetClientError::Protocol(ActionError::InvalidBody { .. }))));
        // Dropping the client cancels.
        let fut = client.request_openid_token();
        drop(client);
        assert_eq!(block(fut), Err(WidgetClientError::Cancelled));
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
        client.handle_message(HostRequest::ForwardEvent { event: event.clone() }.into_wire("h")).unwrap();
        assert_eq!(rec.drain()[0].response_body(), json!({}));
        assert_eq!(rec.events.borrow().as_slice(), &[event]);

        let unknown = WireMessage::request(Source::Host, "org.example.x", "u", json!({}));
        client.handle_message(unknown).unwrap();
        let error = rec.drain()[0].error().unwrap();
        assert!(error.message.contains("Unknown action"));
        assert_eq!(error.kind(), ErrorKind::UnknownAction);
    }

    #[test]
    fn protocol_errors() {
        let (client, rec) = setup();
        let stray = WireMessage::request(Source::Widget, "m.notify_ready", "zzz", json!({})).ack();
        assert_eq!(client.handle_message(stray), Err(WidgetClientError::UnknownRequestId { request_id: "zzz".into() }));

        let widget_req = WidgetRequest::NotifyReady.into_wire("w");
        assert!(matches!(client.handle_message(widget_req), Err(WidgetClientError::WrongDirection { .. })));

        // A legacy message (`api` instead of `source`) is not a widget API message.
        let legacy =
            json!({"api": "toWidget", "widgetId": "w", "requestId": "1", "action": "capabilities", "data": {}});
        assert!(matches!(
            client.handle_message_from_host(&legacy.to_string()),
            Err(WidgetClientError::Protocol(ActionError::Malformed { .. }))
        ));
        assert!(rec.drain().is_empty());

        // Dropping the client cancels outstanding futures.
        let fut = client.notify_ready();
        drop(client);
        assert_eq!(block(fut), Err(WidgetClientError::Cancelled));
    }
}
