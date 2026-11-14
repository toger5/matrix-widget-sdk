//! The driver end to end: widget messages in, replies and backend effects out. The backend is an
//! `InMemoryBackend`; the platform records everything it is told.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use serde_json::{json, Value};
use widget_actions::{
    Base64File, Capability, DownloadFileRequest, DownloadFileResponse, ForwardOpenIdCredentialsRequest,
    GetClientContextResponse, GetMatrixContextResponse, GetOpenIdResponse, GetRtcLivekitTokenResponse, HostRequest,
    JsonValue, MatrixEvent, NotifyCapabilitiesRequest, ReadEventsRequest, ReadRelationsRequest,
    ReadRoomAccountDataRequest, RequestCapabilitiesRequest, RoomSelector, RtcTransportsResponse, SendEventRequest,
    SendToDeviceRequest, SetAlwaysOnScreenResponse, Source, StateKeySelector, ToDeviceEvent, TurnServer,
    UpdateDelayedEventAction, UploadFileRequest, WidgetRequest, WidgetResponse, WireMessage,
};
use widget_matrix_backend::{BackendError, InMemoryBackend, MatrixBackend, MediaFile};

use crate::{DriverError, PlatformError, WidgetHostDriver, WidgetHostPlatform};

#[derive(Default)]
struct RecordingPlatform {
    sent: Mutex<Vec<WireMessage>>,
    requested: Mutex<Vec<Vec<Capability>>>,
    loaded: AtomicBool,
    openid_requests: AtomicUsize,
    navigated: Mutex<Vec<String>>,
    always_on_screen: Mutex<Option<bool>>,
}

impl RecordingPlatform {
    fn drain(&self) -> Vec<WireMessage> {
        std::mem::take(&mut *self.sent.lock().unwrap())
    }
}

impl WidgetHostPlatform for RecordingPlatform {
    fn send_to_widget(&self, json: String) {
        self.sent.lock().unwrap().push(WireMessage::from_json(&json).unwrap());
    }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) {
        self.requested.lock().unwrap().push(requested);
    }
    fn on_content_loaded(&self) {
        self.loaded.store(true, Ordering::SeqCst);
    }
    fn on_openid_requested(&self) {
        self.openid_requests.fetch_add(1, Ordering::SeqCst);
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

fn setup() -> (Arc<WidgetHostDriver>, Arc<InMemoryBackend>, Arc<RecordingPlatform>) {
    let backend = InMemoryBackend::new("!room:x".into(), "@me:x".into());
    let platform = Arc::new(RecordingPlatform::default());
    let driver = WidgetHostDriver::new(backend.clone(), platform.clone());
    (driver, backend, platform)
}

fn block<F: std::future::Future>(f: F) -> F::Output {
    futures::executor::block_on(f)
}

async fn feed(driver: &WidgetHostDriver, req: WidgetRequest, id: &str) -> Result<(), DriverError> {
    driver.handle_message_from_widget(req.into_wire(id).to_json()).await
}

fn event(event_type: &str, state_key: Option<&str>, content: Value) -> MatrixEvent {
    MatrixEvent {
        event_type: event_type.into(),
        sender: "@other:x".into(),
        event_id: "$in".into(),
        room_id: "!room:x".into(),
        origin_server_ts: 5,
        state_key: state_key.map(Into::into),
        content: content.into(),
        unsigned: None,
    }
}

#[test]
fn content_loaded_is_acked_and_reported() {
    let (driver, _, platform) = setup();
    block(feed(&driver, WidgetRequest::ContentLoaded, "c1")).unwrap();
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].request_id, "c1");
    assert_eq!(sent[0].source, Source::Widget);
    assert_eq!(sent[0].response_body(), json!({}));
    assert!(platform.loaded.load(Ordering::SeqCst));
    assert!(driver.snapshot().content_loaded);
}

#[test]
fn capability_negotiation() {
    let (driver, _, platform) = setup();
    let caps = vec![Capability::send_event("m.room.message"), Capability::forward_event("m.room.message")];
    block(feed(
        &driver,
        WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
        "cap1",
    ))
    .unwrap();

    // Immediate ack, platform asked.
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].request_id, "cap1");
    assert_eq!(platform.requested.lock().unwrap().as_slice(), std::slice::from_ref(&caps));
    assert_eq!(driver.snapshot().pending_requested, caps);
    assert!(driver.snapshot().approved.is_empty());

    // Platform approves one of them (plus something that was never requested).
    driver.approve_capabilities(vec![Capability::send_event("m.room.message"), Capability::send_event("evil")]);
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    let notify = HostRequest::from_wire(&sent[0]).unwrap();
    assert_eq!(
        notify,
        HostRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest {
                requested: caps,
                approved: vec![Capability::send_event("m.room.message")]
            }
        }
    );
    assert_eq!(driver.snapshot().approved, vec![Capability::send_event("m.room.message")]);
    assert!(driver.snapshot().pending_requested.is_empty());

    // Widget acks notify_capabilities.
    block(driver.handle_message_from_widget(sent[0].ack().to_json())).unwrap();
    // A second ack for the same id is unexpected.
    assert_eq!(
        block(driver.handle_message_from_widget(sent[0].ack().to_json())),
        Err(DriverError::UnexpectedResponse { request_id: sent[0].request_id.clone() })
    );

    // A second round: `approved` in notify_capabilities is cumulative (legacy compatible).
    let more = vec![Capability::read_events("m.room.topic")];
    block(feed(
        &driver,
        WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: more.clone() } },
        "cap2",
    ))
    .unwrap();
    platform.drain();
    driver.approve_capabilities(more.clone());
    let sent = platform.drain();
    assert_eq!(
        HostRequest::from_wire(&sent[0]).unwrap(),
        HostRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest {
                requested: more,
                approved: vec![Capability::send_event("m.room.message"), Capability::read_events("m.room.topic")]
            }
        }
    );
    block(driver.handle_message_from_widget(sent[0].ack().to_json())).unwrap();

    // Approving again with nothing pending is a no-op.
    driver.approve_capabilities(vec![Capability::send_event("x")]);
    assert!(platform.drain().is_empty());
}

fn grant(driver: &WidgetHostDriver, platform: &RecordingPlatform, caps: Vec<Capability>) {
    block(feed(
        driver,
        WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
        "grant",
    ))
    .unwrap();
    driver.approve_capabilities(caps);
    platform.drain();
}

#[test]
fn send_event_requires_capability() {
    let (driver, backend, platform) = setup();
    let req = WidgetRequest::SendEvent {
        request: SendEventRequest::room_event("m.room.message", json!({"body": "hi"}).into()),
    };

    block(feed(&driver, req.clone(), "s1")).unwrap();
    let sent = platform.drain();
    let err = sent[0].error().expect("should be an error");
    assert!(err.message.contains("widget:org.matrix.mscXXXX.send_event.timeline:m.room.message"), "{}", err.message);
    assert!(backend.timeline().is_empty());

    grant(&driver, &platform, vec![Capability::send_event("m.room.message")]);
    block(feed(&driver, req, "s2")).unwrap();
    let sent = platform.drain();
    match WidgetResponse::from_wire(&sent[0]).unwrap() {
        WidgetResponse::SendEvent { response } => {
            assert_eq!(response.room_id, "!room:x");
            assert_eq!(Some(&backend.timeline()[0].event_id), response.event_id.as_ref());
            assert!(response.delay_id.is_none());
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(backend.timeline()[0].content["body"], "hi");

    // state event with a timeline-only capability -> denied
    block(feed(
        &driver,
        WidgetRequest::SendEvent { request: SendEventRequest::state_event("m.room.message", "", json!({}).into()) },
        "s3",
    ))
    .unwrap();
    assert!(platform.drain()[0].error().is_some());

    // backend failure is relayed as an error response
    backend.set_fail_sends(Some(BackendError::forbidden("power level")));
    block(feed(
        &driver,
        WidgetRequest::SendEvent { request: SendEventRequest::room_event("m.room.message", json!({}).into()) },
        "s4",
    ))
    .unwrap();
    let err = platform.drain()[0].error().unwrap();
    assert!(err.message.contains("power level"));
    let matrix = err.matrix_api_error.unwrap();
    assert_eq!(matrix.http_status, 403);
    assert_eq!(matrix.response.errcode, "M_FORBIDDEN");
    assert_eq!(matrix.response.error, "power level");
}

#[test]
fn msgtype_capabilities_narrow_sends_and_reads() {
    let (driver, backend, platform) = setup();
    grant(
        &driver,
        &platform,
        vec![
            Capability::send_message("m.text"),
            Capability::read_messages("m.text"),
            Capability::forward_messages("m.text"),
        ],
    );
    let send = |msgtype: &str, id: &str| {
        block(feed(
            &driver,
            WidgetRequest::SendEvent {
                request: SendEventRequest::room_event(
                    "m.room.message",
                    json!({"msgtype": msgtype, "body": "x"}).into(),
                ),
            },
            id,
        ))
        .unwrap();
    };
    send("m.text", "t1");
    send("m.image", "t2");
    let sent = platform.drain();
    // The text message is echoed through the subscription (forward_event) and answered; the
    // image is refused.
    assert_eq!(
        sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(),
        ["forward_event", "send_event", "send_event"]
    );
    assert!(sent[1].error().is_none());
    assert!(sent[2].error().unwrap().message.contains("m.room.message"));
    backend.inject(event("m.room.message", None, json!({"msgtype": "m.image", "body": "pic"})));
    assert!(platform.drain().is_empty());

    block(feed(
        &driver,
        WidgetRequest::ReadEvents { request: ReadEventsRequest::timeline("m.room.message", None) },
        "r",
    ))
    .unwrap();
    let WidgetResponse::ReadEvents { response } = WidgetResponse::from_wire(&platform.drain()[0]).unwrap() else {
        panic!()
    };
    assert_eq!(response.events.len(), 1);
    assert_eq!(response.events[0].content["msgtype"], "m.text");
}

/// Feed a `send_event` and return the host's reply.
fn send(driver: &WidgetHostDriver, platform: &RecordingPlatform, request: SendEventRequest) -> WireMessage {
    block(feed(driver, WidgetRequest::SendEvent { request }, "send")).unwrap();
    platform.drain().pop().unwrap()
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
    let WidgetResponse::SendEvent { response } = WidgetResponse::from_wire(&send(&driver, &platform, delayed)).unwrap()
    else {
        panic!()
    };
    assert!(response.event_id.is_none());
    let delay_id = response.delay_id.unwrap();
    assert_eq!(backend.delayed_events()[0].delay_id, delay_id);
    assert!(backend.timeline().is_empty());

    // A sticky state event is nonsense.
    let mut sticky_state = SendEventRequest::state_event("m.room.topic", "", json!({}).into());
    sticky_state.sticky_duration_ms = Some(1);
    assert!(send(&driver, &platform, sticky_state).error().unwrap().message.contains("sticky"));

    // Sticky send goes through the sticky method.
    let WidgetResponse::SendEvent { response } = WidgetResponse::from_wire(&send(&driver, &platform, sticky)).unwrap()
    else {
        panic!()
    };
    assert_eq!(backend.timeline()[0].event_id, response.event_id.unwrap());

    // update_delayed_event: restart, then fire.
    for (action, id) in [(UpdateDelayedEventAction::Restart, "u1"), (UpdateDelayedEventAction::Send, "u2")] {
        block(feed(
            &driver,
            WidgetRequest::UpdateDelayedEvent {
                request: widget_actions::UpdateDelayedEventRequest { delay_id: delay_id.clone(), action },
            },
            id,
        ))
        .unwrap();
        assert_eq!(
            WidgetResponse::from_wire(&platform.drain().pop().unwrap()).unwrap(),
            WidgetResponse::UpdateDelayedEvent
        );
    }
    assert!(backend.delayed_events().is_empty());
    assert_eq!(backend.timeline()[1].content["body"], "later");

    // Cancelling an unknown id is a backend error with Matrix details.
    block(feed(
        &driver,
        WidgetRequest::UpdateDelayedEvent {
            request: widget_actions::UpdateDelayedEventRequest {
                delay_id: "nope".into(),
                action: UpdateDelayedEventAction::Cancel,
            },
        },
        "u3",
    ))
    .unwrap();
    let err = platform.drain().pop().unwrap().error().unwrap();
    assert_eq!(err.matrix_api_error.unwrap().response.errcode, "M_NOT_FOUND");
}

#[test]
fn explicit_room_id_must_be_the_own_room() {
    let (driver, backend, platform) = setup();
    grant(&driver, &platform, vec![Capability::send_event("m.room.message")]);
    // Naming the own room needs no capability.
    let mut req = SendEventRequest::room_event("m.room.message", json!({}).into());
    req.room_id = Some("!room:x".into());
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
    backend.inject(event("m.room.message", None, json!({"body": "root"})));
    let mut root = event("m.room.message", None, json!({"body": "root"}));
    root.event_id = "$root".into();
    backend.inject(root);
    let relate = |t: &str, id: &str| {
        let mut e = event(t, None, json!({"m.relates_to": {"rel_type": "m.annotation", "event_id": "$root"}}));
        e.event_id = id.into();
        e
    };
    backend.inject(relate("m.reaction", "$r1"));
    backend.inject(relate("org.example.other", "$o1"));

    let read = |room_id: Option<&str>, id: &str| {
        let mut request = ReadRelationsRequest::new("$root");
        request.room_id = room_id.map(Into::into);
        block(feed(&driver, WidgetRequest::ReadRelations { request }, id)).unwrap();
        platform.drain().pop().unwrap()
    };
    let chunk = |msg: WireMessage| match WidgetResponse::from_wire(&msg).unwrap() {
        WidgetResponse::ReadRelations { response } => {
            response.chunk.into_iter().map(|e| e.event_id).collect::<Vec<_>>()
        }
        other => panic!("{other:?}"),
    };
    // No `read_relations` capability yet: an empty page, not an error.
    assert!(chunk(read(None, "a")).is_empty());

    // Reading or being forwarded a type does not make it readable as a relation.
    grant(
        &driver,
        &platform,
        vec![
            Capability::read_events("m.reaction"),
            Capability::forward_event("m.reaction"),
            Capability::read_events("org.example.other"),
        ],
    );
    platform.drain();
    assert!(chunk(read(None, "a2")).is_empty());

    grant(&driver, &platform, vec![Capability::read_relations("m.reaction")]);
    assert_eq!(chunk(read(None, "b")), ["$r1"]);

    // The own room may be named; another room cannot be read.
    assert_eq!(chunk(read(Some("!room:x"), "c")), ["$r1"]);
    assert!(read(Some("!other:x"), "e").error().unwrap().message.contains("its own room"));
}

#[test]
fn read_events_room_ids_msgtype() {
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.message", None, json!({"msgtype": "m.text", "body": "1"})));
    backend.inject(event("m.room.message", None, json!({"msgtype": "m.image", "body": "2"})));
    grant(&driver, &platform, vec![Capability::read_events("m.room.message")]);
    let read = |room_ids: Option<RoomSelector>, msgtype: Option<&str>, id: &str| {
        let mut request = ReadEventsRequest::timeline("m.room.message", None);
        request.room_ids = room_ids;
        request.msgtype = msgtype.map(Into::into);
        block(feed(&driver, WidgetRequest::ReadEvents { request }, id)).unwrap();
        platform.drain().pop().unwrap()
    };
    let events = |msg: WireMessage| match WidgetResponse::from_wire(&msg).unwrap() {
        WidgetResponse::ReadEvents { response } => response.events,
        other => panic!("{other:?}"),
    };
    assert_eq!(events(read(None, Some("m.image"), "a")).len(), 1);
    assert_eq!(events(read(None, None, "b")).len(), 2);
    // `*` is every room the widget can read: its own.
    assert_eq!(events(read(Some(RoomSelector::Any), None, "c")).len(), 2);
    // The own room may be named without any further capability.
    let own = Some(RoomSelector::Rooms { room_ids: vec!["!room:x".into()] });
    assert_eq!(events(read(own, None, "d")).len(), 2);
    // Another room cannot be read, alone or next to the own room.
    let other = RoomSelector::Rooms { room_ids: vec!["!other:x".into()] };
    assert!(read(Some(other), None, "g").error().unwrap().message.contains("its own room"));
    let both = RoomSelector::Rooms { room_ids: vec!["!room:x".into(), "!other:x".into()] };
    assert!(read(Some(both), None, "h").error().is_some());
}

#[test]
fn reading_and_forwarding_are_separate_capabilities() {
    let (driver, backend, platform) = setup();
    let read = |id: &str| {
        let request = ReadEventsRequest::timeline("m.room.message", None);
        block(feed(&driver, WidgetRequest::ReadEvents { request }, id)).unwrap();
        platform.drain().pop().unwrap()
    };

    // `forward_event` only: new events are pushed, but `read_events` is refused.
    grant(&driver, &platform, vec![Capability::forward_event("m.room.message")]);
    backend.inject(event("m.room.message", None, json!({"body": "1"})));
    let sent = platform.drain();
    assert_eq!(sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(), ["forward_event"]);
    assert!(read("r1").error().unwrap().message.contains("read_events.timeline:m.room.message"));

    // `read_events` only (another type): readable, but nothing is pushed.
    grant(&driver, &platform, vec![Capability::read_events("m.reaction")]);
    backend.inject(event("m.reaction", None, json!({})));
    assert!(platform.drain().is_empty());
    block(feed(&driver, WidgetRequest::ReadEvents { request: ReadEventsRequest::timeline("m.reaction", None) }, "r2"))
        .unwrap();
    let WidgetResponse::ReadEvents { response } = WidgetResponse::from_wire(&platform.drain()[0]).unwrap() else {
        panic!()
    };
    assert_eq!(response.events.len(), 1);
}

#[test]
fn read_events_filters_by_capability() {
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t"})));
    backend.inject(event("m.room.member", Some("@me:x"), json!({"membership": "join"})));
    backend.inject(event("m.room.member", Some("@other:x"), json!({"membership": "join"})));
    backend.inject(event("m.room.message", None, json!({"body": "1"})));
    backend.inject(event("m.room.message", None, json!({"body": "2"})));

    let read_members =
        WidgetRequest::ReadEvents { request: ReadEventsRequest::state("m.room.member", StateKeySelector::Any) };
    block(feed(&driver, read_members.clone(), "r0")).unwrap();
    assert!(platform.drain()[0].error().is_some());

    grant(
        &driver,
        &platform,
        vec![Capability::read_state_events("m.room.member", Some("@me:x")), Capability::read_events("m.room.message")],
    );

    block(feed(&driver, read_members, "r1")).unwrap();
    let WidgetResponse::ReadEvents { response } = WidgetResponse::from_wire(&platform.drain()[0]).unwrap() else {
        panic!()
    };
    // Only the state key we are allowed to see.
    assert_eq!(response.events.len(), 1);
    assert_eq!(response.events[0].state_key.as_deref(), Some("@me:x"));

    block(feed(
        &driver,
        WidgetRequest::ReadEvents { request: ReadEventsRequest::timeline("m.room.message", Some(1)) },
        "r2",
    ))
    .unwrap();
    let WidgetResponse::ReadEvents { response } = WidgetResponse::from_wire(&platform.drain()[0]).unwrap() else {
        panic!()
    };
    assert_eq!(response.events.len(), 1);
    assert_eq!(response.events[0].content["body"], "2");
}

/// Request `caps` and approve them, returning what was sent after `notify_capabilities`.
fn grant_and_drain(driver: &WidgetHostDriver, platform: &RecordingPlatform, caps: Vec<Capability>) -> Vec<WireMessage> {
    block(feed(
        driver,
        WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
        "grant",
    ))
    .unwrap();
    platform.drain();
    driver.approve_capabilities(caps);
    let mut sent = platform.drain();
    assert_eq!(sent.remove(0).action, "notify_capabilities");
    sent
}

fn types(list: &[&str]) -> Vec<String> {
    list.iter().map(|s| s.to_string()).collect()
}

#[test]
fn approving_capabilities_subscribes_with_derived_subjects() {
    let (driver, backend, platform) = setup();

    // Send-only capabilities: nothing to subscribe to.
    grant_and_drain(&driver, &platform, vec![Capability::send_event("m.room.message")]);
    assert!(backend.room_subscriptions().is_empty());

    // Neither do the widget's read capabilities: reading is a request, not a subscription.
    grant_and_drain(&driver, &platform, vec![Capability::read_events("m.room.message")]);
    assert!(backend.room_subscriptions().is_empty());

    grant_and_drain(&driver, &platform, vec![Capability::forward_event("m.room.message")]);
    let subscriptions = backend.room_subscriptions();
    assert_eq!(subscriptions.len(), 1);
    assert_eq!(subscriptions[0].timeline_event_types, types(&["m.room.message"]));
    assert!(subscriptions[0].state_event_types.is_empty());

    // A new host capability: the old subscription is replaced by a wider one. `update_state`
    // subscribes to the state set only.
    grant_and_drain(&driver, &platform, vec![Capability::update_state("m.room.topic", None::<&str>)]);
    let subscriptions = backend.room_subscriptions();
    assert_eq!(subscriptions.len(), 1);
    assert_eq!(subscriptions[0].timeline_event_types, types(&["m.room.message"]));
    assert_eq!(subscriptions[0].state_event_types, types(&["m.room.topic"]));

    // `forward_event.state` adds the type to the timeline subscription.
    grant_and_drain(&driver, &platform, vec![Capability::forward_state_event("m.room.topic", None::<&str>)]);
    let subscriptions = backend.room_subscriptions();
    assert_eq!(subscriptions[0].timeline_event_types, types(&["m.room.message", "m.room.topic"]));
    assert_eq!(subscriptions[0].state_event_types, types(&["m.room.topic"]));
}

#[test]
fn openid_flow() {
    let (driver, backend, platform) = setup();
    // Without the capability the user is not even asked.
    block(feed(&driver, WidgetRequest::GetOpenId, "o0")).unwrap();
    assert!(platform.drain()[0].error().unwrap().message.contains("widget:org.matrix.mscXXXX.get_openid"));
    assert_eq!(platform.openid_requests.load(Ordering::SeqCst), 0);
    grant(&driver, &platform, vec![Capability::GetOpenId]);

    // Phase one: the user is asked.
    block(feed(&driver, WidgetRequest::GetOpenId, "o1")).unwrap();
    block(feed(&driver, WidgetRequest::GetOpenId, "o2")).unwrap();
    let sent = platform.drain();
    assert_eq!(sent.len(), 2);
    for m in &sent {
        assert_eq!(
            WidgetResponse::from_wire(m).unwrap(),
            WidgetResponse::GetOpenId { response: GetOpenIdResponse::pending() }
        );
    }
    assert_eq!(platform.openid_requests.load(Ordering::SeqCst), 2);
    assert_eq!(driver.snapshot().pending_openid_requests, vec!["o1".to_string(), "o2".to_string()]);

    // Allowed: one forward_openid_credentials per pending request, all with the same token.
    block(driver.resolve_openid(true));
    let sent = platform.drain();
    assert_eq!(sent.len(), 2);
    let creds: Vec<ForwardOpenIdCredentialsRequest> = sent
        .iter()
        .map(|m| match HostRequest::from_wire(m).unwrap() {
            HostRequest::ForwardOpenIdCredentials { request } => request,
            other => panic!("{other:?}"),
        })
        .collect();
    assert_eq!(creds[0].original_request_id, "o1");
    assert_eq!(creds[1].original_request_id, "o2");
    assert_eq!(creds[0].token().unwrap().matrix_server_name, "matrix.example.org");
    assert_eq!(creds[0].token(), creds[1].token());
    assert!(driver.snapshot().pending_openid_requests.is_empty());
    // Resolving again is a no-op.
    block(driver.resolve_openid(true));
    assert!(platform.drain().is_empty());

    // Blocked.
    block(feed(&driver, WidgetRequest::GetOpenId, "o3")).unwrap();
    platform.drain();
    block(driver.resolve_openid(false));
    let sent = platform.drain();
    assert_eq!(
        HostRequest::from_wire(&sent[0]).unwrap(),
        HostRequest::ForwardOpenIdCredentials { request: ForwardOpenIdCredentialsRequest::blocked("o3") }
    );

    // Auto-approved: answered in phase one, platform not asked.
    driver.set_openid_auto_approved(true);
    assert!(driver.snapshot().openid_auto_approved);
    block(feed(&driver, WidgetRequest::GetOpenId, "o4")).unwrap();
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    let WidgetResponse::GetOpenId { response } = WidgetResponse::from_wire(&sent[0]).unwrap() else { panic!() };
    assert!(response.token().unwrap().access_token.starts_with("openid-token-"));
    assert_eq!(platform.openid_requests.load(Ordering::SeqCst), 3);
    let _ = backend;
}

#[test]
fn turn_servers() {
    let (driver, backend, platform) = setup();
    let turn = |u: &str| TurnServer { uris: vec!["turn:x".into()], username: u.into(), password: "p".into() };
    backend.set_turn_server(turn("first"));
    block(feed(&driver, WidgetRequest::WatchTurnServers, "w0")).unwrap();
    assert!(platform.drain()[0].error().unwrap().message.contains("host:org.matrix.mscXXXX.update_turn_servers"));

    grant(&driver, &platform, vec![Capability::UpdateTurnServers]);
    block(feed(&driver, WidgetRequest::WatchTurnServers, "w1")).unwrap();
    let sent = platform.drain();
    // The ack, then the current credentials.
    assert_eq!(sent.len(), 2);
    assert_eq!(WidgetResponse::from_wire(&sent[0]).unwrap(), WidgetResponse::WatchTurnServers);
    assert_eq!(HostRequest::from_wire(&sent[1]).unwrap(), HostRequest::UpdateTurnServers { server: turn("first") });
    // Watching twice is a plain ack.
    block(feed(&driver, WidgetRequest::WatchTurnServers, "w2")).unwrap();
    assert_eq!(platform.drain().len(), 1);
    backend.set_turn_server(turn("second"));
    assert_eq!(platform.drain()[0].request_body()["username"], "second");

    block(feed(&driver, WidgetRequest::UnwatchTurnServers, "u1")).unwrap();
    assert_eq!(WidgetResponse::from_wire(&platform.drain()[0]).unwrap(), WidgetResponse::UnwatchTurnServers);
    backend.set_turn_server(turn("third"));
    assert!(platform.drain().is_empty());
}

#[test]
fn read_style_actions_need_their_capabilities() {
    let (driver, backend, platform) = setup();
    backend.set_rtc_transports(json!([{"type": "livekit"}]).into());
    backend.set_room_account_data("m.tag".into(), json!({"tags": {}}).into());
    backend.inject(event("m.room.member", Some("@alice:x"), json!({"membership": "join"})));
    let requests = |id: &str| {
        vec![
            (WidgetRequest::GetRtcTransports, format!("{id}-rtc")),
            (
                WidgetRequest::SearchUserDirectory {
                    request: widget_actions::SearchUserDirectoryRequest { search_term: "ali".into(), limit: None },
                },
                format!("{id}-dir"),
            ),
            (WidgetRequest::GetMediaConfig, format!("{id}-media")),
            (
                WidgetRequest::ReadRoomAccountData {
                    request: ReadRoomAccountDataRequest { event_type: "m.tag".into(), room_ids: None },
                },
                format!("{id}-acc"),
            ),
            (
                WidgetRequest::GetRtcLivekitToken {
                    request: widget_actions::GetRtcLivekitTokenRequest {
                        server_name: "x".into(),
                        url: "u".into(),
                        room_id: "!room:x".into(),
                        slot_id: "s".into(),
                        member_id: "m".into(),
                    },
                },
                format!("{id}-lk"),
            ),
        ]
    };
    for (request, id) in requests("a") {
        block(feed(&driver, request, &id)).unwrap();
    }
    let sent = platform.drain();
    assert_eq!(sent.len(), 5);
    assert!(sent.iter().all(|m| m.error().is_some()));

    grant(
        &driver,
        &platform,
        vec![
            Capability::GetRtcTransports,
            Capability::SearchUserDirectory,
            // `upload_file` no longer covers the media config: each action has its own capability.
            Capability::UploadFile,
            Capability::read_room_account_data("m.tag"),
            Capability::GetRtcLivekitToken,
        ],
    );
    block(feed(&driver, WidgetRequest::GetMediaConfig, "upload-only")).unwrap();
    assert!(platform.drain()[0].error().unwrap().message.contains("widget:org.matrix.mscXXXX.get_media_config"));
    grant(&driver, &platform, vec![Capability::GetMediaConfig]);
    for (request, id) in requests("b") {
        block(feed(&driver, request, &id)).unwrap();
    }
    let sent = platform.drain();
    let responses: Vec<WidgetResponse> = sent.iter().map(|m| WidgetResponse::from_wire(m).unwrap()).collect();
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

    // Account data of another type is still refused.
    block(feed(
        &driver,
        WidgetRequest::ReadRoomAccountData {
            request: ReadRoomAccountDataRequest { event_type: "m.other".into(), room_ids: None },
        },
        "c",
    ))
    .unwrap();
    assert!(platform.drain()[0].error().is_some());
}

#[test]
fn upload_and_download_files() {
    let (driver, backend, platform) = setup();
    let upload = |file: Base64File, id: &str| {
        block(feed(&driver, WidgetRequest::UploadFile { request: UploadFileRequest { file } }, id)).unwrap();
        platform.drain().pop().unwrap()
    };
    let download = |content_uri: &str, id: &str| {
        let request = DownloadFileRequest { content_uri: content_uri.into() };
        block(feed(&driver, WidgetRequest::DownloadFile { request }, id)).unwrap();
        platform.drain().pop().unwrap()
    };
    let hello = Base64File::from_bytes(b"hello", Some("text/plain".into()));

    // Each direction needs its own capability.
    assert!(upload(hello.clone(), "u0").error().unwrap().message.contains("widget:org.matrix.mscXXXX.upload_file"));
    assert!(download("mxc://x/y", "d0").error().unwrap().message.contains("widget:org.matrix.mscXXXX.download_file"));
    grant(&driver, &platform, vec![Capability::UploadFile, Capability::DownloadFile]);

    let WidgetResponse::UploadFile { response } = WidgetResponse::from_wire(&upload(hello.clone(), "u1")).unwrap()
    else {
        panic!()
    };
    // The backend got raw bytes, the widget gets the same base64 back.
    let stored = block(backend.download_media(response.content_uri.clone())).unwrap();
    assert_eq!(stored, MediaFile { data: b"hello".to_vec(), mimetype: Some("text/plain".into()) });
    assert_eq!(
        WidgetResponse::from_wire(&download(&response.content_uri, "d1")).unwrap(),
        WidgetResponse::DownloadFile { response: DownloadFileResponse { file: hello } }
    );

    let broken = Base64File { mimetype: None, base64: "%%%".into() };
    assert!(upload(broken, "u2").error().unwrap().message.contains("Invalid base64"));
    assert!(download("mxc://x/missing", "d2").error().unwrap().message.contains("Failed to download"));
    backend.fail_sends(Some("full".into()));
    let failed = upload(Base64File::from_bytes(b"x", None), "u3");
    assert!(failed.error().unwrap().message.contains("Failed to upload"));
}

#[test]
fn platform_actions_and_pushes() {
    let (driver, _, platform) = setup();
    let navigate = |uri: &str, id: &str| {
        block(feed(
            &driver,
            WidgetRequest::Navigate { request: widget_actions::NavigateRequest { uri: uri.into() } },
            id,
        ))
        .unwrap();
        platform.drain().pop().unwrap()
    };
    assert!(navigate("https://matrix.to/#/#a:x", "n0")
        .error()
        .unwrap()
        .message
        .contains("widget:org.matrix.mscXXXX.navigate"));
    grant(&driver, &platform, vec![Capability::Navigate, Capability::SetAlwaysOnScreen]);
    assert!(navigate("https://example.org", "n1").error().unwrap().message.contains("Invalid matrix.to URI"));
    assert!(navigate("https://matrix.to/#/broken", "n2").error().unwrap().message.contains("no such room"));
    assert_eq!(
        WidgetResponse::from_wire(&navigate("https://matrix.to/#/#a:x", "n3")).unwrap(),
        WidgetResponse::Navigate
    );
    assert_eq!(platform.navigated.lock().unwrap().as_slice(), &["https://matrix.to/#/#a:x".to_string()]);

    block(feed(
        &driver,
        WidgetRequest::SetAlwaysOnScreen { request: widget_actions::SetAlwaysOnScreenRequest { value: true } },
        "a1",
    ))
    .unwrap();
    assert_eq!(
        WidgetResponse::from_wire(&platform.drain()[0]).unwrap(),
        WidgetResponse::SetAlwaysOnScreen { response: SetAlwaysOnScreenResponse { success: true } }
    );
    assert_eq!(*platform.always_on_screen.lock().unwrap(), Some(true));

    // Pushes from the client are subscriptions: without the capability nothing is sent.
    let push_all = || {
        driver.update_theme(json!({"name": "dark"}).into());
        driver.update_language("de".into());
        driver.update_visibility(false);
    };
    push_all();
    assert!(platform.drain().is_empty());
    // Each push has its own capability.
    grant(&driver, &platform, vec![Capability::UpdateLanguage]);
    push_all();
    assert_eq!(platform.drain().iter().map(|m| m.action.as_str()).collect::<Vec<_>>(), ["update_language"]);

    // With all three they go out and are acknowledged by the widget.
    grant(&driver, &platform, vec![Capability::UpdateTheme, Capability::UpdateVisibility]);
    push_all();
    let sent = platform.drain();
    assert_eq!(
        sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(),
        ["update_theme", "update_language", "update_visibility"]
    );
    assert_eq!(sent[0].request_body()["name"], "dark");
    assert_eq!(sent[1].request_body()["lang"], "de");
    assert_eq!(sent[2].request_body()["visible"], false);
    for m in &sent {
        block(driver.handle_message_from_widget(m.ack().to_json())).unwrap();
    }
}

#[test]
fn to_device_both_directions() {
    let (driver, backend, platform) = setup();
    let mut messages = HashMap::new();
    messages.insert("@a:x".to_string(), HashMap::from([("DEV".to_string(), JsonValue::from(json!({"n": 1})))]));
    let request = SendToDeviceRequest { event_type: "org.example.ping".into(), encrypted: true, messages };
    block(feed(&driver, WidgetRequest::SendToDevice { request: request.clone() }, "t0")).unwrap();
    assert!(platform.drain()[0]
        .error()
        .unwrap()
        .message
        .contains("widget:org.matrix.mscXXXX.send_to_device:org.example.ping"));

    grant(
        &driver,
        &platform,
        vec![Capability::send_to_device("org.example.ping"), Capability::forward_to_device("org.example.ping")],
    );
    block(feed(&driver, WidgetRequest::SendToDevice { request }, "t1")).unwrap();
    assert_eq!(WidgetResponse::from_wire(&platform.drain()[0]).unwrap(), WidgetResponse::SendToDevice);
    let sent = backend.to_device_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!((sent[0].user_id.as_str(), sent[0].device_id.as_str()), ("@a:x", "DEV"));
    assert!(sent[0].encrypted);

    // Incoming: only subscribed / permitted types reach the widget.
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
    block(driver.handle_message_from_widget(sent[0].ack().to_json())).unwrap();
}

#[test]
fn to_device_capabilities_subscribe_separately() {
    let (driver, backend, platform) = setup();
    grant_and_drain(&driver, &platform, vec![Capability::forward_to_device("a"), Capability::forward_to_device("a")]);
    assert!(backend.room_subscriptions().is_empty());
    assert_eq!(backend.to_device_subscriptions(), vec![types(&["a"])]);
    // Sending a type is not a subscription to it.
    grant_and_drain(&driver, &platform, vec![Capability::send_to_device("c")]);
    assert_eq!(backend.to_device_subscriptions(), vec![types(&["a"])]);
    grant_and_drain(&driver, &platform, vec![Capability::forward_to_device("b")]);
    assert_eq!(backend.to_device_subscriptions(), vec![types(&["a", "b"])]);
}

#[test]
fn dropping_the_driver_cancels_the_subscriptions() {
    let (driver, backend, platform) = setup();
    grant_and_drain(
        &driver,
        &platform,
        vec![Capability::forward_event("m.room.message"), Capability::forward_to_device("a")],
    );
    assert_eq!(backend.room_subscriptions().len(), 1);
    assert_eq!(backend.to_device_subscriptions().len(), 1);
    drop(driver);
    assert!(backend.room_subscriptions().is_empty());
    assert!(backend.to_device_subscriptions().is_empty());
}

#[test]
fn initial_state_and_changes_reach_the_widget() {
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t1"})));
    backend.inject(event("m.room.name", Some(""), json!({"name": "n"})));
    backend.inject(event("m.room.message", None, json!({"body": "old"})));

    // Approval delivers the current state the widget may see, synchronously (the in-memory
    // backend calls the sink from inside `subscribe_room`), right after `notify_capabilities`.
    let sent = grant_and_drain(
        &driver,
        &platform,
        vec![
            Capability::update_state("m.room.topic", None::<&str>),
            Capability::forward_state_event("m.room.topic", None::<&str>),
            Capability::forward_event("m.room.message"),
        ],
    );
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].action, "update_state");
    let state = sent[0].request_body()["state"].as_array().unwrap().clone();
    assert_eq!(state.len(), 1);
    assert_eq!(state[0]["content"]["topic"], "t1");

    // A changed topic: forwarded as a timeline event (`forward_event.state`) and as the new state
    // set (`update_state`).
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t2"})));
    let sent = platform.drain();
    assert_eq!(sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(), ["forward_event", "update_state"]);
    assert_eq!(sent[0].source, Source::Host);
    assert!(sent[0].is_v1());
    assert_eq!(sent[0].request_body()["content"]["topic"], "t2");
    let state = sent[1].request_body()["state"].as_array().unwrap().clone();
    assert_eq!(state.len(), 1);
    assert_eq!(state[0]["content"]["topic"], "t2");

    // Types without a capability are dropped.
    backend.inject(event("m.room.name", Some(""), json!({"name": "n2"})));
    backend.inject(event("m.reaction", None, json!({})));
    assert!(platform.drain().is_empty());

    // A timeline event only.
    backend.inject(event("m.room.message", None, json!({"body": "x"})));
    let sent = platform.drain();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].action, "forward_event");
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
    let sent = grant_and_drain(&driver, &platform, vec![Capability::update_state("m.room.member", Some("@me:x"))]);
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].action, "update_state");
    let state = sent[0].request_body()["state"].as_array().unwrap().clone();
    assert_eq!(state.len(), 1);
    assert_eq!(state[0]["state_key"], "@me:x");

    // The other member changing: the full set is re-delivered, still filtered to `@me:x`
    // and never as `forward_event` (no `forward_event.state` capability).
    backend.inject(event("m.room.member", Some("@other:x"), json!({"membership": "leave"})));
    let sent = platform.drain();
    assert_eq!(sent.iter().map(|m| m.action.as_str()).collect::<Vec<_>>(), ["update_state"]);
    let state = sent[0].request_body()["state"].as_array().unwrap().clone();
    assert_eq!(state.len(), 1);
    assert_eq!(state[0]["state_key"], "@me:x");
}

#[test]
fn update_state_and_forward_event_state_are_separate() {
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t1"})));

    // `forward_event.state` only: no initial state, but changes arrive as timeline events.
    let sent = grant_and_drain(&driver, &platform, vec![Capability::forward_state_event("m.room.topic", Some(""))]);
    assert!(sent.is_empty());
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t2"})));
    assert_eq!(platform.drain().iter().map(|m| m.action.as_str()).collect::<Vec<_>>(), ["forward_event"]);
    // Another state key of the same type is not forwarded.
    backend.inject(event("m.room.topic", Some("other"), json!({"topic": "x"})));
    assert!(platform.drain().is_empty());

    // The legacy strings and the `read_events.state` capability give neither.
    let (driver, backend, platform) = setup();
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t1"})));
    let sent = grant_and_drain(
        &driver,
        &platform,
        vec![
            Capability::parse("org.matrix.msc2762.receive.state_event:m.room.topic"),
            Capability::read_state_events("m.room.topic", None::<&str>),
        ],
    );
    assert!(sent.is_empty());
    backend.inject(event("m.room.topic", Some(""), json!({"topic": "t2"})));
    assert!(platform.drain().is_empty());
}

#[test]
fn legacy_capability_strings_grant_nothing() {
    let (driver, backend, platform) = setup();
    let legacy = [
        "org.matrix.msc2762.send.event:m.room.message",
        "m.send.event:m.room.message",
        "org.matrix.msc2762.receive.event:m.room.message",
        "org.matrix.msc2931.navigate",
        "m.always_on_screen",
    ];
    // They are negotiated like any unknown string and echoed back unchanged ...
    let caps: Vec<Capability> = legacy.iter().map(|raw| Capability::parse(raw)).collect();
    block(feed(
        &driver,
        WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
        "legacy",
    ))
    .unwrap();
    driver.approve_capabilities(caps);
    let notify = platform.drain().pop().unwrap();
    assert_eq!(notify.request_body()["approved"], json!(legacy));

    // ... but allow nothing: only the compat wrapper translates them.
    let message = SendEventRequest::room_event("m.room.message", json!({"body": "hi"}).into());
    assert!(send(&driver, &platform, message).error().is_some());
    assert!(backend.timeline().is_empty());
    assert!(backend.room_subscriptions().is_empty());
    block(feed(
        &driver,
        WidgetRequest::Navigate { request: widget_actions::NavigateRequest { uri: "https://matrix.to/#/#a:x".into() } },
        "n",
    ))
    .unwrap();
    assert!(platform.drain()[0].error().is_some());
}

#[test]
fn protocol_errors() {
    let (driver, _, platform) = setup();
    assert!(matches!(
        block(driver.handle_message_from_widget("not json".into())),
        Err(DriverError::NotAWidgetMessage { .. })
    ));
    let legacy = json!({"source": "widget", "action": "content_loaded", "requestId": "1", "request": {}});
    assert_eq!(block(driver.handle_message_from_widget(legacy.to_string())), Err(DriverError::LegacyWidgetApi));
    let v2 = json!({"source": "widget", "action": "x", "requestId": "1", "request": {}, "version": "v2"});
    assert_eq!(
        block(driver.handle_message_from_widget(v2.to_string())),
        Err(DriverError::UnsupportedVersion { version: "v2".into() })
    );
    let host_req = HostRequest::ForwardEvent { event: event("m.x", None, json!({})) }.into_wire("h");
    assert!(matches!(
        block(driver.handle_message_from_widget(host_req.to_json())),
        Err(DriverError::WrongDirection { .. })
    ));
    assert!(platform.drain().is_empty());

    // Unknown action and malformed body get error *responses*, not driver errors.
    let unknown = WireMessage::request(Source::Widget, "org.example.nope", "u", json!({}));
    block(driver.handle_message_from_widget(unknown.to_json())).unwrap();
    let bad = WireMessage::request(Source::Widget, "send_event", "b", json!({"type": 5}));
    block(driver.handle_message_from_widget(bad.to_json())).unwrap();
    let sent = platform.drain();
    assert_eq!(sent.len(), 2);
    assert!(sent[0].error().unwrap().message.contains("Unknown action"));
    assert!(sent[1].error().unwrap().message.contains("Invalid request body"));
}

#[test]
fn context_actions_need_their_capabilities() {
    let (driver, _, platform) = setup();
    block(feed(&driver, WidgetRequest::GetMatrixContext, "m1")).unwrap();
    block(feed(&driver, WidgetRequest::GetClientContext, "c1")).unwrap();
    let sent = platform.drain();
    assert!(sent[0].error().unwrap().message.contains("widget:org.matrix.mscXXXX.get_matrix_context"));
    assert!(sent[1].error().unwrap().message.contains("widget:org.matrix.mscXXXX.get_client_context"));

    let caps = vec![Capability::GetMatrixContext, Capability::GetClientContext];
    block(feed(
        &driver,
        WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: caps.clone() } },
        "cap",
    ))
    .unwrap();
    driver.approve_capabilities(caps);
    platform.drain();

    block(feed(&driver, WidgetRequest::GetMatrixContext, "m2")).unwrap();
    block(feed(&driver, WidgetRequest::GetClientContext, "c2")).unwrap();
    let sent = platform.drain();
    assert_eq!(
        WidgetResponse::from_wire(&sent[0]).unwrap(),
        WidgetResponse::GetMatrixContext {
            response: GetMatrixContextResponse {
                user_id: "@me:x".into(),
                device_id: "WIDGETTEST".into(),
                room_id: "!room:x".into(),
                display_name: "@me:x".into(),
                avatar_url: String::new(),
                matrix_base_url: "https://matrix.example.org".into(),
            }
        }
    );
    assert_eq!(
        WidgetResponse::from_wire(&sent[1]).unwrap(),
        WidgetResponse::GetClientContext {
            response: GetClientContextResponse {
                client_id: Some("test-client".into()),
                client_theme: Some("dark".into()),
                client_language: None
            }
        }
    );
}

#[test]
fn auto_approved_capabilities_skip_the_platform() {
    let (driver, _, platform) = setup();
    driver.set_auto_approved(vec![Capability::GetMatrixContext, Capability::GetClientContext]);
    assert_eq!(driver.snapshot().auto_approved.len(), 2);

    // Only auto-approved capabilities: granted at once, platform never asked.
    block(feed(
        &driver,
        WidgetRequest::RequestCapabilities {
            request: RequestCapabilitiesRequest { capabilities: vec![Capability::GetMatrixContext] },
        },
        "a1",
    ))
    .unwrap();
    let sent = platform.drain();
    assert!(platform.requested.lock().unwrap().is_empty());
    assert_eq!(sent.len(), 2);
    assert_eq!(sent[0].request_id, "a1");
    assert_eq!(
        HostRequest::from_wire(&sent[1]).unwrap(),
        HostRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest {
                requested: vec![Capability::GetMatrixContext],
                approved: vec![Capability::GetMatrixContext]
            }
        }
    );
    block(driver.handle_message_from_widget(sent[1].ack().to_json())).unwrap();

    // Mixed: the platform is asked only about the rest, auto-approved ones are added.
    let mixed = vec![Capability::GetClientContext, Capability::send_event("m.room.message")];
    block(feed(
        &driver,
        WidgetRequest::RequestCapabilities { request: RequestCapabilitiesRequest { capabilities: mixed } },
        "a2",
    ))
    .unwrap();
    platform.drain();
    assert_eq!(platform.requested.lock().unwrap().as_slice(), &[vec![Capability::send_event("m.room.message")]]);
    driver.approve_capabilities(vec![Capability::send_event("m.room.message")]);
    let notify = HostRequest::from_wire(&platform.drain()[0]).unwrap();
    assert_eq!(
        notify,
        HostRequest::NotifyCapabilities {
            request: NotifyCapabilitiesRequest {
                requested: vec![Capability::GetClientContext, Capability::send_event("m.room.message")],
                approved: vec![
                    Capability::GetMatrixContext,
                    Capability::GetClientContext,
                    Capability::send_event("m.room.message")
                ]
            }
        }
    );
}
