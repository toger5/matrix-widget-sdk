//! End to end: a `WidgetClient` (widget side) talking to a `WidgetHostDriver` (host side) with
//! an `InMemoryBackend`, connected through in-memory queues instead of `postMessage`.

use std::cell::RefCell;
use std::collections::VecDeque;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use serde_json::json;
use widget_actions::{Capability, MatrixEvent, StateKeySelector};
use widget_base_sdk::{WidgetClient, WidgetDelegate};
use widget_host_driver::{WidgetHostDriver, WidgetHostPlatform};
use widget_matrix_backend::InMemoryBackend;

/// Widget -> host queue plus what the widget app observed.
#[derive(Default)]
struct WidgetSide {
    to_host: RefCell<VecDeque<String>>,
    events: RefCell<Vec<MatrixEvent>>,
    state_updates: RefCell<Vec<Vec<MatrixEvent>>>,
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
    fn on_capabilities_changed(&self, _requested: Vec<Capability>, approved: Vec<Capability>) {
        *self.approved.borrow_mut() = approved;
    }
}

/// Host -> widget queue plus what the client UI observed.
#[derive(Default)]
struct HostSide {
    to_widget: Mutex<VecDeque<String>>,
    capability_requests: Mutex<Vec<Vec<Capability>>>,
    content_loaded: Mutex<bool>,
}

impl WidgetHostPlatform for HostSide {
    fn send_to_widget(&self, json: String) {
        self.to_widget.lock().unwrap().push_back(json);
    }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) {
        self.capability_requests.lock().unwrap().push(requested);
    }
    fn on_content_loaded(&self) {
        *self.content_loaded.lock().unwrap() = true;
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
        let backend = Arc::new(InMemoryBackend::new("!room:example", "@user:example"));
        let driver = WidgetHostDriver::new(backend.clone(), host_side.clone());
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
            Capability::receive_event("m.room.message"),
            Capability::receive_state_event("m.room.topic", None::<&str>),
            Capability::send_state_event("m.room.topic", Some("")),
        ];
        let cap_fut = l.client.request_capabilities(caps.clone());
        l.pump().await;
        cap_fut.await.unwrap();
        assert_eq!(l.host_side.capability_requests.lock().unwrap().as_slice(), std::slice::from_ref(&caps));
        assert!(l.client.state().approved.is_empty());

        // 2. The user approves all but the topic write.
        let approved: Vec<Capability> = caps.iter().take(3).cloned().collect();
        l.driver.approve_capabilities(approved.clone());
        l.pump().await;
        assert_eq!(l.client.state().approved, approved);
        assert_eq!(*l.widget_side.approved.borrow(), approved);
        assert_eq!(l.driver.snapshot().approved, approved);

        // 3. content_loaded
        let loaded = l.client.content_loaded();
        l.pump().await;
        loaded.await.unwrap();
        assert!(*l.host_side.content_loaded.lock().unwrap());
        assert!(l.client.state().content_loaded);

        // 4. Widget sends a message; it lands in the backend.
        let send = l.client.send_event("m.room.message", json!({"msgtype": "m.text", "body": "hello"}));
        l.pump().await;
        let sent = send.await.unwrap();
        assert_eq!(sent.room_id, "!room:example");
        assert_eq!(l.backend.timeline()[0].event_id, sent.event_id);

        // 5. Denied write is reported as a host error.
        let denied = l.client.send_state_event("m.room.topic", "", json!({"topic": "x"}));
        l.pump().await;
        assert!(matches!(denied.await, Err(widget_base_sdk::WidgetClientError::Host(_))));

        // 6. Sync delivers events; only permitted ones reach the widget.
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
        assert!(l.driver.on_matrix_event(topic.clone()));
        let reaction = MatrixEvent { event_type: "m.reaction".into(), state_key: None, ..topic.clone() };
        assert!(!l.driver.on_matrix_event(reaction));
        l.pump().await;
        assert_eq!(l.widget_side.events.borrow().as_slice(), std::slice::from_ref(&topic));
        // The widget acked, so the driver has nothing outstanding.
        assert!(l.host_side.to_widget.lock().unwrap().is_empty());

        // 7. Widget reads state through the host.
        let read = l.client.read_state("m.room.topic", StateKeySelector::Any);
        l.pump().await;
        assert_eq!(read.await.unwrap(), vec![topic.clone()]);

        // 8. Host pushes a state snapshot; non-permitted types are dropped.
        let name = MatrixEvent { event_type: "m.room.name".into(), ..topic.clone() };
        assert_eq!(l.driver.on_state_update(vec![topic.clone(), name]), 1);
        l.pump().await;
        assert_eq!(l.widget_side.state_updates.borrow().as_slice(), &[vec![topic]]);
    });
}
