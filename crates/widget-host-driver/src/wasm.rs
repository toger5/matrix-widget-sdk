//! JavaScript bindings. Exposed as the `WidgetHost` class when built with `wasm-pack`: a
//! [`WidgetHostDriver`] wired to an [`InMemoryBackend`], meant for test hosts and tooling, not for
//! a real client (which brings its own `MatrixBackend`).
//!
//! ```js
//! import init, { WidgetHost } from "widget-host-driver";
//! await init();
//! const host = new WidgetHost("!room:example.org", "@alice:example.org");
//! host.onSendToWidget((json) => iframe.contentWindow.postMessage(JSON.parse(json), widgetOrigin));
//! host.onCapabilitiesRequested((caps) => host.approveCapabilities(caps));
//! window.addEventListener("message", (ev) => {
//!   if (ev.source === iframe.contentWindow) host.handleMessageFromWidget(ev.data);
//! });
//! ```

use std::cell::RefCell;
use std::rc::Rc;
use std::sync::{Arc, Mutex};

use js_sys::{Function, Promise};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use widget_actions::{Capability, MatrixEvent};
use widget_matrix_backend::{BackendError, InMemoryBackend};

use crate::{WidgetHostDriver, WidgetHostPlatform};

/// What the driver asked the platform to do, recorded until JavaScript picks it up.
enum PlatformEvent {
    SendToWidget(String),
    CapabilitiesRequested(Vec<Capability>),
    ContentLoaded,
}

/// [`WidgetHostPlatform`] must be `Send + Sync` and JavaScript callbacks are neither, so the
/// platform only queues what happened and [`WidgetHost`] drains the queue after every driver
/// call and invokes the callbacks from there.
#[derive(Default)]
struct QueuePlatform {
    events: Mutex<Vec<PlatformEvent>>,
    /// `(client_id, client_theme, client_language)` reported by `client_context`.
    client: Mutex<(Option<String>, Option<String>, Option<String>)>,
}

impl QueuePlatform {
    fn push(&self, event: PlatformEvent) {
        self.events.lock().unwrap_or_else(|p| p.into_inner()).push(event);
    }

    fn client(&self) -> (Option<String>, Option<String>, Option<String>) {
        self.client.lock().unwrap_or_else(|p| p.into_inner()).clone()
    }
}

impl WidgetHostPlatform for QueuePlatform {
    fn send_to_widget(&self, json: String) {
        self.push(PlatformEvent::SendToWidget(json));
    }

    fn on_capabilities_requested(&self, requested: Vec<Capability>) {
        self.push(PlatformEvent::CapabilitiesRequested(requested));
    }

    fn on_content_loaded(&self) {
        self.push(PlatformEvent::ContentLoaded);
    }

    fn client_id(&self) -> Option<String> {
        self.client().0
    }

    fn client_theme(&self) -> Option<String> {
        self.client().1
    }

    fn client_language(&self) -> Option<String> {
        self.client().2
    }
}

#[derive(Default, Clone)]
struct Callbacks {
    send_to_widget: Option<Function>,
    capabilities_requested: Option<Function>,
    content_loaded: Option<Function>,
}

fn to_js<T: Serialize>(value: &T) -> JsValue {
    let ser = serde_wasm_bindgen::Serializer::json_compatible();
    value.serialize(&ser).unwrap_or(JsValue::UNDEFINED)
}

fn js_error(err: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&err.to_string()).into()
}

fn call(cb: &Option<Function>, arg: JsValue) {
    if let Some(cb) = cb {
        let _ = cb.call1(&JsValue::NULL, &arg);
    }
}

/// Deliver everything the driver queued to the JavaScript callbacks.
fn flush(platform: &QueuePlatform, callbacks: &RefCell<Callbacks>) {
    let events = std::mem::take(&mut *platform.events.lock().unwrap_or_else(|p| p.into_inner()));
    // Clone so a callback may register callbacks or call back into the host.
    let cb = callbacks.borrow().clone();
    for event in events {
        match event {
            PlatformEvent::SendToWidget(json) => call(&cb.send_to_widget, JsValue::from_str(&json)),
            PlatformEvent::CapabilitiesRequested(caps) => call(&cb.capabilities_requested, to_js(&caps)),
            PlatformEvent::ContentLoaded => call(&cb.content_loaded, JsValue::UNDEFINED),
        }
    }
}

/// A widget host driver plus in-memory Matrix room, for JavaScript.
#[wasm_bindgen]
pub struct WidgetHost {
    driver: Arc<WidgetHostDriver>,
    backend: Arc<InMemoryBackend>,
    platform: Arc<QueuePlatform>,
    callbacks: Rc<RefCell<Callbacks>>,
}

#[wasm_bindgen]
impl WidgetHost {
    /// Create a host for one widget living in `roomId`, acting as `userId`.
    #[wasm_bindgen(constructor)]
    pub fn new(room_id: String, user_id: String) -> WidgetHost {
        let backend = Arc::new(InMemoryBackend::new(room_id, user_id));
        let platform = Arc::new(QueuePlatform::default());
        let driver = WidgetHostDriver::new(backend.clone(), platform.clone());
        WidgetHost { driver, backend, platform, callbacks: Rc::default() }
    }

    /// `(json: string) => void`: deliver this JSON to the widget window with `postMessage`.
    #[wasm_bindgen(js_name = onSendToWidget)]
    pub fn on_send_to_widget(&self, callback: Option<Function>) {
        self.callbacks.borrow_mut().send_to_widget = callback;
    }

    /// `(requested: string[]) => void`: the widget asked for capabilities. Decide, then call
    /// [`approveCapabilities`](Self::approve_capabilities) with the approved subset.
    #[wasm_bindgen(js_name = onCapabilitiesRequested)]
    pub fn on_capabilities_requested(&self, callback: Option<Function>) {
        self.callbacks.borrow_mut().capabilities_requested = callback;
    }

    /// `() => void`: the widget sent `content_loaded` and may be shown.
    #[wasm_bindgen(js_name = onContentLoaded)]
    pub fn on_content_loaded(&self, callback: Option<Function>) {
        self.callbacks.borrow_mut().content_loaded = callback;
    }

    /// Feed a message received from the widget window (`event.data`, string or object). Resolves
    /// once handled; rejects with the driver error when the message is not for this driver
    /// (not a widget message, legacy widget, wrong direction, unexpected response).
    #[wasm_bindgen(js_name = handleMessageFromWidget)]
    pub fn handle_message_from_widget(&self, message: JsValue) -> Promise {
        let json = match message.as_string() {
            Some(s) => s,
            None => match js_sys::JSON::stringify(&message) {
                Ok(s) => s.as_string().unwrap_or_default(),
                Err(e) => return Promise::reject(&e),
            },
        };
        let (driver, platform, callbacks) = (self.driver.clone(), self.platform.clone(), self.callbacks.clone());
        future_to_promise(async move {
            let result = driver.handle_message_from_widget(json).await;
            flush(&platform, &callbacks);
            result.map(|_| JsValue::UNDEFINED).map_err(js_error)
        })
    }

    /// Complete a pending capability negotiation with the approved capability strings.
    #[wasm_bindgen(js_name = approveCapabilities)]
    pub fn approve_capabilities(&self, approved: Vec<String>) {
        self.driver.approve_capabilities(approved.iter().map(|c| Capability::parse(c)).collect());
        flush(&self.platform, &self.callbacks);
    }

    /// Store a Matrix event in the room as if it arrived from sync and offer it to the widget.
    /// Returns whether the widget had a capability to receive it.
    #[wasm_bindgen(js_name = injectEvent)]
    pub fn inject_event(&self, event: JsValue) -> Result<bool, JsValue> {
        let event: MatrixEvent = serde_wasm_bindgen::from_value(event).map_err(js_error)?;
        let forwarded = self.driver.on_matrix_event(self.backend.inject(event));
        flush(&self.platform, &self.callbacks);
        Ok(forwarded)
    }

    /// Push the room's current state to the widget (`update_state`, filtered by capabilities).
    /// Returns the number of state events sent.
    #[wasm_bindgen(js_name = pushState)]
    pub fn push_state(&self) -> u32 {
        let sent = self.driver.on_state_update(self.backend.state());
        flush(&self.platform, &self.callbacks);
        sent
    }

    /// Timeline events stored in the room, oldest first.
    #[wasm_bindgen(getter)]
    pub fn timeline(&self) -> JsValue {
        to_js(&self.backend.timeline())
    }

    /// Current state events stored in the room.
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> JsValue {
        to_js(&self.backend.state())
    }

    /// `{ content_loaded, approved, pending_requested }`.
    #[wasm_bindgen(getter)]
    pub fn snapshot(&self) -> JsValue {
        to_js(&self.driver.snapshot())
    }

    /// What `client_context` reports. All three default to absent.
    #[wasm_bindgen(js_name = setClientContext)]
    pub fn set_client_context(&self, client_id: Option<String>, theme: Option<String>, language: Option<String>) {
        *self.platform.client.lock().unwrap_or_else(|p| p.into_inner()) = (client_id, theme, language);
    }

    /// Forget all stored events.
    #[wasm_bindgen(js_name = clearStore)]
    pub fn clear_store(&self) {
        self.backend.clear();
    }

    /// Make every send from the widget fail with `message`, or succeed again when omitted.
    #[wasm_bindgen(js_name = failSends)]
    pub fn fail_sends(&self, message: Option<String>) {
        self.backend.set_fail_sends(message.map(BackendError::other));
    }
}
