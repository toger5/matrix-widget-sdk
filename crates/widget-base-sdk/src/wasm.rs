//! JavaScript bindings. Exposed as the `WidgetApi` class when built with `wasm-pack`.
//!
//! MSC4412 fixes the transport: a widget always talks to its host through
//! `window.parent.postMessage`. [`WidgetApi::connect_to_parent`] therefore does the whole wiring
//! in Rust: it posts outgoing messages to the parent window and listens for `message` events
//! coming from it. Nothing needs to be glued together on the JavaScript side:
//!
//! ```js
//! import init, { WidgetApi } from "widget-base-sdk";
//! await init();
//! const api = WidgetApi.connectToParent();
//! api.onEvent((ev) => console.log("event", ev));
//! await api.requestCapabilities(["org.matrix.msc2762.send.event:m.room.message"]);
//! await api.contentLoaded();
//! await api.sendEvent("m.room.message", { msgtype: "m.text", body: "hi" });
//! ```
//!
//! The constructor [`WidgetApi::new`] is kept as a test anchor: it takes a `sendToHost` callback
//! instead of a window, so the protocol can be driven from a JavaScript test without an iframe.

use std::cell::RefCell;
use std::future::Future;
use std::rc::Rc;

use js_sys::{Function, Promise};
use serde::Serialize;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use widget_actions::{
    Capability, MatrixEvent, ReadEventsRequest, ReadRelationsRequest, StateKeySelector, ToDeviceEvent,
    UpdateDelayedEventAction,
};

use crate::{WidgetClient, WidgetClientError, WidgetDelegate};

#[derive(Default)]
struct Callbacks {
    on_event: Option<Function>,
    on_state_update: Option<Function>,
    on_to_device_message: Option<Function>,
    on_capabilities_changed: Option<Function>,
}

/// How outgoing messages leave the widget.
enum Transport {
    /// The production path (MSC4412): `target.postMessage(message, origin)`.
    PostMessage { target: web_sys::Window, origin: String },
    /// Test anchor: hand the JSON string to a JavaScript callback.
    Callback(Function),
}

/// The [`WidgetDelegate`] behind [`WidgetApi`]: owns the transport and the optional JavaScript
/// callbacks registered through `onEvent` & co.
struct JsDelegate {
    transport: Transport,
    callbacks: RefCell<Callbacks>,
}

fn to_js<T: Serialize>(value: &T) -> JsValue {
    let ser = serde_wasm_bindgen::Serializer::json_compatible();
    value.serialize(&ser).unwrap_or(JsValue::UNDEFINED)
}

fn call(cb: &Option<Function>, arg: JsValue) {
    if let Some(cb) = cb {
        let _ = cb.call1(&JsValue::NULL, &arg);
    }
}

impl WidgetDelegate for JsDelegate {
    /// Deliver one widget API message to the host.
    ///
    /// On the `postMessage` transport the JSON is parsed first so the host receives a structured
    /// object in `event.data`, as MSC4412 requires. Delivery errors (detached parent, closed
    /// window) are swallowed: there is nobody left to report them to.
    fn send_to_host(&self, json: String) {
        match &self.transport {
            Transport::PostMessage { target, origin } => {
                let message = js_sys::JSON::parse(&json).unwrap_or_else(|_| JsValue::from_str(&json));
                let _ = target.post_message(&message, origin);
            }
            Transport::Callback(callback) => {
                let _ = callback.call1(&JsValue::NULL, &JsValue::from_str(&json));
            }
        }
    }

    fn on_matrix_event(&self, event: MatrixEvent) {
        call(&self.callbacks.borrow().on_event, to_js(&event));
    }

    fn on_state_update(&self, state: Vec<MatrixEvent>) {
        call(&self.callbacks.borrow().on_state_update, to_js(&state));
    }

    fn on_to_device_message(&self, message: ToDeviceEvent) {
        call(&self.callbacks.borrow().on_to_device_message, to_js(&message));
    }

    fn on_capabilities_changed(&self, requested: Vec<Capability>, approved: Vec<Capability>) {
        let cb = self.callbacks.borrow().on_capabilities_changed.clone();
        if let Some(cb) = cb {
            let _ = cb.call2(&JsValue::NULL, &to_js(&requested), &to_js(&approved));
        }
    }
}

fn js_error(err: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&err.to_string()).into()
}

fn promise<T: Serialize>(fut: impl Future<Output = Result<T, WidgetClientError>> + 'static) -> Promise {
    future_to_promise(async move { fut.await.map(|v| to_js(&v)).map_err(js_error) })
}

/// Widget side entry point for JavaScript.
///
/// Create it with [`connectToParent`](Self::connect_to_parent) in a real widget, or with the
/// constructor when you want to drive the protocol yourself (tests, tooling).
#[wasm_bindgen]
pub struct WidgetApi {
    client: Rc<WidgetClient>,
    delegate: Rc<JsDelegate>,
}

impl WidgetApi {
    fn with_transport(transport: Transport) -> WidgetApi {
        let delegate = Rc::new(JsDelegate { transport, callbacks: RefCell::new(Callbacks::default()) });
        let client = Rc::new(WidgetClient::new(delegate.clone()));
        WidgetApi { client, delegate }
    }
}

#[wasm_bindgen]
impl WidgetApi {
    /// Test anchor: create an API whose outgoing messages are handed to `sendToHost` as JSON
    /// strings instead of being posted to a window. Incoming messages must be passed to
    /// [`handleMessageFromHost`](Self::handle_message_from_host) by the caller.
    ///
    /// This lets a JavaScript test (or a host that embeds the widget without an iframe) act as
    /// the host. Real widgets use [`connectToParent`](Self::connect_to_parent).
    #[wasm_bindgen(constructor)]
    pub fn new(send_to_host: Function) -> WidgetApi {
        WidgetApi::with_transport(Transport::Callback(send_to_host))
    }

    /// Create an API wired to `window.parent` as MSC4412 prescribes: outgoing messages are
    /// delivered with `parent.postMessage(message, targetOrigin)` and incoming `message` events
    /// are accepted only if their `source` is the parent window. No further setup is needed.
    ///
    /// `targetOrigin` restricts which origin may receive the widget's messages. It defaults to
    /// `"*"`; pass the host's origin when you know it.
    ///
    /// Fails when there is no window or the page is not embedded (no parent).
    #[wasm_bindgen(js_name = connectToParent)]
    pub fn connect_to_parent(target_origin: Option<String>) -> Result<WidgetApi, JsValue> {
        let window = web_sys::window().ok_or_else(|| js_error("no window"))?;
        let parent = window.parent()?.ok_or_else(|| js_error("no parent window"))?;
        let origin = target_origin.unwrap_or_else(|| "*".to_owned());

        let api = WidgetApi::with_transport(Transport::PostMessage { target: parent.clone(), origin });

        let client = api.client.clone();
        let listener = Closure::<dyn Fn(web_sys::MessageEvent)>::new(move |event: web_sys::MessageEvent| {
            let Some(source) = event.source() else { return };
            if !js_sys::Object::is(&source, &parent) {
                return;
            }
            let _ = handle(&client, event.data());
        });
        window.add_event_listener_with_callback("message", listener.as_ref().unchecked_ref())?;
        listener.forget();

        Ok(api)
    }

    /// Feed a message from the host. Accepts the JSON string or the already parsed object
    /// (`event.data`). Throws if the message is not a valid widget API message for this widget.
    ///
    /// Only needed together with the constructor; `connectToParent` installs its own listener.
    #[wasm_bindgen(js_name = handleMessageFromHost)]
    pub fn handle_message_from_host(&self, message: JsValue) -> Result<(), JsValue> {
        handle(&self.client, message)
    }

    /// Register a callback for room events forwarded by the host.
    #[wasm_bindgen(js_name = onEvent)]
    pub fn on_event(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_event = callback;
    }

    /// Register a callback for `update_state` pushes (receives an array of state events).
    #[wasm_bindgen(js_name = onStateUpdate)]
    pub fn on_state_update(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_state_update = callback;
    }

    /// Register a callback for to-device messages forwarded by the host
    /// (`{ type, sender, content, encrypted }`).
    #[wasm_bindgen(js_name = onToDeviceMessage)]
    pub fn on_to_device_message(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_to_device_message = callback;
    }

    /// Register a callback `(requested: string[], approved: string[]) => void` invoked when a
    /// capability negotiation completes.
    #[wasm_bindgen(js_name = onCapabilitiesChanged)]
    pub fn on_capabilities_changed(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_capabilities_changed = callback;
    }

    /// `{ contentLoaded, pendingRequested, approved }`.
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> JsValue {
        to_js(&self.client.state())
    }

    #[wasm_bindgen(js_name = hasCapability)]
    pub fn has_capability(&self, capability: String) -> bool {
        self.client.has_capability(&Capability::parse(&capability))
    }

    /// Resolves once the host acknowledged `content_loaded`.
    #[wasm_bindgen(js_name = contentLoaded)]
    pub fn content_loaded(&self) -> Promise {
        promise(self.client.content_loaded())
    }

    /// Resolves once the host acknowledged the request (not when it decided!). Listen with
    /// `onCapabilitiesChanged` or poll `state.approved` for the outcome.
    #[wasm_bindgen(js_name = requestCapabilities)]
    pub fn request_capabilities(&self, capabilities: Vec<String>) -> Promise {
        let caps = capabilities.iter().map(|c| Capability::parse(c)).collect();
        promise(self.client.request_capabilities(caps))
    }

    /// Resolves with `{ room_id, event_id }`.
    #[wasm_bindgen(js_name = sendEvent)]
    pub fn send_event(&self, event_type: String, content: JsValue) -> Promise {
        match serde_wasm_bindgen::from_value(content) {
            Ok(content) => promise(self.client.send_event(event_type, content)),
            Err(e) => Promise::reject(&js_error(e)),
        }
    }

    /// Resolves with `{ room_id, event_id }`.
    #[wasm_bindgen(js_name = sendStateEvent)]
    pub fn send_state_event(&self, event_type: String, state_key: String, content: JsValue) -> Promise {
        match serde_wasm_bindgen::from_value(content) {
            Ok(content) => promise(self.client.send_state_event(event_type, state_key, content)),
            Err(e) => Promise::reject(&js_error(e)),
        }
    }

    /// Send a sticky event (MSC4407) kept for `durationMs`. Resolves with `{ room_id, event_id }`.
    #[wasm_bindgen(js_name = sendStickyEvent)]
    pub fn send_sticky_event(&self, event_type: String, content: JsValue, duration_ms: u32) -> Promise {
        match serde_wasm_bindgen::from_value(content) {
            Ok(content) => promise(self.client.send_sticky_event(event_type, content, duration_ms.into())),
            Err(e) => Promise::reject(&js_error(e)),
        }
    }

    /// Schedule an event (MSC4157), a state event when `stateKey` is a string. Resolves with
    /// the delay id for `updateDelayedEvent`.
    #[wasm_bindgen(js_name = sendDelayedEvent)]
    pub fn send_delayed_event(
        &self,
        event_type: String,
        state_key: Option<String>,
        content: JsValue,
        delay_ms: u32,
    ) -> Promise {
        match serde_wasm_bindgen::from_value(content) {
            Ok(content) => promise(self.client.send_delayed_event(event_type, state_key, content, delay_ms.into())),
            Err(e) => Promise::reject(&js_error(e)),
        }
    }

    /// `action` is `"cancel"`, `"restart"` or `"send"` (MSC4157).
    #[wasm_bindgen(js_name = updateDelayedEvent)]
    pub fn update_delayed_event(&self, delay_id: String, action: String) -> Promise {
        let action = match action.as_str() {
            "cancel" => UpdateDelayedEventAction::Cancel,
            "restart" => UpdateDelayedEventAction::Restart,
            "send" => UpdateDelayedEventAction::Send,
            other => return Promise::reject(&js_error(format!("unknown delayed event action `{other}`"))),
        };
        promise(self.client.update_delayed_event(delay_id, action))
    }

    /// Send a to-device message (MSC3819). `messages` is `{ [userId]: { [deviceId]: content } }`.
    #[wasm_bindgen(js_name = sendToDevice)]
    pub fn send_to_device(&self, event_type: String, encrypted: bool, messages: JsValue) -> Promise {
        match serde_wasm_bindgen::from_value(messages) {
            Ok(messages) => promise(self.client.send_to_device(event_type, encrypted, messages)),
            Err(e) => Promise::reject(&js_error(e)),
        }
    }

    /// Resolves with an array of timeline events; `msgtype` narrows `m.room.message` reads.
    #[wasm_bindgen(js_name = readEvents)]
    pub fn read_events(&self, event_type: String, limit: Option<u32>, msgtype: Option<String>) -> Promise {
        let mut request = ReadEventsRequest::timeline(event_type, limit);
        request.msgtype = msgtype;
        promise(self.client.read_events_request(request))
    }

    /// Resolves with `{ chunk, next_batch?, prev_batch? }` (MSC3869).
    #[wasm_bindgen(js_name = readRelations)]
    pub fn read_relations(
        &self,
        event_id: String,
        rel_type: Option<String>,
        event_type: Option<String>,
        limit: Option<u32>,
    ) -> Promise {
        let mut request = ReadRelationsRequest::new(event_id);
        request.rel_type = rel_type;
        request.event_type = event_type;
        request.limit = limit;
        promise(self.client.read_relations(request))
    }

    /// Resolves with `{ access_token, token_type, matrix_server_name, expires_in }` once the host
    /// (and the user) allowed it; rejects when blocked. (MSC1960)
    #[wasm_bindgen(js_name = requestOpenIdToken)]
    pub fn request_openid_token(&self) -> Promise {
        promise(self.client.request_openid_token())
    }

    /// Resolves with `{ client_id?, client_theme?, client_language? }`. Needs `m.client_context`.
    #[wasm_bindgen(js_name = getClientContext)]
    pub fn get_client_context(&self) -> Promise {
        promise(self.client.get_client_context())
    }

    /// Resolves with `{ user_id, device_id, room_id, display_name, avatar_url, matrix_base_url }`.
    /// Needs `m.matrix_context`.
    #[wasm_bindgen(js_name = getMatrixContext)]
    pub fn get_matrix_context(&self) -> Promise {
        promise(self.client.get_matrix_context())
    }

    /// Resolves with an array of state events. `stateKey` is a string for one state key, or
    /// omitted / `true` for all state keys of the type.
    #[wasm_bindgen(js_name = readState)]
    pub fn read_state(&self, event_type: String, state_key: JsValue) -> Promise {
        let selector = match state_key.as_string() {
            Some(key) => StateKeySelector::key(key),
            None => StateKeySelector::Any,
        };
        promise(self.client.read_state(event_type, selector))
    }
}

fn handle(client: &WidgetClient, message: JsValue) -> Result<(), JsValue> {
    let json = match message.as_string() {
        Some(s) => s,
        None => js_sys::JSON::stringify(&message)?.as_string().ok_or_else(|| js_error("message is not JSON"))?,
    };
    client.handle_message_from_host(&json).map_err(js_error)
}
