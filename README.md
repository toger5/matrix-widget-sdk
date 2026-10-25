# matrix-widget-tools-sdk

Reusable Rust building blocks for Matrix widgets as proposed in
[MSC4411](https://github.com/matrix-org/matrix-spec-proposals/blob/toger5/widget-state-event/proposals/4411-widget-state-event.md)
(the `m.widget` state event) and
[MSC4412](https://github.com/matrix-org/matrix-spec-proposals/blob/dbkr/widget-base-postmessage-api/proposals/4412-widget-base-postmessage-api.md)
(the JSON action protocol spoken over `postMessage`).

The same core is meant to be used on both ends of the wire and from several languages:

```
 ┌──────────────── widget (iframe) ───────────────┐      ┌──────────────── host (Matrix client) ─────────────────┐
 │  your web app                                  │      │  client UI                 Matrix SDK                   │
 │     │  JS: WidgetApi (wasm-bindgen)            │      │     │ WidgetHostPlatform        │ MatrixBackend         │
 │     ▼                                          │ post │     ▼                           ▼                       │
 │  widget-base-sdk  ── WireMessage JSON ─────────┼──────┼──▶ widget-host-driver ──▶ widget-matrix-backend (trait) │
 │                   ◀────────────────────────────┼──────┼──                                                         │
 └────────────────────────────────────────────────┘      └─────────────────────────────────────────────────────────┘
                     └──────────── widget-actions: shared types ────────────┘
```

## Crates

| crate | runs on | purpose |
|---|---|---|
| [`widget-actions`](crates/widget-actions) | everywhere, optional UniFFI | Plain data types: the wire envelope, typed `Action` tree (`WidgetRequest`, `HostRequest`, ...), capability strings, `MatrixEvent`. No I/O, no state. |
| [`widget-base-sdk`](crates/widget-base-sdk) | widget side, wasm + JS | `WidgetClient`: tracks the session (capabilities, `content_loaded`), turns actions into async functions, answers host requests. On `wasm32` also exports the `WidgetApi` JS class wired to `window.parent.postMessage`. |
| [`widget-host-driver`](crates/widget-host-driver) | host side, optional UniFFI | `WidgetHostDriver`: one instance per rendered widget. Feed it widget messages, it performs the handshake, checks capabilities, calls the backend, subscribes to the room for the approved `receive.*` capabilities and answers. One callback (`send_to_widget`) carries JSON to the iframe. Also defines the `m.widget` state event content (MSC4411). Its `cdylib` carries the UniFFI scaffolding of all three host crates. |
| [`widget-matrix-backend`](crates/widget-matrix-backend) | host side, optional UniFFI | `MatrixBackend`: the trait a host implements once per Matrix SDK (send event, send state, read events, read state, subscribe to a room). Ships `InMemoryBackend` for tests and the browser test host. |
| [`uniffi-bindgen`](crates/uniffi-bindgen) | tooling | Binary that generates Kotlin / Swift / Python bindings for the crates above. |

Web packages (npm workspaces under `packages/`, see each README):

| package | what it is |
|---|---|
| [`widget-compat-wrapper`](packages/widget-compat-wrapper) | Hosted widget that wraps a legacy matrix-widget-api widget and speaks MSC4412 to the host. Lets a client drop its legacy widget code during the transition. |
| [`widget-host-bindings`](packages/widget-host-bindings) | The host crates as TypeScript + one wasm module, generated with uniffi-bindgen-react-native (`web` flavour). A JS client implements `MatrixBackend` / `WidgetHostPlatform` against these. |
| [`widget-host`](packages/widget-host) | Minimal browser host on `widget-host-bindings`: the driver on the in-memory backend, with a memory-store menu, a state event input and the legacy/new embedding decision. For manual and e2e testing. |
| [`test-widgets`](packages/test-widgets) | A legacy and an MSC4412 test widget with buttons for the basic actions and a log of what arrives. |

```sh
npm install
npm run wasm      # widget-base-sdk for the test widgets (needs wasm-pack)
npm run bindings  # host bindings via ubrn (needs wasm-bindgen-cli 0.2.129, see packages/widget-host-bindings)
npm run dev       # host on :5173, wrapper on :5174, widgets on :5175
npm test          # wrapper unit tests
```

## Protocol summary (MSC4412)

Every message is one JSON object:

```json5
{ "source": "widget" | "host", "action": "send_event", "requestId": "<uuid v4>", "version": "v1",
  "request": { ... } }            // or  "response": { ... }
```

* `source` names the side that *initiated* the exchange and is the same on request and response
  (`widget` ≙ legacy `fromWidget`, `host` ≙ legacy `toWidget`).
* Every request gets exactly one response with the same `requestId`; `{}` is a plain ack.
* Errors are answered with `"response": { "error": { "message": "..." } }`.
* A message without `version` comes from a pre-MSC4412 widget; the driver reports
  `DriverError::LegacyWidgetApi` so the host can fall back to its old implementation.

Actions implemented here:

| action | source | meaning | capability |
|---|---|---|---|
| `content_loaded` | widget | widget may be shown | none |
| `request_capabilities` | widget | ask for capabilities (acked at once, decision comes later) | none |
| `notify_capabilities` | host | `{ requested, approved }` after the user decided | – |
| `send_event` | widget | send a timeline/state event; `room_id` (own room only, needs `timeline:<room>`), `delay` (MSC4157, answers with `delay_id`), `sticky_duration_ms` (MSC4407) | `send.event:<type>[#<msgtype>]` / `send.state_event:<type>[#<key>]`, plus `org.matrix.msc4157.send.delayed_event` / `org.matrix.msc4407.send.sticky_event` |
| `org.matrix.msc4157.update_delayed_event` | widget | `{ delay_id, action: cancel \| restart \| send }` | `org.matrix.msc4157.update_delayed_event` |
| `send_event` | host | an event from sync (the driver's backend subscription) | `receive.event:<type>` / `receive.state_event:<type>[#<key>]` |
| `org.matrix.msc2876.read_events` | widget | read timeline (`limit`) or state (`state_key`: string or `true`) | `receive.*` |
| `update_state` | host | `{ state: [...] }` the current permitted state, on approval and after changes | `receive.state_event:*` |
| `org.matrix.msc4412.matrix_context` | widget | `{ user_id, device_id, room_id, display_name, avatar_url, matrix_base_url }`, replaces the legacy URL template parameters | `org.matrix.msc4412.matrix_context` |
| `org.matrix.msc4412.client_context` | widget | `{ client_id?, client_theme?, client_language? }` about the embedding client | `org.matrix.msc4412.client_context` |

Capability strings are parsed with both the stable `m.` and the unstable `org.matrix.msc2762.`
prefix and emitted with the unstable one (what deployed hosts understand). MSC4412 spells the
capability actions inconsistently; this code uses the MSC2974 names `request_capabilities` /
`notify_capabilities`.

## Using it

### Widget (JavaScript)

```sh
wasm-pack build crates/widget-base-sdk --target web --out-dir pkg
```

```js
import init, { WidgetApi } from "./pkg/widget_base_sdk.js";
await init();

const api = WidgetApi.connectToParent();            // posts to window.parent, filters by event.source
api.onEvent((ev) => render(ev));
api.onCapabilitiesChanged((requested, approved) => console.log(approved));

await api.requestCapabilities([
  "org.matrix.msc2762.send.event:m.room.message",
  "org.matrix.msc2762.receive.event:m.room.message",
]);
await api.contentLoaded();                          // host removes its spinner
const { event_id } = await api.sendEvent("m.room.message", { msgtype: "m.text", body: "hi" });
const history = await api.readEvents("m.room.message", 20);
const { user_id, room_id } = await api.getMatrixContext();   // needs org.matrix.msc4412.matrix_context
```

`new WidgetApi(sendToHost)` + `api.handleMessageFromHost(event.data)` is available when you want
to own the `postMessage` plumbing (e.g. to pin the host origin).

### Widget (Rust)

```rust
use std::rc::Rc;
use widget_base_sdk::{WidgetClient, WidgetDelegate};

struct Transport;                       // your postMessage / channel glue
impl WidgetDelegate for Transport {
    fn send_to_host(&self, json: String) { /* post to host */ }
}

let client = WidgetClient::new(Rc::new(Transport));
client.request_capabilities(vec![/* ... */]).await?;
client.content_loaded().await?;
// incoming:  client.handle_message_from_host(&json)?;
```

### Host (Rust)

```rust
use std::sync::Arc;
use widget_host_driver::{WidgetHostDriver, WidgetHostPlatform};

struct Platform { /* handle to the iframe */ }
impl WidgetHostPlatform for Platform {
    fn send_to_widget(&self, json: String) { /* iframe.postMessage(JSON.parse(json), widgetOrigin) */ }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) { /* prompt user, then driver.approve_capabilities(..) */ }
    fn on_content_loaded(&self) { /* hide spinner */ }
    // reported to widgets through `client_context`
    fn client_id(&self) -> Option<String> { Some("io.example.client".into()) }
    fn client_theme(&self) -> Option<String> { None }
    fn client_language(&self) -> Option<String> { None }
}

let backend: Arc<dyn MatrixBackend> = Arc::new(MyRustSdkBackend::new(room));
let driver = WidgetHostDriver::new(backend, Arc::new(Platform { .. }));
// granted without a prompt, e.g. for a legacy widget behind the compat wrapper:
driver.set_auto_approved(vec![Capability::MatrixContext, Capability::ClientContext]);

// from the iframe's message handler:
driver.handle_message_from_widget(json).await?;
// Events from sync are not pushed: once capabilities are approved the driver calls
// `backend.subscribe_room(room_id, subjects, sink)` and the backend feeds the sink.
```

`MatrixBackend::subscribe_room` is the one method with some substance: register listeners on
the room for the requested timeline and state event types, hand the sink the current set of
every requested state type right away, forward new timeline events as they arrive, and return a
`Subscription` whose `cancel` removes the listeners. `InMemoryBackend` is a complete example.

### Host (JavaScript via UniFFI + wasm)

```sh
npm run bindings      # packages/widget-host-bindings, see its README
```

```ts
import { uniffiInitAsync, InMemoryBackend, WidgetHostDriver } from "@matrix-widget-tools/widget-host-bindings";
await uniffiInitAsync();
const driver = new WidgetHostDriver(new InMemoryBackend(roomId, userId).asBackend(), {
  sendToWidget: (json) => iframe.contentWindow.postMessage(JSON.parse(json), widgetOrigin),
  onCapabilitiesRequested: (caps) => queueMicrotask(() => driver.approveCapabilities(caps)),
  onContentLoaded: () => (iframe.hidden = false),
  clientId: () => "io.example.client", clientTheme: () => "light", clientLanguage: () => "en",
});
window.addEventListener("message", (ev) => {
  if (ev.source === iframe.contentWindow) driver.handleMessageFromWidget(JSON.stringify(ev.data));
});
```

A real client replaces `InMemoryBackend` with its own `MatrixBackend` object (a matrix-js-sdk
backed one is the next step); `packages/widget-host` is the smallest complete host.

### Host (Kotlin / Swift / Python via UniFFI)

```sh
cargo build --release --features uniffi -p widget-host-driver
cargo run -p uniffi-bindgen -- generate --library target/release/libwidget_host_driver.dylib \
    --language kotlin --out-dir bindings/kotlin
```

The foreign side implements `MatrixBackend` (async operations, the synchronous identity getters
`room_id`, `user_id`, `device_id`, `display_name`, `avatar_url`, `base_url` that feed
`matrix_context`, and `subscribe_room`) and `WidgetHostPlatform`, then uses `WidgetHostDriver`
exactly like the Rust API above. Event payloads cross the FFI as JSON strings (`JsonValue`),
capabilities as their strings.

## Development

```sh
cargo test --workspace                                        # unit + loopback tests
cargo build --target wasm32-unknown-unknown -p widget-base-sdk
cargo build --features uniffi -p widget-host-driver           # FFI scaffolding compiles
npm run bindings && npm run build --workspaces --if-present   # ubrn bindings + web packages
```

`crates/widget-base-sdk/tests/loopback.rs` wires a `WidgetClient` to a `WidgetHostDriver` with an
`InMemoryBackend` and walks through the full lifecycle (capabilities → content_loaded → send →
receive → read → state update). It is the best place to see the whole protocol in motion.

## Not (yet) covered

* Legacy (`im.vector.modular.widgets`, versionless) widgets. The driver detects them and hands
  back `DriverError::LegacyWidgetApi`.
* Capabilities beyond MSC2762 event send/receive (TURN servers, room creation, ...). Unknown
  capability strings and actions are preserved as `Other` / `Unknown` so they can be layered on.
* A concrete `MatrixBackend` for matrix-rust-sdk or matrix-js-sdk. The trait is small on
  purpose; an implementation is a thin adapter around `Room::send_raw`,
  `Room::get_state_events`, a room event handler for `subscribe_room`, ...
