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
//! await api.requestCapabilities(["widget:org.matrix.mscXXXX.send_event.timeline:m.room.message"]);
//! await api.notifyReady();
//! await api.sendEvent("m.room.message", { msgtype: "m.text", body: "hi" });
//! ```
//!
//! The constructor [`WidgetApi::new`] is kept as a test anchor: it takes a `sendToHost` callback
//! instead of a window, so the protocol can be driven from a JavaScript test without an iframe.
//!
//! Warnings, errors and Rust panics are written to the console once the module is loaded;
//! `initLogging("debug")` shows more (see the `logging` module).

mod logging;

use std::cell::RefCell;
use std::future::Future;
use std::rc::{Rc, Weak};

use js_sys::{Function, Promise};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::Value;
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::future_to_promise;
use widget_actions::{
    Base64File, Capability, DelegateRtcLivekitDelayedLeaveRequest, GetRtcLivekitTokenRequest, MatrixEvent,
    ReadEventsRequest, ReadRelationsRequest, StateKeySelector, ToDeviceEvent, TurnServer, UpdateDelayedEventAction,
    ACTION_TIMEOUT_MS,
};

use crate::{WidgetClient, WidgetClientError, WidgetDelegate};

#[derive(Default)]
struct Callbacks {
    on_event: Option<Function>,
    on_state_update: Option<Function>,
    on_to_device_message: Option<Function>,
    on_turn_server: Option<Function>,
    on_theme_change: Option<Function>,
    on_language_change: Option<Function>,
    on_visibility_change: Option<Function>,
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
    /// The client this delegate belongs to, for the request timeouts.
    client: RefCell<Weak<WidgetClient>>,
}

fn to_js<T: Serialize>(value: &T) -> JsValue {
    let ser = serde_wasm_bindgen::Serializer::json_compatible();
    value.serialize(&ser).unwrap_or_else(|e| {
        log::error!("could not convert a value for JavaScript, passing `undefined`: {e}");
        JsValue::UNDEFINED
    })
}

/// Call a callback of the widget. What it throws is logged: there is no caller to rethrow to.
fn call(name: &str, cb: &Option<Function>, arg: JsValue) {
    if let Some(cb) = cb {
        if let Err(e) = cb.call1(&JsValue::NULL, &arg) {
            log::warn!("the {name} callback threw: {}", describe(&e));
        }
    }
}

/// A thrown JavaScript value as text: the message of an `Error`, else its string form.
fn describe(value: &JsValue) -> String {
    match value.dyn_ref::<js_sys::Error>() {
        Some(error) => String::from(error.to_string()),
        None => value.as_string().unwrap_or_else(|| format!("{value:?}")),
    }
}

impl WidgetDelegate for JsDelegate {
    /// Deliver one widget API message to the host.
    ///
    /// On the `postMessage` transport the JSON is parsed first so the host receives a structured
    /// object in `event.data`, as MSC4412 requires. Delivery errors (detached parent, closed
    /// window) are logged: there is nobody left to report them to.
    fn send_to_host(&self, json: String) {
        match &self.transport {
            Transport::PostMessage { target, origin } => {
                let message = js_sys::JSON::parse(&json).unwrap_or_else(|_| JsValue::from_str(&json));
                if let Err(e) = target.post_message(&message, origin) {
                    log::warn!("could not post a message to the host: {}", describe(&e));
                }
            }
            Transport::Callback(callback) => {
                if let Err(e) = callback.call1(&JsValue::NULL, &JsValue::from_str(&json)) {
                    log::warn!("the sendToHost callback threw: {}", describe(&e));
                }
            }
        }
    }

    /// Start the 10 second timeout of MSC4412 with the global `setTimeout` (window or worker).
    fn on_request_sent(&self, request_id: &str) {
        let client = self.client.borrow().clone();
        let request_id = request_id.to_owned();
        let expire = Closure::once_into_js(move || {
            if let Some(client) = client.upgrade() {
                client.timeout_request(&request_id);
            }
        });
        let set_timeout = js_sys::Reflect::get(&js_sys::global(), &JsValue::from_str("setTimeout"));
        let started = match set_timeout.map(|f| f.dyn_into::<Function>()) {
            Ok(Ok(set_timeout)) => {
                set_timeout.call2(&JsValue::NULL, &expire, &JsValue::from_f64(ACTION_TIMEOUT_MS as f64)).is_ok()
            }
            _ => false,
        };
        if !started {
            log::warn!("no `setTimeout` here: requests the host does not answer never time out");
        }
    }

    fn on_matrix_event(&self, event: MatrixEvent) {
        call("onEvent", &self.callbacks.borrow().on_event, to_js(&event));
    }

    fn on_state_update(&self, state: Vec<MatrixEvent>) {
        call("onStateUpdate", &self.callbacks.borrow().on_state_update, to_js(&state));
    }

    fn on_to_device_message(&self, message: ToDeviceEvent) {
        call("onToDeviceMessage", &self.callbacks.borrow().on_to_device_message, to_js(&message));
    }

    fn on_turn_server(&self, server: TurnServer) {
        call("onTurnServer", &self.callbacks.borrow().on_turn_server, to_js(&server));
    }

    fn on_theme_change(&self, theme: Value) {
        call("onThemeChange", &self.callbacks.borrow().on_theme_change, to_js(&theme));
    }

    fn on_language_change(&self, lang: String) {
        call("onLanguageChange", &self.callbacks.borrow().on_language_change, JsValue::from_str(&lang));
    }

    fn on_visibility_change(&self, visible: bool) {
        call("onVisibilityChange", &self.callbacks.borrow().on_visibility_change, JsValue::from_bool(visible));
    }

    fn on_capabilities_changed(&self, allowed: Vec<Capability>) {
        let cb = self.callbacks.borrow().on_capabilities_changed.clone();
        call("onCapabilitiesChanged", &cb, to_js(&allowed));
    }
}

fn js_error(err: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&err.to_string()).into()
}

/// Deserialize a JavaScript argument and pass it to `f`. A value of the wrong shape rejects.
fn with_arg<T: DeserializeOwned>(value: JsValue, f: impl FnOnce(T) -> Promise) -> Promise {
    match serde_wasm_bindgen::from_value(value) {
        Ok(value) => f(value),
        Err(e) => Promise::reject(&js_error(e)),
    }
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
        let delegate = Rc::new(JsDelegate {
            transport,
            callbacks: RefCell::new(Callbacks::default()),
            client: RefCell::new(Weak::new()),
        });
        let client = Rc::new(WidgetClient::new(delegate.clone()));
        *delegate.client.borrow_mut() = Rc::downgrade(&client);
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
            // What is wrong with the message has been logged by the client.
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

    /// Register a callback for TURN credentials (`{ uris, username, password }`) while watching
    /// them (`watchTurnServers`).
    #[wasm_bindgen(js_name = onTurnServer)]
    pub fn on_turn_server(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_turn_server = callback;
    }

    /// Register a callback for `update_theme` (receives the client's theme object).
    #[wasm_bindgen(js_name = onThemeChange)]
    pub fn on_theme_change(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_theme_change = callback;
    }

    /// Register a callback for `update_language` (receives the BCP 47 tag).
    #[wasm_bindgen(js_name = onLanguageChange)]
    pub fn on_language_change(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_language_change = callback;
    }

    /// Register a callback for `update_visibility` (receives a boolean).
    #[wasm_bindgen(js_name = onVisibilityChange)]
    pub fn on_visibility_change(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_visibility_change = callback;
    }

    /// Register a callback `(allowed: string[]) => void` invoked when the host sends
    /// `update_capabilities`. `allowed` is the full list the widget holds now; it can grow
    /// (granted) and shrink (taken away by the host).
    #[wasm_bindgen(js_name = onCapabilitiesChanged)]
    pub fn on_capabilities_changed(&self, callback: Option<Function>) {
        self.delegate.callbacks.borrow_mut().on_capabilities_changed = callback;
    }

    /// `{ ready, pendingRequested, approved }`.
    #[wasm_bindgen(getter)]
    pub fn state(&self) -> JsValue {
        to_js(&self.client.state())
    }

    #[wasm_bindgen(js_name = hasCapability)]
    pub fn has_capability(&self, capability: String) -> bool {
        self.client.has_capability(&Capability::parse(&capability))
    }

    /// Tell the host that the widget is ready to be shown. Resolves once the host acknowledged
    /// `notify_ready`.
    #[wasm_bindgen(js_name = notifyReady)]
    pub fn notify_ready(&self) -> Promise {
        promise(self.client.notify_ready())
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
        with_arg(content, |content| promise(self.client.send_event(event_type, content)))
    }

    /// Resolves with `{ room_id, event_id }`.
    #[wasm_bindgen(js_name = sendStateEvent)]
    pub fn send_state_event(&self, event_type: String, state_key: String, content: JsValue) -> Promise {
        with_arg(content, |content| promise(self.client.send_state_event(event_type, state_key, content)))
    }

    /// Send a sticky event (MSC4407) kept for `durationMs`. Resolves with `{ room_id, event_id }`.
    #[wasm_bindgen(js_name = sendStickyEvent)]
    pub fn send_sticky_event(&self, event_type: String, content: JsValue, duration_ms: u32) -> Promise {
        with_arg(content, |content| promise(self.client.send_sticky_event(event_type, content, duration_ms.into())))
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
        with_arg(content, |content| {
            promise(self.client.send_delayed_event(event_type, state_key, content, delay_ms.into()))
        })
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
        with_arg(messages, |messages| promise(self.client.send_to_device(event_type, encrypted, messages)))
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

    /// Ask the client to open a `https://matrix.to/#/` permalink (MSC2931).
    #[wasm_bindgen(js_name = navigate)]
    pub fn navigate(&self, uri: String) -> Promise {
        promise(self.client.navigate(uri))
    }

    /// Ask the client to keep the widget on screen. Resolves with whether it will.
    #[wasm_bindgen(js_name = setAlwaysOnScreen)]
    pub fn set_always_on_screen(&self, value: bool) -> Promise {
        promise(self.client.set_always_on_screen(value))
    }

    /// Start receiving TURN credentials through `onTurnServer` (MSC3846).
    #[wasm_bindgen(js_name = watchTurnServers)]
    pub fn watch_turn_servers(&self) -> Promise {
        promise(self.client.watch_turn_servers())
    }

    /// Stop receiving TURN credentials.
    #[wasm_bindgen(js_name = unwatchTurnServers)]
    pub fn unwatch_turn_servers(&self) -> Promise {
        promise(self.client.unwatch_turn_servers())
    }

    /// Resolves with the homeserver's MatrixRTC transports (MSC4515), an array of objects.
    #[wasm_bindgen(js_name = getRtcTransports)]
    pub fn get_rtc_transports(&self) -> Promise {
        promise(self.client.get_rtc_transports())
    }

    /// Resolves with `{ limited, results: [{ user_id, display_name?, avatar_url? }] }` (MSC3973).
    #[wasm_bindgen(js_name = searchUserDirectory)]
    pub fn search_user_directory(&self, search_term: String, limit: Option<u32>) -> Promise {
        promise(self.client.search_user_directory(search_term, limit))
    }

    /// Resolves with the media config, e.g. `{ "m.upload.size": 52428800 }` (MSC4039).
    #[wasm_bindgen(js_name = getMediaConfig)]
    pub fn get_media_config(&self) -> Promise {
        promise(self.client.get_media_config())
    }

    /// Upload `data` (a `Uint8Array`) to the media repository; resolves with `{ content_uri }`
    /// (MSC4039). The bytes travel to the host as base64.
    #[wasm_bindgen(js_name = uploadFile)]
    pub fn upload_file(&self, data: Vec<u8>, mimetype: Option<String>) -> Promise {
        promise(self.client.upload_file(Base64File::from_bytes(&data, mimetype)))
    }

    /// Download an `mxc://` URI; resolves with `{ mimetype?, data: Uint8Array }` (MSC4039).
    #[wasm_bindgen(js_name = downloadFile)]
    pub fn download_file(&self, content_uri: String) -> Promise {
        let fut = self.client.download_file(content_uri);
        future_to_promise(async move {
            let file = fut.await.map_err(js_error)?;
            let data = file
                .to_bytes()
                .map_err(|e| JsValue::from(js_sys::Error::new(&format!("Invalid base64 file from the host: {e}"))))?;
            let result = js_sys::Object::new();
            if let Some(mimetype) = &file.mimetype {
                js_sys::Reflect::set(&result, &"mimetype".into(), &mimetype.into())?;
            }
            js_sys::Reflect::set(&result, &"data".into(), &js_sys::Uint8Array::from(data.as_slice()))?;
            Ok(result.into())
        })
    }

    /// Resolves with the room account data events of `eventType` (`[{ type, room_id, content }]`).
    #[wasm_bindgen(js_name = readRoomAccountData)]
    pub fn read_room_account_data(&self, event_type: String) -> Promise {
        promise(self.client.read_room_account_data(event_type))
    }

    /// Resolves with the LiveKit JWT (MSC4533). `request` is
    /// `{ server_name, url, room_id, slot_id, member_id }`.
    #[wasm_bindgen(js_name = getRtcLivekitToken)]
    pub fn get_rtc_livekit_token(&self, request: JsValue) -> Promise {
        with_arg(request, |request: GetRtcLivekitTokenRequest| promise(self.client.get_rtc_livekit_token(request)))
    }

    /// Hand a delayed leave to the client's LiveKit service (MSC4533). `request` is
    /// `{ url, room_id, slot_id, member_id, delay_id }`.
    #[wasm_bindgen(js_name = delegateRtcLivekitDelayedLeave)]
    pub fn delegate_rtc_livekit_delayed_leave(&self, request: JsValue) -> Promise {
        with_arg(request, |request: DelegateRtcLivekitDelayedLeaveRequest| {
            promise(self.client.delegate_rtc_livekit_delayed_leave(request))
        })
    }

    /// Resolves with `{ access_token, token_type, matrix_server_name, expires_in }` (MSC1960).
    /// Without `widget:…get_openid` it requests the capability first; the host usually asks the
    /// user and grants it for this one token. Rejects when refused. Calls while one is in progress
    /// share its token.
    #[wasm_bindgen(js_name = requestOpenIdToken)]
    pub fn request_openid_token(&self) -> Promise {
        promise(self.client.request_openid_token())
    }

    /// Resolves with `{ client_id?, client_theme?, client_language? }`. Needs `widget:…get_client_context`.
    #[wasm_bindgen(js_name = getClientContext)]
    pub fn get_client_context(&self) -> Promise {
        promise(self.client.get_client_context())
    }

    /// Resolves with `{ user_id, device_id, room_id, display_name, avatar_url, matrix_base_url }`.
    /// Needs `widget:…get_matrix_context`.
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
