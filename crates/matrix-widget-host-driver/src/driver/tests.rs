//! The driver end to end: widget messages in, replies and backend effects out. The backend is an
//! `InMemoryBackend`; the platform records everything it is told.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use matrix_widget_actions::{
    Base64File, Capability, DownloadFileRequest, DownloadFileResponse, ErrorKind, GetClientContextResponse,
    GetMatrixContextResponse, GetRtcLivekitTokenRequest, GetRtcLivekitTokenResponse, HostRequest, JsonValue,
    MatrixEvent, NavigateRequest, NotifyTimelineUpdateRequest, PaginateTimelineRequest, PaginationStatus,
    ReadRelationsRequest, ReadRoomAccountDataRequest, ReadTimelineRequest, ReadTimelineResponse,
    RequestCapabilitiesRequest, RoomSelector, RtcTransportsResponse, SearchUserDirectoryRequest, SendEventRequest,
    SendEventResponse, SendToDeviceRequest, SetAlwaysOnScreenRequest, SetAlwaysOnScreenResponse, Source,
    TimelineFilter, TimelinePagination, ToDeviceEvent, TurnServer, UpdateDelayedEventAction, UpdateDelayedEventRequest,
    UploadFileRequest, WidgetError, WidgetRequest, WidgetResponse, WireMessage,
};
use matrix_widget_host_backend_interface::{BackendError, InMemoryBackend, MatrixBackend, MediaFile};
use serde_json::{json, Value};

use crate::{
    legacy_auto_approved, DriverError, EmbedOptions, PlatformError, WidgetDefinition, WidgetEventError,
    WidgetHostDriver, WidgetHostPlatform, WidgetIframe,
};

/// The `response` of the reply `$msg`, which must be a `WidgetResponse::$variant`.
macro_rules! response {
    ($variant:ident, $msg:expr) => {
        match WidgetResponse::from_wire(&$msg) {
            Ok(WidgetResponse::$variant { response }) => response,
            other => panic!("not a {}: {other:?}", stringify!($variant)),
        }
    };
}

const ROOM: &str = "!room:x";
const STRICT: &str = "allow-scripts allow-same-origin";

#[derive(Default)]
struct RecordingPlatform {
    sent: Mutex<Vec<WireMessage>>,
    loaded: Mutex<Vec<WidgetIframe>>,
    requested: Mutex<Vec<Vec<Capability>>>,
    ready: AtomicBool,
    navigated: Mutex<Vec<String>>,
    always_on_screen: Mutex<Option<bool>>,
}

impl RecordingPlatform {
    fn drain(&self) -> Vec<WireMessage> {
        std::mem::take(&mut *self.sent.lock().unwrap())
    }

    /// Every question of `on_capabilities_requested` so far.
    fn asked(&self) -> Vec<Vec<Capability>> {
        self.requested.lock().unwrap().clone()
    }

    fn forget_asked(&self) {
        self.requested.lock().unwrap().clear();
    }

    fn loaded(&self) -> Vec<WidgetIframe> {
        self.loaded.lock().unwrap().clone()
    }

    fn is_ready(&self) -> bool {
        self.ready.load(Ordering::SeqCst)
    }
}

impl WidgetHostPlatform for RecordingPlatform {
    fn load_iframe(&self, iframe: WidgetIframe) {
        self.loaded.lock().unwrap().push(iframe);
    }
    fn send_to_widget(&self, json: String) {
        self.sent.lock().unwrap().push(WireMessage::from_json(&json).unwrap());
    }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) {
        self.requested.lock().unwrap().push(requested);
    }
    fn on_ready(&self) {
        self.ready.store(true, Ordering::SeqCst);
    }
    fn navigate(&self, uri: String) -> Result<(), PlatformError> {
        if uri.contains("broken") {
            return Err(PlatformError::new("no such room"));
        }
        self.navigated.lock().unwrap().push(uri);
        Ok(())
    }
    fn set_always_on_screen(&self, value: bool) -> bool {
        *self.always_on_screen.lock().unwrap() = Some(value);
        value
    }
    fn client_id(&self) -> Option<String> {
        Some("test-client".into())
    }
    fn client_theme(&self) -> Option<String> {
        Some("dark".into())
    }
    fn client_language(&self) -> Option<String> {
        None
    }
}

type Setup = (Arc<WidgetHostDriver>, Arc<InMemoryBackend>, Arc<RecordingPlatform>);

/// A started driver of an MSC4411 widget with the widget API.
fn setup() -> Setup {
    let setup = setup_for(widget("m.widget", true));
    setup.0.start();
    setup
}

/// A driver for `widget` that was not started, of a client with a compat wrapper.
fn setup_for(widget: WidgetDefinition) -> Setup {
    let backend = InMemoryBackend::new(ROOM.into(), "@me:x".into());
    let platform = Arc::new(RecordingPlatform::default());
    let options =
        EmbedOptions { wrapper_url: Some("https://client.example/wrapper/".into()), ..EmbedOptions::default() };
    let driver = WidgetHostDriver::new(widget, options, backend.clone(), platform.clone()).unwrap();
    (driver, backend, platform)
}

/// A widget at `https://widget.example/app`: an MSC4411 one, or a legacy one.
fn widget(event_type: &str, uses_widget_api: bool) -> WidgetDefinition {
    let content = json!({ "name": "W", "url": "https://widget.example/app", "uses_widget_api": uses_widget_api });
    WidgetDefinition::parse(event_type, "w", &content).unwrap()
}

fn handle(driver: &WidgetHostDriver, msg: &WireMessage) -> Result<(), DriverError> {
    futures::executor::block_on(driver.handle_message_from_widget(msg.to_json()))
}

fn feed(driver: &WidgetHostDriver, request: WidgetRequest, id: &str) -> Result<(), DriverError> {
    handle(driver, &request.into_wire(id))
}

/// Feed `request` and return everything the driver sent.
fn call(driver: &WidgetHostDriver, platform: &RecordingPlatform, request: WidgetRequest) -> Vec<WireMessage> {
    feed(driver, request, "call").unwrap();
    platform.drain()
}

/// Feed `request` and return the last message the driver sent: the reply.
fn reply(driver: &WidgetHostDriver, platform: &RecordingPlatform, request: WidgetRequest) -> WireMessage {
    call(driver, platform, request).pop().unwrap()
}

fn send(driver: &WidgetHostDriver, platform: &RecordingPlatform, request: SendEventRequest) -> WireMessage {
    reply(driver, platform, WidgetRequest::SendEvent { request })
}

fn navigate(uri: &str) -> WidgetRequest {
    WidgetRequest::Navigate { request: NavigateRequest { uri: uri.into() } }
}

fn request_caps(driver: &WidgetHostDriver, capabilities: Vec<Capability>, id: &str) {
    let request = RequestCapabilitiesRequest { capabilities };
    feed(driver, WidgetRequest::RequestCapabilities { request }, id).unwrap();
}

/// Request `caps` and approve them. Returns what was sent after the `update_capabilities`.
fn grant(driver: &WidgetHostDriver, platform: &RecordingPlatform, caps: Vec<Capability>) -> Vec<WireMessage> {
    request_caps(driver, caps.clone(), "grant");
    driver.approve_capabilities(caps);
    let mut sent = platform.drain();
    let update = sent.iter().position(|msg| short(msg) == "update_capabilities").expect("update_capabilities");
    sent.split_off(update + 1)
}

/// The `allowed` lists of the `update_capabilities` among `sent`.
fn updates(sent: &[WireMessage]) -> Vec<Vec<Capability>> {
    sent.iter()
        .filter_map(|msg| match HostRequest::from_wire(msg) {
            Ok(HostRequest::UpdateCapabilities { request }) => Some(request.allowed),
            _ => None,
        })
        .collect()
}

/// The action name without its namespace.
fn short(msg: &WireMessage) -> &str {
    msg.action.rsplit('.').next().unwrap()
}

fn actions(sent: &[WireMessage]) -> Vec<&str> {
    sent.iter().map(short).collect()
}

fn notification(msg: &WireMessage) -> NotifyTimelineUpdateRequest {
    match HostRequest::from_wire(msg) {
        Ok(HostRequest::NotifyTimelineUpdate { request }) => request,
        other => panic!("not a notify_timeline_update: {other:?}"),
    }
}

/// An event with the ID `$in`.
fn event(event_type: &str, state_key: Option<&str>, content: Value) -> MatrixEvent {
    MatrixEvent {
        event_type: event_type.into(),
        sender: "@other:x".into(),
        event_id: "$in".into(),
        room_id: ROOM.into(),
        origin_server_ts: 5,
        state_key: state_key.map(Into::into),
        content: content.into(),
        unsigned: None,
    }
}

fn event_with_id(event_id: &str, event_type: &str, content: Value) -> MatrixEvent {
    MatrixEvent { event_id: event_id.into(), ..event(event_type, None, content) }
}

fn read_timeline(
    driver: &WidgetHostDriver,
    platform: &RecordingPlatform,
    request: ReadTimelineRequest,
) -> Result<ReadTimelineResponse, WidgetError> {
    match WidgetResponse::from_wire(&reply(driver, platform, WidgetRequest::ReadTimeline { request })) {
        Ok(WidgetResponse::ReadTimeline { response }) => Ok(response),
        Err(matrix_widget_actions::ActionError::ErrorResponse { error }) => Err(error),
        other => panic!("{other:?}"),
    }
}

fn below(from: &str, limit: u32) -> ReadTimelineRequest {
    ReadTimelineRequest { from: Some(from.into()), limit, filter: None }
}

fn event_ids(response: &ReadTimelineResponse) -> Vec<&str> {
    response.events.iter().map(|e| e.event_id.as_str()).collect()
}

fn types(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn notify_ready_is_acked_and_reported() {
    let (driver, _, platform) = setup();
    feed(&driver, WidgetRequest::NotifyReady, "c1").unwrap();
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].request_id, "c1");
    assert_eq!(sent[0].source, Source::Widget);
    assert_eq!(sent[0].response_body(), json!({}));
    assert!(platform.is_ready());
    assert!(driver.snapshot().ready);
}

#[test]
fn capability_negotiation() {
    let (driver, _, platform) = setup();
    let caps = vec![Capability::send_event("m.room.message"), Capability::forward_event("m.room.message")];
    request_caps(&driver, caps.clone(), "cap1");

    // Immediate ack, platform asked.
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].request_id, "cap1");
    assert_eq!(platform.asked(), std::slice::from_ref(&caps));
    assert_eq!(driver.snapshot().pending_requested, caps);
    assert!(driver.snapshot().approved.is_empty());

    // Only what was requested is granted.
    driver.approve_capabilities(vec![Capability::send_event("m.room.message"), Capability::send_event("evil")]);
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    assert_eq!(updates(&sent), [vec![Capability::send_event("m.room.message")]]);
    assert_eq!(driver.snapshot().approved, vec![Capability::send_event("m.room.message")]);
    assert!(driver.snapshot().pending_requested.is_empty());

    // The widget acks update_capabilities; a second ack for the same id is unexpected.
    handle(&driver, &sent[0].ack()).unwrap();
    assert_eq!(
        handle(&driver, &sent[0].ack()),
        Err(DriverError::UnexpectedResponse { request_id: sent[0].request_id.clone() })
    );

    // A second round: `allowed` is always the full list.
    let more = vec![Capability::read_timeline("m.room.topic")];
    request_caps(&driver, more.clone(), "cap2");
    driver.approve_capabilities(more);
    assert_eq!(
        updates(&platform.drain()),
        [vec![Capability::send_event("m.room.message"), Capability::read_timeline("m.room.topic")]]
    );

    // Approving again with nothing pending is a no-op.
    driver.approve_capabilities(vec![Capability::send_event("x")]);
    assert!(platform.drain().is_empty());
}

#[test]
fn send_event_requires_capability() {
    let (driver, backend, platform) = setup();
    let hi = || SendEventRequest::room_event("m.room.message", json!({"body": "hi"}).into());
    let error = send(&driver, &platform, hi()).error().unwrap();
    assert_eq!(error.code, "org.matrix.msc4412.missing_capability");
    assert_eq!(error.message, "Missing capability: widget:org.matrix.mscXXXX.send_event.timeline:m.room.message");
    assert!(backend.timeline().is_empty());

    grant(&driver, &platform, vec![Capability::send_event("m.room.message")]);
    let response = response!(SendEvent, send(&driver, &platform, hi()));
    assert_eq!(response, SendEventResponse::sent(ROOM, backend.timeline()[0].event_id.clone()));
    assert_eq!(backend.timeline()[0].content["body"], "hi");

    // A state event with a timeline capability: denied.
    let state = SendEventRequest::state_event("m.room.message", "", json!({}).into());
    assert!(send(&driver, &platform, state).error().is_some());

    // A backend failure reaches the widget with its Matrix details.
    backend.set_fail_sends(Some(BackendError::forbidden("power level")));
    let error = send(&driver, &platform, hi()).error().unwrap();
    assert!(error.message.contains("power level"));
    let matrix = error.matrix_api_error.unwrap();
    assert_eq!(matrix.http_status, 403);
    assert_eq!(matrix.response.errcode, "M_FORBIDDEN");
    assert_eq!(matrix.response.error, "power level");
}

#[test]
fn redactions_are_sent_with_redact_event() {
    let (driver, backend, platform) = setup();
    grant(&driver, &platform, vec![Capability::send_event("m.room.redaction")]);
    backend.inject(event("m.room.message", None, json!({"body": "spam"})));
    let target = backend.timeline()[0].event_id.clone();
    let content = json!({"redacts": target, "reason": "spam"});
    let reply = send(&driver, &platform, SendEventRequest::room_event("m.room.redaction", content.clone().into()));
    assert!(reply.error().is_none(), "{reply:?}");
    let [message, redaction] = &backend.timeline()[..] else { panic!("{:?}", backend.timeline()) };
    assert_eq!(redaction.content.0, content);
    assert_eq!(message.content.0, json!({}));
    assert_eq!(message.unsigned.as_ref().unwrap()["redacted_because"]["event_id"], redaction.event_id);

    let reply = send(&driver, &platform, SendEventRequest::room_event("m.room.redaction", json!({}).into()));
    assert!(reply.error().unwrap().message.contains("content.redacts"));
}

#[test]
fn msgtype_capabilities_narrow_sends_and_reads() {
    let (driver, backend, platform) = setup();
    grant(
        &driver,
        &platform,
        vec![
            Capability::send_message("m.text"),
            Capability::read_timeline_messages("m.text"),
            Capability::forward_messages("m.text"),
        ],
    );
    let message = |msgtype: &str| WidgetRequest::SendEvent {
        request: SendEventRequest::room_event("m.room.message", json!({"msgtype": msgtype, "body": "x"}).into()),
    };
    // The text message is echoed through the subscription (forward_event) and answered.
    let sent = call(&driver, &platform, message("m.text"));
    assert_eq!(actions(&sent), ["forward_event", "send_event"]);
    assert!(sent[1].error().is_none());
    assert!(reply(&driver, &platform, message("m.image")).error().unwrap().message.contains("m.room.message"));
    backend.inject(event("m.room.message", None, json!({"msgtype": "m.image", "body": "pic"})));
    assert!(platform.drain().is_empty());

    let response = read_timeline(&driver, &platform, ReadTimelineRequest::newest(50)).unwrap();
    assert_eq!(response.events.len(), 1);
    assert_eq!(response.events[0].content["msgtype"], "m.text");
}

#[test]
fn delayed_and_sticky_sends() {
    let (driver, backend, platform) = setup();
    let mut delayed = SendEventRequest::room_event("m.room.message", json!({"body": "later"}).into());
    delayed.delay = Some(5000);
    let mut sticky = SendEventRequest::room_event("m.rtc.member", json!({}).into());
    sticky.sticky_duration_ms = Some(30000);

    // Without the `delayed` / `sticky` capabilities both are refused, even with `send_event.timeline`.
    grant(&driver, &platform, vec![Capability::send_event("m.room.message"), Capability::send_event("m.rtc.member")]);
    assert!(send(&driver, &platform, delayed.clone()).error().unwrap().message.contains("send_event.delayed"));
    assert!(send(&driver, &platform, sticky.clone()).error().unwrap().message.contains("send_event.sticky"));

    grant(
        &driver,
        &platform,
        vec![Capability::SendDelayedEvent, Capability::SendStickyEvent, Capability::UpdateDelayedEvent],
    );
    let response = response!(SendEvent, send(&driver, &platform, delayed));
    assert!(response.event_id.is_none());
    let delay_id = response.delay_id.unwrap();
    assert_eq!(backend.delayed_events()[0].delay_id, delay_id);
    assert!(backend.timeline().is_empty());

    // A sticky state event is nonsense.
    let mut sticky_state = SendEventRequest::state_event("m.room.topic", "", json!({}).into());
    sticky_state.sticky_duration_ms = Some(1);
    assert!(send(&driver, &platform, sticky_state).error().unwrap().message.contains("sticky"));

    // Sticky send goes through the sticky method.
    let response = response!(SendEvent, send(&driver, &platform, sticky));
    assert_eq!(backend.timeline()[0].event_id, response.event_id.unwrap());

    // update_delayed_event: restart, then fire.
    let update = |delay_id: &str, action| {
        let request = UpdateDelayedEventRequest { delay_id: delay_id.into(), action };
        reply(&driver, &platform, WidgetRequest::UpdateDelayedEvent { request })
    };
    for action in [UpdateDelayedEventAction::Restart, UpdateDelayedEventAction::Send] {
        assert_eq!(WidgetResponse::from_wire(&update(&delay_id, action)).unwrap(), WidgetResponse::UpdateDelayedEvent);
    }
    assert!(backend.delayed_events().is_empty());
    assert_eq!(backend.timeline()[1].content["body"], "later");

    // Cancelling an unknown id is a backend error with Matrix details.
    let error = update("nope", UpdateDelayedEventAction::Cancel).error().unwrap();
    assert_eq!(error.matrix_api_error.unwrap().response.errcode, "M_NOT_FOUND");
}

#[test]
fn explicit_room_id_must_be_the_own_room() {
    let (driver, backend, platform) = setup();
    grant(&driver, &platform, vec![Capability::send_event("m.room.message")]);
    // Naming the own room needs no capability.
    let mut req = SendEventRequest::room_event("m.room.message", json!({}).into());
    req.room_id = Some(ROOM.into());
    assert!(send(&driver, &platform, req.clone()).error().is_none());
    assert_eq!(backend.timeline().len(), 1);

    // No capability reaches another room, not even the legacy `timeline` strings.
    req.room_id = Some("!other:x".into());
    assert!(send(&driver, &platform, req.clone()).error().unwrap().message.contains("its own room"));
    grant(
        &driver,
        &platform,
        vec![
            Capability::parse("org.matrix.msc2762.timeline:*"),
            Capability::parse("org.matrix.msc2762.timeline:!other:x"),
            Capability::parse("widget:m.send_event.room:!other:x"),
        ],
    );
    assert!(send(&driver, &platform, req).error().unwrap().message.contains("its own room"));
    assert_eq!(backend.timeline().len(), 1);
}

#[test]
fn read_relations_is_filtered_and_room_checked() {
    let (driver, backend, platform) = setup();
    backend.inject(event_with_id("$root", "m.room.message", json!({"body": "root"})));
    let relation = json!({"m.relates_to": {"rel_type": "m.annotation", "event_id": "$root"}});
    backend.inject(event_with_id("$r1", "m.reaction", relation.clone()));
    backend.inject(event_with_id("$o1", "org.example.other", relation));

    let read = |room_id: Option<&str>| {
        let mut request = ReadRelationsRequest::new("$root");
        request.room_id = room_id.map(Into::into);
        reply(&driver, &platform, WidgetRequest::ReadRelations { request })
    };
    let chunk = |msg: WireMessage| -> Vec<String> {
        response!(ReadRelations, msg).chunk.into_iter().map(|e| e.event_id).collect()
    };
    // No `read_relations` capability yet: an empty page, not an error.
    assert!(chunk(read(None)).is_empty());

    // Reading or being forwarded a type does not make it readable as a relation.
    grant(
        &driver,
        &platform,
        vec![
            Capability::read_timeline("m.reaction"),
            Capability::forward_event("m.reaction"),
            Capability::read_timeline("org.example.other"),
        ],
    );
    assert!(chunk(read(None)).is_empty());

    grant(&driver, &platform, vec![Capability::read_relations("m.reaction")]);
    assert_eq!(chunk(read(None)), ["$r1"]);

    // The own room may be named; another room cannot be read.
    assert_eq!(chunk(read(Some(ROOM))), ["$r1"]);
    assert!(read(Some("!other:x")).error().unwrap().message.contains("its own room"));
}

#[test]
fn read_timeline_returns_what_the_widget_may_read_newest_first() {
    let (driver, backend, platform) = setup();
    backend.inject(event_with_id("$t1", "m.room.message", json!({"msgtype": "m.text", "body": "1"})));
    backend.inject(event_with_id("$i1", "m.room.message", json!({"msgtype": "m.image", "body": "2"})));
    backend.inject(event_with_id("$r1", "m.reaction", json!({})));
    backend.inject(event_with_id("$t2", "m.room.message", json!({"msgtype": "m.text", "body": "3"})));
    backend.inject(MatrixEvent { state_key: Some("".into()), ..event_with_id("$topic", "m.room.topic", json!({})) });
    backend.inject(event_with_id("$t3", "m.room.message", json!({"msgtype": "m.text", "body": "4"})));

    // No capability: refused.
    let err = read_timeline(&driver, &platform, ReadTimelineRequest::newest(10)).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::MissingCapability);
    assert!(err.message.contains("read_timeline"), "{}", err.message);

    grant(
        &driver,
        &platform,
        vec![
            Capability::read_timeline_messages("m.text"),
            Capability::read_timeline("m.reaction"),
            Capability::read_timeline("m.room.topic"),
        ],
    );
    // Everything readable, newest first; the image is not readable. A state event of the
    // timeline is read like any other.
    let all = read_timeline(&driver, &platform, ReadTimelineRequest::newest(10)).unwrap();
    assert_eq!(event_ids(&all), ["$t3", "$topic", "$t2", "$r1", "$t1"]);
    assert_eq!(all.pagination, PaginationStatus::Idle);

    // `limit` counts readable events; `from` continues below an event (exclusive), also one the
    // widget cannot read.
    let page = read_timeline(&driver, &platform, ReadTimelineRequest::newest(2)).unwrap();
    assert_eq!(event_ids(&page), ["$t3", "$topic"]);
    assert_eq!(event_ids(&read_timeline(&driver, &platform, below("$topic", 2)).unwrap()), ["$t2", "$r1"]);
    assert_eq!(event_ids(&read_timeline(&driver, &platform, below("$i1", 5)).unwrap()), ["$t1"]);

    // The filter: an entry the widget may not read is dropped, not an error.
    let filter =
        vec![TimelineFilter::new("m.room.message", None::<&str>), TimelineFilter::new("m.room.name", None::<&str>)];
    let filtered = ReadTimelineRequest { from: None, limit: 10, filter: Some(filter) };
    assert_eq!(event_ids(&read_timeline(&driver, &platform, filtered).unwrap()), ["$t3", "$t2", "$t1"]);

    // `from` not in the cache.
    let err = read_timeline(&driver, &platform, below("$gone", 10)).unwrap_err();
    assert_eq!(err.kind(), ErrorKind::EventNotCached);
    assert_eq!(err.code, "org.matrix.mscXXXX.event_not_cached");
}

#[test]
fn paginate_timeline_answers_at_once_and_notifies_the_outcome() {
    let (driver, backend, platform) = setup();
    backend.inject(event_with_id("$new", "m.room.message", json!({"body": "new"})));
    let paginate = |limit: Option<u32>| {
        call(&driver, &platform, WidgetRequest::PaginateTimeline { request: PaginateTimelineRequest { limit } })
    };
    let status = |msg: &WireMessage| response!(PaginateTimeline, msg).pagination;
    let pagination = |status, error: Option<&str>| NotifyTimelineUpdateRequest {
        pagination: Some(TimelinePagination { status, error: error.map(WidgetError::new) }),
        ..Default::default()
    };

    // Without the capability: refused, nothing started.
    let error = paginate(None)[0].error().unwrap();
    assert_eq!(error.kind(), ErrorKind::MissingCapability);
    assert!(error.message.ends_with("widget:org.matrix.mscXXXX.paginate_timeline"));
    assert_eq!(backend.pending_pagination(), None);

    // Paginate without being notified: the answer only.
    grant(&driver, &platform, vec![Capability::read_timeline("m.room.message"), Capability::PaginateTimeline]);
    let sent = paginate(Some(5));
    assert_eq!(sent.len(), 1);
    assert_eq!(status(&sent[0]), PaginationStatus::Paginating);
    assert_eq!(backend.pending_pagination().unwrap().limit, Some(5));
    backend.resolve_pagination(vec![event_with_id("$old", "m.room.message", json!({"body": "old"}))], false);
    assert!(platform.drain().is_empty());
    assert_eq!(event_ids(&read_timeline(&driver, &platform, below("$new", 5)).unwrap()), ["$old"]);

    // With `notify_timeline_update`: the start and the outcome are announced.
    grant(&driver, &platform, vec![Capability::NotifyTimelineUpdate]);
    let sent = paginate(None);
    assert_eq!(actions(&sent), ["notify_timeline_update", "paginate_timeline"]);
    assert_eq!(notification(&sent[0]), pagination(PaginationStatus::Paginating, None));
    assert_eq!(status(&sent[1]), PaginationStatus::Paginating);
    handle(&driver, &sent[0].ack()).unwrap();
    // Joining the running one announces nothing.
    assert_eq!(status(&paginate(None)[0]), PaginationStatus::Paginating);

    backend.fail_pagination("the homeserver is gone".into());
    assert_eq!(
        notification(&platform.drain()[0]),
        pagination(PaginationStatus::Idle, Some("Pagination failed: the homeserver is gone"))
    );

    paginate(None);
    backend.resolve_pagination(vec![event_with_id("$first", "m.room.create", json!({}))], true);
    assert_eq!(notification(&platform.drain()[0]), pagination(PaginationStatus::StartReached, None));
    // The new events are in the cache when the notification arrives; the type the widget cannot
    // read is not returned.
    let response = read_timeline(&driver, &platform, below("$old", 5)).unwrap();
    assert!(response.events.is_empty());
    assert_eq!(response.pagination, PaginationStatus::StartReached);
    // At the start of the room nothing happens.
    let sent = paginate(None);
    assert_eq!(sent.len(), 1);
    assert_eq!(status(&sent[0]), PaginationStatus::StartReached);
}

#[test]
fn notify_timeline_update_follows_its_capability() {
    let (driver, backend, platform) = setup();
    backend.inject(event_with_id("$text", "m.room.message", json!({"msgtype": "m.text"})));
    backend.inject(event_with_id("$image", "m.room.message", json!({"msgtype": "m.image"})));
    backend.inject(event_with_id("$secret", "org.example.secret", json!({})));
    let notified = || {
        let sent = platform.drain();
        assert!(sent.len() <= 1, "{sent:?}");
        sent.first().map(notification)
    };

    // Not subscribed without the capability, also when the widget reads.
    grant(&driver, &platform, vec![Capability::read_timeline_messages("m.text")]);
    backend.reset_timeline();
    assert_eq!(notified(), None);

    // `notify_timeline_update` alone tells the widget about gaps.
    grant(&driver, &platform, vec![Capability::NotifyTimelineUpdate]);
    backend.reset_timeline();
    assert_eq!(notified(), Some(NotifyTimelineUpdateRequest { reset: true, ..Default::default() }));

    // Decrypted events: only the IDs of those the widget may read. Nothing readable: no message.
    backend.report_decrypted(vec!["$text".into(), "$image".into(), "$secret".into()]);
    assert_eq!(notified().unwrap().decrypted, ["$text"]);
    backend.report_decrypted(vec!["$image".into(), "$secret".into()]);
    assert_eq!(notified(), None);

    // Revoked: unsubscribed.
    driver.revoke_capabilities(vec![Capability::NotifyTimelineUpdate]);
    platform.drain();
    backend.reset_timeline();
    assert_eq!(notified(), None);
}

#[test]
fn reading_and_forwarding_are_separate_capabilities() {
    let (driver, backend, platform) = setup();
    // `forward_event` only: new events are pushed, but `read_timeline` is refused.
    grant(&driver, &platform, vec![Capability::forward_event("m.room.message")]);
    backend.inject(event("m.room.message", None, json!({"body": "1"})));
    assert_eq!(actions(&platform.drain()), ["forward_event"]);
    let messages = ReadTimelineRequest {
        from: None,
        limit: 10,
        filter: Some(vec![TimelineFilter::new("m.room.message", None::<&str>)]),
    };
    let err = read_timeline(&driver, &platform, messages).unwrap_err();
    assert!(err.message.contains("read_timeline:m.room.message"));

    // `read_timeline` only (another type): readable, but nothing is pushed.
    grant(&driver, &platform, vec![Capability::read_timeline("m.reaction")]);
    backend.inject(event("m.reaction", None, json!({})));
    assert!(platform.drain().is_empty());
    let response = read_timeline(&driver, &platform, ReadTimelineRequest::newest(10)).unwrap();
    assert_eq!(response.events.len(), 1);
    assert_eq!(response.events[0].event_type, "m.reaction");
}

#[test]
fn subscriptions_follow_the_approved_capabilities() {
    let (driver, backend, platform) = setup();
    // The widget's own actions subscribe to nothing.
    grant(
        &driver,
        &platform,
        vec![
            Capability::send_event("m.room.message"),
            Capability::read_timeline("m.room.message"),
            Capability::PaginateTimeline,
            Capability::send_to_device("c"),
        ],
    );
    assert!(backend.room_subscriptions().is_empty());
    assert!(backend.to_device_subscriptions().is_empty());

    grant(&driver, &platform, vec![Capability::forward_event("m.room.message"), Capability::forward_to_device("a")]);
    let subscriptions = backend.room_subscriptions();
    assert_eq!(subscriptions.len(), 1);
    assert_eq!(subscriptions[0].timeline_event_types, types(&["m.room.message"]));
    assert!(subscriptions[0].state_event_types.is_empty());
    assert_eq!(backend.to_device_subscriptions(), vec![types(&["a"])]);

    // A new host capability: the old subscriptions are replaced by wider ones.
    grant(
        &driver,
        &platform,
        vec![
            Capability::update_state("m.room.topic", None::<&str>),
            Capability::forward_state_event("m.room.topic", None::<&str>),
            Capability::forward_to_device("b"),
        ],
    );
    let subscriptions = backend.room_subscriptions();
    assert_eq!(subscriptions.len(), 1);
    assert_eq!(subscriptions[0].timeline_event_types, types(&["m.room.message", "m.room.topic"]));
    assert_eq!(subscriptions[0].state_event_types, types(&["m.room.topic"]));
    assert_eq!(backend.to_device_subscriptions(), vec![types(&["a", "b"])]);

    // Dropping the driver cancels them.
    drop(driver);
    assert!(backend.room_subscriptions().is_empty());
    assert!(backend.to_device_subscriptions().is_empty());
}

#[test]
fn openid_is_a_one_use_capability() {
    let (driver, _, platform) = setup();
    assert_eq!(driver.snapshot().single_use, vec![Capability::GetOpenId]);
    // Without the capability: refused, the error names it.
    let error = reply(&driver, &platform, WidgetRequest::GetOpenId).error().unwrap();
    assert_eq!(error.kind(), ErrorKind::MissingCapability);
    assert!(error.message.contains("widget:org.matrix.mscXXXX.get_openid"));

    // Granted in the capability negotiation like any other; it is the user's consent.
    grant(&driver, &platform, vec![Capability::GetOpenId, Capability::Navigate]);
    feed(&driver, WidgetRequest::GetOpenId, "o1").unwrap();
    let sent = platform.drain();
    // The token at once, then the update without the capability: the use ended the grant.
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].request_id, "o1");
    let token = response!(GetOpenId, sent[0]);
    assert!(token.access_token.starts_with("openid-token-"));
    assert_eq!(token.matrix_server_name, "matrix.example.org");
    assert_eq!(updates(&sent[1..]), [vec![Capability::Navigate]]);
    assert_eq!(driver.snapshot().approved, vec![Capability::Navigate]);
    handle(&driver, &sent[1].ack()).unwrap();

    // A second token needs a second grant.
    let sent = call(&driver, &platform, WidgetRequest::GetOpenId);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].error().unwrap().kind(), ErrorKind::MissingCapability);
    request_caps(&driver, vec![Capability::GetOpenId], "again");
    assert_eq!(platform.asked().last().unwrap(), &vec![Capability::GetOpenId]);
    driver.approve_capabilities(vec![Capability::GetOpenId]);
    platform.drain();
    let sent = call(&driver, &platform, WidgetRequest::GetOpenId);
    assert_ne!(response!(GetOpenId, sent[0]), token);
    assert_eq!(updates(&sent), [vec![Capability::Navigate]]);
}

#[test]
fn a_use_is_a_request_that_passed_the_check_whatever_its_result() {
    let (driver, _, platform) = setup();
    driver.set_single_use(vec![Capability::Navigate]);
    assert_eq!(driver.snapshot().single_use, vec![Capability::Navigate]);
    grant(&driver, &platform, vec![Capability::Navigate, Capability::GetOpenId]);
    // The platform refuses to navigate: the widget gets the error, and the capability is used up.
    let sent = call(&driver, &platform, navigate("https://matrix.to/#/!broken:x"));
    assert!(sent[0].error().unwrap().message.contains("no such room"));
    assert_eq!(updates(&sent), [vec![Capability::GetOpenId]]);
    // An invalid request does not pass the check, so nothing is used up.
    grant(&driver, &platform, vec![Capability::Navigate]);
    let wire = WireMessage::request(Source::Widget, "org.matrix.msc2931.navigate", "n2", json!({"uri": 5}));
    handle(&driver, &wire).unwrap();
    assert_eq!(platform.drain()[0].error().unwrap().kind(), ErrorKind::InvalidRequest);
    assert!(driver.snapshot().approved.contains(&Capability::Navigate));
    // `get_openid` is no longer single use: it stays.
    feed(&driver, WidgetRequest::GetOpenId, "o1").unwrap();
    feed(&driver, WidgetRequest::GetOpenId, "o2").unwrap();
    let sent = platform.drain();
    assert_eq!(sent.len(), 2);
    assert!(updates(&sent).is_empty());
    response!(GetOpenId, sent[1]);
}

#[test]
fn host_capabilities_are_never_single_use() {
    let (driver, _, platform) = setup();
    // `watch_turn_servers` needs the host capability of the pushes it starts; a push uses nothing up.
    driver.set_single_use(vec![Capability::UpdateTurnServers, Capability::UpdateTheme, Capability::Navigate]);
    assert_eq!(driver.snapshot().single_use, vec![Capability::Navigate]);
    grant(&driver, &platform, vec![Capability::UpdateTurnServers, Capability::UpdateTheme]);
    feed(&driver, WidgetRequest::WatchTurnServers, "w1").unwrap();
    feed(&driver, WidgetRequest::UnwatchTurnServers, "w2").unwrap();
    driver.update_theme(json!({"name": "dark"}).into());
    driver.update_theme(json!({"name": "light"}).into());
    let sent = platform.drain();
    assert!(updates(&sent).is_empty());
    assert_eq!(sent.iter().filter(|m| short(m) == "update_theme").count(), 2);
    assert_eq!(driver.snapshot().approved, vec![Capability::UpdateTurnServers, Capability::UpdateTheme]);
}

#[test]
fn an_auto_approved_single_use_capability_is_granted_again_per_request() {
    // "Always": the client remembers it as auto-approved.
    let (driver, _, platform) = setup();
    driver.set_auto_approved(vec![Capability::GetOpenId]);
    for _ in 0..2 {
        request_caps(&driver, vec![Capability::GetOpenId], "r");
        assert_eq!(updates(&platform.drain()), [vec![Capability::GetOpenId]]);
        let sent = call(&driver, &platform, WidgetRequest::GetOpenId);
        response!(GetOpenId, sent[0]);
        assert_eq!(updates(&sent), [Vec::<Capability>::new()]);
    }
    assert!(platform.asked().is_empty());
}

#[test]
fn using_a_capability_up_while_a_question_is_open() {
    let (driver, _, platform) = setup();
    grant(&driver, &platform, vec![Capability::GetOpenId]);
    platform.forget_asked();
    request_caps(&driver, vec![Capability::Navigate, Capability::GetOpenId], "a");
    assert_eq!(platform.asked(), [vec![Capability::Navigate]]);
    platform.drain();

    // The use ends the grant at once; the open question stays open.
    let sent = call(&driver, &platform, WidgetRequest::GetOpenId);
    response!(GetOpenId, sent[0]);
    assert_eq!(updates(&sent), [Vec::<Capability>::new()]);
    assert_eq!(driver.snapshot().pending_requested, vec![Capability::Navigate, Capability::GetOpenId]);
    // The platform was not asked about it, so an answer that approves what it was asked about
    // does not grant it again (like a capability revoked while the question is open) ...
    driver.approve_capabilities(vec![Capability::Navigate]);
    assert_eq!(updates(&platform.drain()), [vec![Capability::Navigate]]);
    // ... and a request for it while a question is open joins the question.
    request_caps(&driver, vec![Capability::UploadFile], "b");
    request_caps(&driver, vec![Capability::GetOpenId], "c");
    assert_eq!(platform.asked().last().unwrap(), &vec![Capability::UploadFile, Capability::GetOpenId]);
}

#[test]
fn turn_servers() {
    let (driver, backend, platform) = setup();
    let turn = |u: &str| TurnServer { uris: vec!["turn:x".into()], username: u.into(), password: "p".into() };
    backend.set_turn_server(turn("first"));
    let error = reply(&driver, &platform, WidgetRequest::WatchTurnServers).error().unwrap();
    assert!(error.message.contains("host:org.matrix.mscXXXX.update_turn_servers"));

    grant(&driver, &platform, vec![Capability::UpdateTurnServers]);
    let sent = call(&driver, &platform, WidgetRequest::WatchTurnServers);
    // The ack, then the current credentials.
    assert_eq!(sent.len(), 2);
    assert_eq!(WidgetResponse::from_wire(&sent[0]).unwrap(), WidgetResponse::WatchTurnServers);
    assert_eq!(HostRequest::from_wire(&sent[1]).unwrap(), HostRequest::UpdateTurnServers { server: turn("first") });
    // Watching twice is a plain ack.
    assert_eq!(call(&driver, &platform, WidgetRequest::WatchTurnServers).len(), 1);
    backend.set_turn_server(turn("second"));
    assert_eq!(platform.drain()[0].request_body()["username"], "second");

    let unwatched = reply(&driver, &platform, WidgetRequest::UnwatchTurnServers);
    assert_eq!(WidgetResponse::from_wire(&unwatched).unwrap(), WidgetResponse::UnwatchTurnServers);
    backend.set_turn_server(turn("third"));
    assert!(platform.drain().is_empty());
}

#[test]
fn read_style_actions_need_their_capabilities() {
    let (driver, backend, platform) = setup();
    backend.set_rtc_transports(json!([{"type": "livekit"}]).into());
    backend.set_room_account_data("m.tag".into(), json!({"tags": {}}).into());
    backend.inject(event("m.room.member", Some("@alice:x"), json!({"membership": "join"})));
    let account_data = |event_type: &str, room_ids| WidgetRequest::ReadRoomAccountData {
        request: ReadRoomAccountDataRequest { event_type: event_type.into(), room_ids },
    };
    let requests = || {
        vec![
            WidgetRequest::GetRtcTransports,
            WidgetRequest::SearchUserDirectory {
                request: SearchUserDirectoryRequest { search_term: "ali".into(), limit: None },
            },
            WidgetRequest::GetMediaConfig,
            account_data("m.tag", None),
            WidgetRequest::GetRtcLivekitToken {
                request: GetRtcLivekitTokenRequest {
                    server_name: "x".into(),
                    url: "u".into(),
                    room_id: ROOM.into(),
                    slot_id: "s".into(),
                    member_id: "m".into(),
                },
            },
            WidgetRequest::GetMatrixContext,
            WidgetRequest::GetClientContext,
        ]
    };
    let capabilities = vec![
        Capability::GetRtcTransports,
        Capability::SearchUserDirectory,
        Capability::GetMediaConfig,
        Capability::read_room_account_data("m.tag"),
        Capability::GetRtcLivekitToken,
        Capability::GetMatrixContext,
        Capability::GetClientContext,
    ];
    for (request, capability) in requests().into_iter().zip(&capabilities) {
        let error = reply(&driver, &platform, request).error().unwrap();
        assert_eq!(error.message, format!("Missing capability: {capability}"));
    }

    grant(&driver, &platform, capabilities);
    let responses: Vec<WidgetResponse> =
        requests().into_iter().map(|r| WidgetResponse::from_wire(&reply(&driver, &platform, r)).unwrap()).collect();
    assert_eq!(
        responses[0],
        WidgetResponse::GetRtcTransports {
            response: RtcTransportsResponse { rtc_transports: vec![json!({"type": "livekit"}).into()] }
        }
    );
    let WidgetResponse::SearchUserDirectory { response } = &responses[1] else { panic!() };
    assert_eq!(response.results[0].user_id, "@alice:x");
    assert!(matches!(&responses[2], WidgetResponse::GetMediaConfig { response } if response.upload_size.is_some()));
    let WidgetResponse::ReadRoomAccountData { response } = &responses[3] else { panic!() };
    assert_eq!(response.events[0].event_type, "m.tag");
    assert_eq!(
        responses[4],
        WidgetResponse::GetRtcLivekitToken { response: GetRtcLivekitTokenResponse { jwt: "livekit-jwt-s-m".into() } }
    );
    assert_eq!(
        responses[5],
        WidgetResponse::GetMatrixContext {
            response: GetMatrixContextResponse {
                user_id: "@me:x".into(),
                device_id: "WIDGETTEST".into(),
                room_id: ROOM.into(),
                display_name: "@me:x".into(),
                avatar_url: String::new(),
                matrix_base_url: "https://matrix.example.org".into(),
            }
        }
    );
    assert_eq!(
        responses[6],
        WidgetResponse::GetClientContext {
            response: GetClientContextResponse {
                client_id: Some("test-client".into()),
                client_theme: Some("dark".into()),
                client_language: None
            }
        }
    );

    // Account data of another type is still refused. `room_ids`: `*` and the own room are the
    // widget's room; another room cannot be read.
    assert!(reply(&driver, &platform, account_data("m.other", None)).error().is_some());
    assert!(reply(&driver, &platform, account_data("m.tag", Some(RoomSelector::Any))).error().is_none());
    let own = RoomSelector::Rooms { room_ids: vec![ROOM.into()] };
    assert!(reply(&driver, &platform, account_data("m.tag", Some(own))).error().is_none());
    let both = RoomSelector::Rooms { room_ids: vec![ROOM.into(), "!other:x".into()] };
    let error = reply(&driver, &platform, account_data("m.tag", Some(both))).error().unwrap();
    assert!(error.message.contains("its own room"));
}

#[test]
fn upload_and_download_files() {
    let (driver, backend, platform) = setup();
    let upload =
        |file: Base64File| reply(&driver, &platform, WidgetRequest::UploadFile { request: UploadFileRequest { file } });
    let download = |content_uri: &str| {
        let request = DownloadFileRequest { content_uri: content_uri.into() };
        reply(&driver, &platform, WidgetRequest::DownloadFile { request })
    };
    let hello = Base64File::from_bytes(b"hello", Some("text/plain".into()));

    // Each direction needs its own capability.
    assert!(upload(hello.clone()).error().unwrap().message.contains("widget:org.matrix.msc4039.upload_file"));
    assert!(download("mxc://x/y").error().unwrap().message.contains("widget:org.matrix.msc4039.download_file"));
    grant(&driver, &platform, vec![Capability::UploadFile, Capability::DownloadFile]);

    // The backend gets raw bytes, the widget the same base64 back.
    let content_uri = response!(UploadFile, upload(hello.clone())).content_uri;
    let stored = futures::executor::block_on(backend.download_media(content_uri.clone())).unwrap();
    assert_eq!(stored, MediaFile { data: b"hello".to_vec(), mimetype: Some("text/plain".into()) });
    assert_eq!(response!(DownloadFile, download(&content_uri)), DownloadFileResponse { file: hello });

    let broken = Base64File { mimetype: None, base64: "%%%".into() };
    assert!(upload(broken).error().unwrap().message.contains("Invalid base64"));
    assert!(download("mxc://x/missing").error().unwrap().message.contains("Failed to download"));
    backend.fail_sends(Some("full".into()));
    assert!(upload(Base64File::from_bytes(b"x", None)).error().unwrap().message.contains("Failed to upload"));
}

#[test]
fn platform_actions_and_pushes() {
    let (driver, _, platform) = setup();
    let go = |uri: &str| reply(&driver, &platform, navigate(uri));
    assert!(go("https://matrix.to/#/#a:x").error().unwrap().message.contains("widget:org.matrix.msc2931.navigate"));
    grant(&driver, &platform, vec![Capability::Navigate, Capability::SetAlwaysOnScreen]);
    assert!(go("https://example.org").error().unwrap().message.contains("Invalid matrix.to URI"));
    assert!(go("https://matrix.to/#/broken").error().unwrap().message.contains("no such room"));
    assert_eq!(WidgetResponse::from_wire(&go("https://matrix.to/#/#a:x")).unwrap(), WidgetResponse::Navigate);
    assert_eq!(platform.navigated.lock().unwrap().as_slice(), &["https://matrix.to/#/#a:x".to_string()]);

    let on_screen = WidgetRequest::SetAlwaysOnScreen { request: SetAlwaysOnScreenRequest { value: true } };
    assert_eq!(
        response!(SetAlwaysOnScreen, reply(&driver, &platform, on_screen)),
        SetAlwaysOnScreenResponse { success: true }
    );
    assert_eq!(*platform.always_on_screen.lock().unwrap(), Some(true));

    // Pushes from the client are subscriptions: without the capability nothing is sent.
    let push_all = || {
        driver.update_theme(json!({"name": "dark"}).into());
        driver.update_language("de".into());
        driver.update_visibility(false);
        platform.drain()
    };
    assert!(push_all().is_empty());
    // Each push has its own capability.
    grant(&driver, &platform, vec![Capability::UpdateLanguage]);
    assert_eq!(actions(&push_all()), ["update_language"]);

    // With all three they go out and are acknowledged by the widget.
    grant(&driver, &platform, vec![Capability::UpdateTheme, Capability::UpdateVisibility]);
    let sent = push_all();
    assert_eq!(actions(&sent), ["update_theme", "update_language", "update_visibility"]);
    assert_eq!(sent[0].request_body()["name"], "dark");
    assert_eq!(sent[1].request_body()["lang"], "de");
    assert_eq!(sent[2].request_body()["visible"], false);
    for msg in &sent {
        handle(&driver, &msg.ack()).unwrap();
    }
}

#[test]
fn to_device_both_directions() {
    let (driver, backend, platform) = setup();
    let messages =
        HashMap::from([("@a:x".to_string(), HashMap::from([("DEV".to_string(), JsonValue::from(json!({"n": 1})))]))]);
    let request = SendToDeviceRequest { event_type: "org.example.ping".into(), encrypted: true, messages };
    let send_ping = || reply(&driver, &platform, WidgetRequest::SendToDevice { request: request.clone() });
    let error = send_ping().error().unwrap();
    assert!(error.message.contains("widget:org.matrix.mscXXXX.send_to_device:org.example.ping"));

    grant(
        &driver,
        &platform,
        vec![Capability::send_to_device("org.example.ping"), Capability::forward_to_device("org.example.ping")],
    );
    assert_eq!(WidgetResponse::from_wire(&send_ping()).unwrap(), WidgetResponse::SendToDevice);
    let sent = backend.to_device_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!((sent[0].user_id.as_str(), sent[0].device_id.as_str()), ("@a:x", "DEV"));
    assert!(sent[0].encrypted);

    // Incoming: only permitted types reach the widget.
    let ping = ToDeviceEvent {
        event_type: "org.example.ping".into(),
        sender: "@other:x".into(),
        content: json!({"n": 2}).into(),
        encrypted: false,
    };
    backend.inject_to_device(ToDeviceEvent { event_type: "org.example.other".into(), ..ping.clone() });
    assert!(platform.drain().is_empty());
    backend.inject_to_device(ping.clone());
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    assert_eq!(HostRequest::from_wire(&sent[0]).unwrap(), HostRequest::ForwardToDevice { message: ping });
    handle(&driver, &sent[0].ack()).unwrap();
}

#[test]
fn initial_state_and_changes_reach_the_widget() {
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t1"})));
    backend.inject(event("m.room.name", Some(""), json!({"name": "n"})));
    backend.inject(event("m.room.message", None, json!({"body": "old"})));
    let state_of = |msg: &WireMessage| msg.request_body()["state"].as_array().unwrap().clone();

    // Approval delivers the current state the widget may see, synchronously (the in-memory
    // backend calls the sink from inside `subscribe_room`), right after `update_capabilities`.
    let sent = grant(
        &driver,
        &platform,
        vec![
            Capability::update_state("m.room.topic", None::<&str>),
            Capability::forward_state_event("m.room.topic", None::<&str>),
            Capability::forward_event("m.room.message"),
        ],
    );
    assert_eq!(actions(&sent), ["update_state"]);
    let state = state_of(&sent[0]);
    assert_eq!(state.len(), 1);
    assert_eq!(state[0]["content"]["topic"], "t1");

    // A changed topic: forwarded as a timeline event (`forward_event.state`) and as the new state
    // set (`update_state`).
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t2"})));
    let sent = platform.drain();
    assert_eq!(actions(&sent), ["forward_event", "update_state"]);
    assert_eq!(sent[0].source, Source::Host);
    assert_eq!(sent[0].request_body()["content"]["topic"], "t2");
    let state = state_of(&sent[1]);
    assert_eq!(state.len(), 1);
    assert_eq!(state[0]["content"]["topic"], "t2");

    // Types without a capability are dropped.
    backend.inject(event("m.room.name", Some(""), json!({"name": "n2"})));
    backend.inject(event("m.reaction", None, json!({})));
    assert!(platform.drain().is_empty());

    // A timeline event only.
    backend.inject(event("m.room.message", None, json!({"body": "x"})));
    let sent = platform.drain();
    assert_eq!(actions(&sent), ["forward_event"]);
    assert_eq!(sent[0].request_body()["content"]["body"], "x");

    // Emptied state is not pushed as an empty `update_state`.
    backend.clear();
    assert!(platform.drain().is_empty());
}

#[test]
fn state_key_capability_filters_the_set() {
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.member", Some("@me:x"), json!({"membership": "join"})));
    backend.inject(event("m.room.member", Some("@other:x"), json!({"membership": "join"})));
    let state_keys = |sent: &[WireMessage]| -> Vec<Value> {
        assert_eq!(actions(sent), ["update_state"]);
        sent[0].request_body()["state"].as_array().unwrap().iter().map(|e| e["state_key"].clone()).collect()
    };
    let sent = grant(&driver, &platform, vec![Capability::update_state("m.room.member", Some("@me:x"))]);
    assert_eq!(state_keys(&sent), [json!("@me:x")]);

    // The other member changing: the full set is delivered again, still filtered to `@me:x`
    // and never as `forward_event` (no `forward_event.state` capability).
    backend.inject(event("m.room.member", Some("@other:x"), json!({"membership": "leave"})));
    assert_eq!(state_keys(&platform.drain()), [json!("@me:x")]);
}

#[test]
fn update_state_and_forward_event_state_are_separate() {
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t1"})));

    // `forward_event.state` only: no initial state, but changes arrive as timeline events.
    let sent = grant(&driver, &platform, vec![Capability::forward_state_event("m.room.topic", Some(""))]);
    assert!(sent.is_empty());
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t2"})));
    assert_eq!(actions(&platform.drain()), ["forward_event"]);
    // Another state key of the same type is not forwarded.
    backend.inject(event("m.room.topic", Some("other"), json!({"topic": "x"})));
    assert!(platform.drain().is_empty());
}

#[test]
fn legacy_capability_strings_grant_nothing() {
    let (driver, backend, platform) = setup();
    let legacy = [
        "org.matrix.msc2762.send.event:m.room.message",
        "m.send.event:m.room.message",
        "org.matrix.msc2762.receive.event:m.room.message",
        "org.matrix.msc2762.receive.state_event:m.room.topic",
        "org.matrix.msc2931.navigate",
        "m.always_on_screen",
    ];
    // They are negotiated like any unknown string and echoed back unchanged ...
    let caps: Vec<Capability> = legacy.iter().map(|raw| Capability::parse(raw)).collect();
    request_caps(&driver, caps.clone(), "legacy");
    driver.approve_capabilities(caps);
    assert_eq!(platform.drain().pop().unwrap().request_body()["allowed"], json!(legacy));

    // ... but allow nothing: only the compat wrapper translates them.
    let message = SendEventRequest::room_event("m.room.message", json!({"body": "hi"}).into());
    assert!(send(&driver, &platform, message).error().is_some());
    assert!(backend.timeline().is_empty());
    assert!(backend.room_subscriptions().is_empty());
    assert!(reply(&driver, &platform, navigate("https://matrix.to/#/#a:x")).error().is_some());
}

#[test]
fn protocol_errors() {
    let (driver, _, platform) = setup();
    let raw = |json: String| futures::executor::block_on(driver.handle_message_from_widget(json));
    assert!(matches!(raw("not json".into()), Err(DriverError::NotAWidgetMessage { .. })));
    // Legacy messages have `api` instead of `source`.
    let legacy =
        json!({"api": "fromWidget", "widgetId": "w", "action": "content_loaded", "requestId": "1", "data": {}});
    assert_eq!(raw(legacy.to_string()), Err(DriverError::LegacyWidgetApi));
    let no_id = json!({"source": "widget", "action": "x", "requestId": "1", "request": {}});
    assert!(matches!(raw(no_id.to_string()), Err(DriverError::NotAWidgetMessage { .. })));
    let host_request = HostRequest::ForwardEvent { event: event("m.x", None, json!({})) }.into_wire("h");
    assert!(matches!(handle(&driver, &host_request), Err(DriverError::WrongDirection { .. })));
    assert!(platform.drain().is_empty());

    // An unknown action and a malformed body get error *responses*, not driver errors.
    handle(&driver, &WireMessage::request(Source::Widget, "org.example.nope", "u", json!({}))).unwrap();
    handle(&driver, &WireMessage::request(Source::Widget, "m.send_event", "b", json!({"type": 5}))).unwrap();
    let sent = platform.drain();
    assert_eq!(sent.len(), 2);
    assert!(sent[0].error().unwrap().message.contains("Unknown action"));
    assert_eq!(sent[0].error().unwrap().kind(), ErrorKind::UnknownAction);
    assert!(sent[1].error().unwrap().message.contains("Invalid request body"));
    assert_eq!(sent[1].error().unwrap().code, "org.matrix.msc4412.invalid_request");

    // An action name without a namespace is unknown, like the pre-MSC4412 names.
    for action in ["send_event", "content_loaded", "request_capabilities"] {
        handle(&driver, &WireMessage::request(Source::Widget, action, "o", json!({}))).unwrap();
        assert_eq!(platform.drain()[0].error().unwrap().kind(), ErrorKind::UnknownAction, "{action}");
    }
}

#[test]
fn nothing_is_sent_before_the_widget_spoke() {
    let (driver, _, platform) = setup();
    driver.revoke_capabilities(vec![Capability::Navigate]);
    driver.update_language("de".into());
    assert!(platform.drain().is_empty());

    grant(&driver, &platform, vec![Capability::UpdateLanguage]);
    driver.update_language("de".into());
    assert_eq!(actions(&platform.drain()), ["update_language"]);
}

#[test]
fn revoking_capabilities() {
    let (driver, backend, platform) = setup();
    let message = || SendEventRequest::room_event("m.room.message", json!({"body": "hi"}).into());
    let (send_message, forward_message) =
        (Capability::send_event("m.room.message"), Capability::forward_event("m.room.message"));
    grant(&driver, &platform, vec![send_message.clone(), forward_message.clone(), Capability::Navigate]);
    assert!(send(&driver, &platform, message()).error().is_none());
    assert_eq!(backend.room_subscriptions().len(), 1);

    // Revoking what the widget does not hold changes nothing and sends nothing.
    driver.revoke_capabilities(vec![Capability::UploadFile]);
    assert!(platform.drain().is_empty());

    // The widget is told the full remaining list ...
    driver.revoke_capabilities(vec![send_message.clone(), forward_message]);
    assert_eq!(updates(&platform.drain()), [vec![Capability::Navigate]]);
    assert_eq!(driver.snapshot().approved, vec![Capability::Navigate]);
    // ... its requests fail, and the host stops forwarding.
    assert_eq!(send(&driver, &platform, message()).error().unwrap().kind(), ErrorKind::MissingCapability);
    backend.inject(event("m.room.message", None, json!({"body": "x"})));
    assert!(platform.drain().is_empty());

    // Asking again goes through the platform again.
    grant(&driver, &platform, vec![send_message]);
    assert!(send(&driver, &platform, message()).error().is_none());
}

#[test]
fn requests_while_one_is_pending_add_up() {
    let (driver, _, platform) = setup();
    let (a1, a2, b1) = (Capability::Navigate, Capability::UploadFile, Capability::DownloadFile);
    request_caps(&driver, vec![a1.clone(), a2.clone()], "a");
    // The second request joins the open question; the platform is asked about all of it (not
    // only about the second request, which would drop the first one from the prompt).
    request_caps(&driver, vec![b1.clone(), a1.clone()], "b");
    assert_eq!(driver.snapshot().pending_requested, vec![a1.clone(), a2.clone(), b1.clone()]);
    assert_eq!(platform.asked(), [vec![a1.clone(), a2.clone()], vec![a1.clone(), a2.clone(), b1.clone()]]);
    // A request that adds nothing to decide does not ask again.
    request_caps(&driver, vec![a2.clone()], "c");
    assert_eq!(platform.asked().len(), 2);
    // Every request is acked at once, but nothing is answered before the platform decides.
    let sent = platform.drain();
    assert_eq!(sent.iter().map(|m| m.request_id.as_str()).collect::<Vec<_>>(), ["a", "b", "c"]);
    assert!(updates(&sent).is_empty());

    // One answer for all of them: A2 is denied.
    driver.approve_capabilities(vec![a1.clone(), b1.clone()]);
    assert_eq!(updates(&platform.drain()), [vec![a1, b1]]);
    assert!(driver.snapshot().pending_requested.is_empty());
}

#[test]
fn a_request_while_a_question_is_open_never_completes_it() {
    let (driver, _, platform) = setup();
    driver.set_auto_approved(vec![Capability::GetMatrixContext]);
    request_caps(&driver, vec![Capability::Navigate], "a");
    // Only auto-approved: without an open question this would complete at once. Here it waits
    // for the answer to the open question, which would otherwise be closed unanswered.
    request_caps(&driver, vec![Capability::GetMatrixContext], "b");
    assert!(updates(&platform.drain()).is_empty());
    assert_eq!(platform.asked(), [vec![Capability::Navigate]]);
    assert_eq!(driver.snapshot().pending_requested, vec![Capability::Navigate, Capability::GetMatrixContext]);

    driver.approve_capabilities(vec![Capability::Navigate]);
    assert_eq!(updates(&platform.drain()), [vec![Capability::Navigate, Capability::GetMatrixContext]]);
}

#[test]
fn held_capabilities_are_not_asked_again() {
    let (driver, _, platform) = setup();
    grant(&driver, &platform, vec![Capability::Navigate]);
    platform.forget_asked();

    // Asked only about what the widget does not hold yet; the answer keeps what it holds.
    request_caps(&driver, vec![Capability::Navigate, Capability::UploadFile], "a");
    assert_eq!(platform.asked(), [vec![Capability::UploadFile]]);
    driver.approve_capabilities(vec![]);
    assert_eq!(updates(&platform.drain()), [vec![Capability::Navigate]]);

    // Nothing to decide: answered at once (after the ack), the platform is not asked.
    request_caps(&driver, vec![Capability::Navigate], "b");
    let sent = platform.drain();
    assert_eq!(sent[0].request_id, "b");
    assert_eq!(updates(&sent), [vec![Capability::Navigate]]);
    assert_eq!(platform.asked().len(), 1);
}

#[test]
fn a_capability_revoked_while_a_question_is_open_is_only_granted_if_the_answer_approves_it() {
    let (driver, _, platform) = setup();
    grant(&driver, &platform, vec![Capability::Navigate]);
    platform.forget_asked();
    request_caps(&driver, vec![Capability::Navigate, Capability::UploadFile], "a");
    assert_eq!(platform.asked(), [vec![Capability::UploadFile]]);

    // Revoked before the answer: the open question holds it again, but the platform was not asked
    // about it, and an answer that approves only what was asked does not grant it.
    driver.revoke_capabilities(vec![Capability::Navigate]);
    assert_eq!(driver.snapshot().pending_requested, vec![Capability::Navigate, Capability::UploadFile]);
    assert_eq!(platform.asked().len(), 1);
    platform.drain();
    driver.approve_capabilities(vec![Capability::UploadFile]);
    assert_eq!(updates(&platform.drain()), [vec![Capability::UploadFile]]);
}

#[test]
fn auto_approved_capabilities_skip_the_platform() {
    let (driver, _, platform) = setup();
    driver.set_auto_approved(vec![Capability::GetMatrixContext, Capability::GetClientContext]);
    assert_eq!(driver.snapshot().auto_approved.len(), 2);

    // Only auto-approved capabilities: granted at once (after the ack), platform never asked.
    request_caps(&driver, vec![Capability::GetMatrixContext], "a1");
    let sent = platform.drain();
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].request_id, "a1");
    assert_eq!(updates(&sent), [vec![Capability::GetMatrixContext]]);
    assert!(platform.asked().is_empty());

    // Mixed: the platform is asked only about the rest, auto-approved ones are added.
    let message = Capability::send_event("m.room.message");
    request_caps(&driver, vec![Capability::GetClientContext, message.clone()], "a2");
    assert_eq!(platform.asked(), [vec![message.clone()]]);
    driver.approve_capabilities(vec![message.clone()]);
    assert_eq!(updates(&platform.drain()), [vec![Capability::GetMatrixContext, Capability::GetClientContext, message]]);
}

// ---- webview capabilities (`spec/patch/new/webview-capabilities.md`) ---------------------------

#[test]
fn base_webview_capabilities_are_granted_without_asking() {
    let (driver, _, platform) = setup();
    let base = vec![Capability::webview_sandbox("allow-scripts"), Capability::webview_sandbox("allow-same-origin")];
    request_caps(&driver, base.clone(), "w1");
    // Nothing to decide: answered at once, the platform is not asked.
    assert!(platform.asked().is_empty());
    assert_eq!(updates(&platform.drain()), std::slice::from_ref(&base));

    // Together with something to decide: granted whatever the answer says.
    let camera = Capability::webview_allow("camera");
    let popups = Capability::webview_sandbox("allow-popups");
    driver.revoke_capabilities(base.clone());
    platform.drain();
    request_caps(&driver, [base.clone(), vec![camera.clone(), popups.clone()]].concat(), "w2");
    assert_eq!(platform.asked(), [vec![camera.clone(), popups]]);
    driver.approve_capabilities(vec![camera.clone()]);
    assert_eq!(updates(&platform.drain()), [[base, vec![camera]].concat()]);
}

#[test]
fn top_navigation_is_never_asked_about_nor_granted() {
    let (driver, _, platform) = setup();
    let camera = Capability::webview_allow("camera");
    let never: Vec<_> =
        ["allow-top-navigation", "allow-top-navigation-by-user-activation", "allow-top-navigation-to-custom-protocols"]
            .into_iter()
            .map(Capability::webview_sandbox)
            .collect();
    // Not even auto-approval grants it.
    driver.set_auto_approved(never.clone());
    request_caps(&driver, [never.clone(), vec![camera.clone()]].concat(), "w1");
    assert_eq!(platform.asked(), [vec![camera.clone()]]);
    // Not even an answer that approves it.
    driver.approve_capabilities([never.clone(), vec![camera.clone()]].concat());
    assert_eq!(updates(&platform.drain()), [vec![camera.clone()]]);

    // A request of nothing else completes at once, with nothing new.
    // (The camera loaded the iframe again: the page in it holds nothing yet.)
    request_caps(&driver, never, "w2");
    assert_eq!(platform.asked().len(), 1);
    assert_eq!(updates(&platform.drain()), [Vec::<Capability>::new()]);
    assert_eq!(driver.snapshot().carried, [camera]);
}

#[test]
fn other_webview_capabilities_are_asked_about_and_can_be_auto_approved() {
    let (driver, _, platform) = setup();
    let (camera, microphone) = (Capability::webview_allow("camera"), Capability::webview_allow("microphone"));
    // What the widget's iframe was built with: granted at once when the widget requests it.
    driver.set_auto_approved(vec![camera.clone()]);
    request_caps(&driver, vec![camera.clone(), microphone.clone()], "w1");
    assert_eq!(platform.asked(), [vec![microphone.clone()]]);
    driver.approve_capabilities(vec![]);
    assert_eq!(updates(&platform.drain()), [vec![camera.clone()]]);
    assert_eq!(driver.snapshot().approved, std::slice::from_ref(&camera));
    // It allows no action.
    assert_eq!(
        reply(&driver, &platform, navigate("https://matrix.to/#/#a:b")).error().unwrap().kind(),
        ErrorKind::MissingCapability
    );

    // No request needs one, so none is single use.
    driver.set_single_use(vec![camera.clone(), Capability::GetOpenId]);
    assert_eq!(driver.snapshot().single_use, [Capability::GetOpenId]);

    // Revoked like any other.
    driver.revoke_capabilities(vec![camera]);
    assert_eq!(updates(&platform.drain()), [vec![]]);
}

// ---------------------------------------------------------------------------------------------
// The widget's iframe: what the platform is told to load, and when it is loaded again.

#[test]
fn start_loads_the_strict_iframe() {
    let (driver, _, platform) = setup();
    let strict = WidgetIframe {
        url: "https://widget.example/app".into(),
        origin: "https://widget.example".into(),
        sandbox: STRICT.into(),
        allow: String::new(),
    };
    assert_eq!(platform.loaded(), std::slice::from_ref(&strict));
    assert_eq!(driver.snapshot().iframe, strict);
    // A widget with the widget API is ready when it says so.
    assert!(!platform.is_ready());
    // Once.
    driver.start();
    assert_eq!(platform.loaded().len(), 1);
}

#[test]
fn nothing_is_loaded_before_start() {
    let (driver, _, platform) = setup_for(widget("m.widget", true));
    assert!(platform.loaded().is_empty());
    // What the client remembers is part of the first iframe, requested or not.
    driver.set_auto_approved(vec![Capability::webview_allow("camera"), Capability::Navigate]);
    assert!(platform.loaded().is_empty());
    assert_eq!(driver.snapshot().iframe.allow, "camera 'src'");
    driver.start();
    let [iframe] = &platform.loaded()[..] else { panic!("{:?}", platform.loaded()) };
    assert_eq!((iframe.sandbox.as_str(), iframe.allow.as_str()), (STRICT, "camera 'src'"));
    // The widget's request for it is granted at once: no question, no second iframe.
    request_caps(&driver, vec![Capability::webview_allow("camera")], "req");
    assert!(platform.asked().is_empty());
    assert_eq!(updates(&platform.drain()), [vec![Capability::webview_allow("camera")]]);
    assert_eq!(platform.loaded().len(), 1);
}

#[test]
fn a_widget_that_must_not_be_loaded_gets_no_driver() {
    let backend = InMemoryBackend::new(ROOM.into(), "@me:x".into());
    let platform = Arc::new(RecordingPlatform::default());
    let content = json!({ "name": "W", "url": "javascript:alert(1)" });
    let refused = WidgetDefinition::parse("m.widget", "w", &content).unwrap();
    let error = WidgetHostDriver::new(refused.clone(), EmbedOptions::default(), backend.clone(), platform.clone())
        .err()
        .unwrap();
    assert_eq!(
        error,
        WidgetEventError::Refused { widget: refused, reason: "javascript: URLs are not allowed, only https:".into() }
    );
    // A legacy widget of a client without a compat wrapper.
    let legacy = widget("im.vector.modular.widgets", false);
    let error = WidgetHostDriver::new(legacy, EmbedOptions::default(), backend, platform).err().unwrap();
    assert_eq!(error.to_string(), "a legacy widget needs the compat wrapper");
}

#[test]
fn a_widget_without_the_widget_api_is_ready_at_once_and_gets_no_answer() {
    let (driver, _, platform) = setup_for(widget("m.widget", false));
    assert!(!platform.is_ready());
    driver.start();
    assert_eq!(platform.loaded().len(), 1);
    assert!(platform.is_ready());
    assert!(!driver.snapshot().ready, "it never said notify_ready");

    assert_eq!(feed(&driver, WidgetRequest::NotifyReady, "c1"), Err(DriverError::NoWidgetApi));
    let request = RequestCapabilitiesRequest { capabilities: vec![Capability::Navigate] };
    assert_eq!(feed(&driver, WidgetRequest::RequestCapabilities { request }, "req"), Err(DriverError::NoWidgetApi));
    assert!(platform.drain().is_empty());
    assert!(platform.asked().is_empty());
    assert!(driver.snapshot().pending_requested.is_empty());
}

#[test]
fn a_legacy_widget_runs_in_the_compat_wrapper_with_a_legacy_clients_iframe() {
    let (driver, _, platform) = setup_for(widget("im.vector.modular.widgets", false));
    driver.start();
    let iframe = platform.loaded().pop().unwrap();
    assert!(iframe.url.starts_with("https://client.example/wrapper/?legacy_widget_url="), "{}", iframe.url);
    assert_eq!(iframe.origin, "https://client.example");
    assert_eq!(
        iframe.sandbox,
        "allow-scripts allow-same-origin allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox \
         allow-presentation"
    );
    assert!(iframe.allow.starts_with("autoplay 'src'; camera 'src'; "), "{}", iframe.allow);
    // The compat wrapper speaks the widget API: ready when it says so.
    assert!(!platform.is_ready());

    // What the wrapper requests when it starts is granted at once: no question, no second iframe.
    request_caps(&driver, legacy_auto_approved(), "req");
    assert!(platform.asked().is_empty());
    assert_eq!(updates(&platform.drain()), [legacy_auto_approved()]);
    assert_eq!(platform.loaded().len(), 1);
    // An OpenID token is asked about, as for every widget.
    request_caps(&driver, vec![Capability::GetOpenId], "req");
    assert_eq!(platform.asked(), [vec![Capability::GetOpenId]]);
}

#[test]
fn a_granted_webview_capability_loads_the_iframe_again() {
    let (driver, backend, platform) = setup();
    let camera = Capability::webview_allow("camera");
    let forward = Capability::forward_event("m.room.message");
    feed(&driver, WidgetRequest::NotifyReady, "ready").unwrap();
    platform.ready.store(false, Ordering::SeqCst);
    request_caps(&driver, vec![camera.clone(), forward.clone(), Capability::GetOpenId], "req");
    platform.drain();
    driver.approve_capabilities(vec![camera.clone(), forward.clone(), Capability::GetOpenId]);

    // The old page is told what it holds, then the iframe is loaded again with the new attributes.
    assert_eq!(updates(&platform.drain()), [vec![camera.clone(), forward.clone(), Capability::GetOpenId]]);
    let iframes = platform.loaded();
    assert_eq!(iframes.len(), 2);
    assert_eq!((iframes[1].sandbox.as_str(), iframes[1].allow.as_str()), (STRICT, "camera 'src'"));
    assert_eq!(iframes[1].url, iframes[0].url);

    // The driver has forgotten the old page; what it held is carried, but not a single-use capability.
    let snapshot = driver.snapshot();
    assert!(!snapshot.ready && snapshot.approved.is_empty() && snapshot.pending_requested.is_empty());
    assert_eq!(snapshot.carried, [camera.clone(), forward.clone()]);
    assert_eq!(snapshot.iframe, iframes[1]);
    // Nothing is forwarded to a page that has not spoken yet.
    backend.inject(event("m.room.message", None, json!({ "body": "hi" })));
    assert!(platform.drain().is_empty());

    // The new page starts over: it is ready when it says so, and gets what the old one held without a question.
    feed(&driver, WidgetRequest::NotifyReady, "ready").unwrap();
    assert!(platform.is_ready() && driver.snapshot().ready);
    platform.drain();
    platform.forget_asked();
    request_caps(&driver, vec![camera.clone(), forward.clone()], "req");
    assert!(platform.asked().is_empty());
    assert_eq!(updates(&platform.drain()), [vec![camera.clone(), forward.clone()]]);
    assert_eq!(platform.loaded().len(), 2, "no reload for what the iframe has already");
    // The OpenID token is asked about again.
    request_caps(&driver, vec![Capability::GetOpenId], "req");
    assert_eq!(platform.asked(), [vec![Capability::GetOpenId]]);
    driver.approve_capabilities(vec![]);
    platform.drain();

    // Revoking it loads the iframe again, without it; the rest is carried on.
    driver.revoke_capabilities(vec![camera.clone()]);
    assert_eq!(updates(&platform.drain()), [vec![forward.clone()]]);
    let iframes = platform.loaded();
    assert_eq!(iframes.len(), 3);
    assert_eq!((iframes[2].sandbox.as_str(), iframes[2].allow.as_str()), (STRICT, ""));
    assert_eq!(driver.snapshot().carried, std::slice::from_ref(&forward));
    // The next page is asked about the camera again.
    request_caps(&driver, vec![camera.clone(), forward], "req");
    assert_eq!(platform.asked(), [vec![Capability::GetOpenId], vec![camera]]);
}

#[test]
fn what_does_not_change_the_attributes_loads_nothing() {
    let (driver, _, platform) = setup();
    // The base tokens are in every iframe; a denied capability changes nothing; the two spellings are one capability.
    request_caps(
        &driver,
        vec![
            Capability::webview_sandbox("allow-scripts"),
            Capability::webview_allow("camera"),
            Capability::webview_sandbox("allow-top-navigation"),
            Capability::Navigate,
        ],
        "req",
    );
    driver.approve_capabilities(vec![Capability::Navigate, Capability::webview_sandbox("allow-top-navigation")]);
    assert_eq!(updates(&platform.drain()), [vec![Capability::webview_sandbox("allow-scripts"), Capability::Navigate]]);
    assert_eq!(platform.loaded().len(), 1);
    driver.revoke_capabilities(vec![Capability::Navigate]);
    assert_eq!(platform.loaded().len(), 1);
    assert!(driver.snapshot().carried.is_empty());

    // Granted without asking from now on, in the stable spelling: part of the iframe at once.
    driver.set_auto_approved(vec![Capability::parse("webview:m.allow:camera")]);
    assert_eq!(platform.loaded().len(), 2);
    assert_eq!(platform.loaded()[1].allow, "camera 'src'");
    driver.set_auto_approved(vec![Capability::parse("webview:org.matrix.mscXXXX.allow:camera")]);
    assert_eq!(platform.loaded().len(), 2);
    // And no longer.
    driver.set_auto_approved(vec![]);
    assert_eq!(platform.loaded().len(), 3);
    assert_eq!(platform.loaded()[2].allow, "");
}
