//! End to end: a `WidgetClient` (widget side) talking to a `WidgetHostDriver` (host side) with
//! an `InMemoryBackend`, connected through in-memory queues instead of `postMessage`.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use matrix_widget_actions::{
    Capability, MatrixEvent, NotifyTimelineUpdateRequest, PaginationStatus, ReadTimelineRequest, TimelinePagination,
};
use matrix_widget_host_backend_interface::InMemoryBackend;
use matrix_widget_host_driver::{
    EmbedOptions, PlatformError, WidgetDefinition, WidgetHostDriver, WidgetHostPlatform, WidgetIframe,
};
use matrix_widget_sdk::{WidgetClient, WidgetDelegate};
use serde_json::json;

/// Widget -> host queue plus what the widget app observed.
#[derive(Default)]
struct WidgetSide {
    to_host: RefCell<VecDeque<String>>,
    events: RefCell<Vec<MatrixEvent>>,
    state_updates: RefCell<Vec<Vec<MatrixEvent>>>,
    timeline_updates: RefCell<Vec<NotifyTimelineUpdateRequest>>,
    approved: RefCell<Vec<Capability>>,
}

impl WidgetDelegate for WidgetSide {
    fn send_to_host(&self, json: String) {
        self.to_host.borrow_mut().push_back(json);
    }
    fn on_matrix_event(&self, event: MatrixEvent) {
        self.events.borrow_mut().push(event);
    }
    fn on_state_update(&self, state: Vec<MatrixEvent>) {
        self.state_updates.borrow_mut().push(state);
    }
    fn on_capabilities_changed(&self, approved: Vec<Capability>) {
        *self.approved.borrow_mut() = approved;
    }
    fn on_timeline_update(&self, update: NotifyTimelineUpdateRequest) {
        self.timeline_updates.borrow_mut().push(update);
    }
}

/// Host -> widget queue plus what the client UI observed.
#[derive(Default)]
struct HostSide {
    to_widget: Mutex<VecDeque<String>>,
    capability_requests: Mutex<Vec<Vec<Capability>>>,
    ready: Mutex<bool>,
}

impl WidgetHostPlatform for HostSide {
    fn load_iframe(&self, _iframe: WidgetIframe) {}
    fn send_to_widget(&self, json: String) {
        self.to_widget.lock().unwrap().push_back(json);
    }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) {
        self.capability_requests.lock().unwrap().push(requested);
    }
    fn on_ready(&self) {
        *self.ready.lock().unwrap() = true;
    }
    fn navigate(&self, _uri: String) -> Result<(), PlatformError> {
        Ok(())
    }
    fn set_always_on_screen(&self, value: bool) -> bool {
        value
    }
    fn client_id(&self) -> Option<String> {
        Some("loopback".into())
    }
    fn client_theme(&self) -> Option<String> {
        None
    }
    fn client_language(&self) -> Option<String> {
        None
    }
}

struct Loop {
    client: WidgetClient,
    widget_side: Rc<WidgetSide>,
    driver: Arc<WidgetHostDriver>,
    host_side: Arc<HostSide>,
    backend: Arc<InMemoryBackend>,
}

impl Loop {
    fn new() -> Self {
        let widget_side = Rc::new(WidgetSide::default());
        let client = WidgetClient::new(widget_side.clone());
        let host_side = Arc::new(HostSide::default());
        let backend = InMemoryBackend::new("!room:example".into(), "@user:example".into());
        let widget = WidgetDefinition::parse(
            "m.widget",
            "loopback",
            &serde_json::json!({ "name": "Loopback", "url": "https://widget.example/", "uses_widget_api": true }),
        )
        .expect("a widget");
        let driver = WidgetHostDriver::new(widget, EmbedOptions::default(), backend.clone(), host_side.clone())
            .expect("a widget that may be loaded");
        driver.start();
        Self { client, widget_side, driver, host_side, backend }
    }

    /// Shuttle messages in both directions until both queues are empty.
    async fn pump(&self) {
        loop {
            let next = self.widget_side.to_host.borrow_mut().pop_front();
            if let Some(json) = next {
                self.driver.handle_message_from_widget(json).await.expect("host accepts widget message");
                continue;
            }
            let next = self.host_side.to_widget.lock().unwrap().pop_front();
            if let Some(json) = next {
                self.client.handle_message_from_host(&json).expect("widget accepts host message");
                continue;
            }
            break;
        }
    }
}

#[test]
fn full_widget_lifecycle() {
    futures::executor::block_on(async {
        let l = Loop::new();

        // 1. The widget asks for capabilities before showing itself.
        let caps = vec![
            Capability::send_event("m.room.message"),
            // New messages and topic changes are forwarded, the topic is kept up to date, and
            // the widget may read topic changes from the timeline cache, paginate it and be told
            // about its changes: one capability per action.
            Capability::forward_event("m.room.message"),
            Capability::forward_state_event("m.room.topic", None::<&str>),
            Capability::update_state("m.room.topic", None::<&str>),
            Capability::read_timeline("m.room.topic"),
            Capability::PaginateTimeline,
            Capability::NotifyTimelineUpdate,
            Capability::send_state_event("m.room.topic", Some("")),
        ];
        let cap_fut = l.client.request_capabilities(caps.clone());
        l.pump().await;
        cap_fut.await.unwrap();
        assert_eq!(l.host_side.capability_requests.lock().unwrap().as_slice(), std::slice::from_ref(&caps));
        assert!(l.client.state().approved.is_empty());

        // 2. The user approves all but the topic write. The driver subscribes to the backend;
        //    the room has no topic yet, so no `update_state` is pushed.
        let approved: Vec<Capability> = caps.iter().take(caps.len() - 1).cloned().collect();
        l.driver.approve_capabilities(approved.clone());
        l.pump().await;
        assert_eq!(l.client.state().approved, approved);
        assert_eq!(*l.widget_side.approved.borrow(), approved);
        assert_eq!(l.driver.snapshot().approved, approved);
        assert!(l.widget_side.state_updates.borrow().is_empty());

        // 3. notify_ready
        let ready = l.client.notify_ready();
        l.pump().await;
        ready.await.unwrap();
        assert!(*l.host_side.ready.lock().unwrap());
        assert!(l.client.state().ready);

        // 4. Widget sends a message; it lands in the backend and, like from a real sync, comes
        //    back to the widget through the subscription.
        let send = l.client.send_event("m.room.message", json!({"msgtype": "m.text", "body": "hello"}));
        l.pump().await;
        let sent = send.await.unwrap();
        assert_eq!(sent.room_id, "!room:example");
        let event_id = sent.event_id.clone().expect("an immediate send has an event id");
        assert_eq!(l.backend.timeline()[0].event_id, event_id);
        assert_eq!(l.widget_side.events.borrow().len(), 1);
        assert_eq!(l.widget_side.events.borrow()[0].event_id, event_id);
        l.widget_side.events.borrow_mut().clear();

        // 5. Denied write is reported as a host error.
        let denied = l.client.send_state_event("m.room.topic", "", json!({"topic": "x"}));
        l.pump().await;
        assert!(matches!(denied.await, Err(matrix_widget_sdk::WidgetClientError::Host(_))));

        // 6. Sync delivers events (injected into the backend); only permitted ones reach the
        //    widget. A state event arrives as `forward_event` and as a state update.
        let topic = MatrixEvent {
            event_type: "m.room.topic".into(),
            sender: "@admin:example".into(),
            event_id: "$topic".into(),
            room_id: "!room:example".into(),
            origin_server_ts: 1,
            state_key: Some("".into()),
            content: json!({"topic": "widgets!"}).into(),
            unsigned: None,
        };
        l.backend.inject(topic.clone());
        let reaction = MatrixEvent { event_type: "m.reaction".into(), state_key: None, ..topic.clone() };
        l.backend.inject(reaction);
        l.pump().await;
        assert_eq!(l.widget_side.events.borrow().as_slice(), std::slice::from_ref(&topic));
        assert_eq!(l.widget_side.state_updates.borrow().as_slice(), &[vec![topic.clone()]]);
        // The widget acked, so the driver has nothing outstanding.
        assert!(l.host_side.to_widget.lock().unwrap().is_empty());

        // 7. Widget reads the timeline cache: only the topic change is readable. It asks for
        //    more, the client fetches older events (the test resolves the pagination), the widget
        //    is told and reads on below the topic.
        let read = l.client.read_timeline(ReadTimelineRequest::newest(5));
        l.pump().await;
        let page = read.await.unwrap();
        assert_eq!(page.events, vec![topic.clone()]);
        assert_eq!(page.pagination, PaginationStatus::Idle);
        let paginate = l.client.paginate_timeline(Some(5));
        l.pump().await;
        assert_eq!(paginate.await.unwrap(), PaginationStatus::Paginating);
        let older_topic = MatrixEvent { event_id: "$older".into(), ..topic.clone() };
        l.backend.resolve_pagination(vec![older_topic.clone()], true);
        l.pump().await;
        let status = |status| NotifyTimelineUpdateRequest {
            pagination: Some(TimelinePagination { status, error: None }),
            ..Default::default()
        };
        assert_eq!(
            l.widget_side.timeline_updates.borrow().as_slice(),
            [status(PaginationStatus::Paginating), status(PaginationStatus::StartReached)]
        );
        let read = l
            .client
            .read_timeline(ReadTimelineRequest { from: Some("$topic".into()), ..ReadTimelineRequest::newest(5) });
        l.pump().await;
        let page = read.await.unwrap();
        assert_eq!(page.events, vec![older_topic]);
        assert_eq!(page.pagination, PaginationStatus::StartReached);

        // 8. State changes: non-permitted types are dropped, a changed topic replaces the set.
        let name = MatrixEvent { event_type: "m.room.name".into(), ..topic.clone() };
        l.backend.inject(name);
        l.pump().await;
        assert_eq!(l.widget_side.state_updates.borrow().len(), 1);
        let topic2 = MatrixEvent { event_id: "$topic2".into(), content: json!({"topic": "more!"}).into(), ..topic };
        l.backend.inject(topic2.clone());
        l.pump().await;
        assert_eq!(l.widget_side.state_updates.borrow().last().unwrap(), &vec![topic2.clone()]);
        assert_eq!(l.widget_side.events.borrow().last().unwrap(), &topic2);
        assert!(l.host_side.to_widget.lock().unwrap().is_empty());
    });
}

#[test]
fn file_upload_and_download() {
    futures::executor::block_on(async {
        let l = Loop::new();
        let caps = vec![Capability::UploadFile, Capability::DownloadFile];
        let cap_fut = l.client.request_capabilities(caps.clone());
        l.pump().await;
        cap_fut.await.unwrap();
        l.driver.approve_capabilities(caps);
        l.pump().await;

        // base64 on the wire, bytes in the backend, the same base64 back.
        let file = matrix_widget_actions::Base64File::from_bytes(&[0, 1, 2, 255], Some("image/png".into()));
        let upload = l.client.upload_file(file.clone());
        l.pump().await;
        let content_uri = upload.await.unwrap().content_uri;
        let stored =
            matrix_widget_host_backend_interface::MatrixBackend::download_media(&*l.backend, content_uri.clone()).await;
        assert_eq!(stored.unwrap().data, vec![0, 1, 2, 255]);

        let download = l.client.download_file(content_uri);
        l.pump().await;
        assert_eq!(download.await.unwrap(), file);
    });
}

#[test]
fn openid_tokens_need_one_grant_each() {
    futures::executor::block_on(async {
        let l = Loop::new();
        let asked = || l.host_side.capability_requests.lock().unwrap().clone();

        // The widget does not hold the capability: the client requests it, the host asks.
        let first = l.client.request_openid_token();
        l.pump().await;
        assert_eq!(asked(), [vec![Capability::GetOpenId]]);
        l.driver.approve_capabilities(vec![Capability::GetOpenId]);
        l.pump().await;
        let token = first.await.unwrap();
        assert!(token.access_token.starts_with("openid-token-"));
        // The use ended the grant, and both sides know it.
        assert!(!l.client.has_capability(&Capability::GetOpenId));
        assert!(l.driver.snapshot().approved.is_empty());

        // The next token is asked about again; refused, there is none.
        let second = l.client.request_openid_token();
        l.pump().await;
        assert_eq!(asked().len(), 2);
        l.driver.approve_capabilities(vec![]);
        l.pump().await;
        assert_eq!(second.await, Err(matrix_widget_sdk::WidgetClientError::OpenIdBlocked));

        // "Always": auto-approved, it is granted again per token without asking.
        l.driver.set_auto_approved(vec![Capability::GetOpenId]);
        let a = l.client.request_openid_token();
        l.pump().await;
        let b = l.client.request_openid_token();
        l.pump().await;
        assert_ne!(a.await.unwrap(), b.await.unwrap());
        assert_eq!(asked().len(), 2);
        assert!(l.driver.snapshot().approved.is_empty());
    });
}
