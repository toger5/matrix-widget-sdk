# matrix-widget-sdk

> [!NOTE]
> This repository is created as a companion to the MSC's
> [MSC4411](https://github.com/matrix-org/matrix-spec-proposals/blob/toger5/widget-state-event/proposals/4411-widget-state-event.md)
> and [MSC4412](https://github.com/matrix-org/matrix-spec-proposals/blob/dbkr/widget-base-postmessage-api/proposals/4412-widget-base-postmessage-api.md)
> which define widgets without the quirks of the old api. So it tries to do a full reference implementation for the spec process.
> At the same time core architecture has been carefully crafted so that the actions are structured in a way so they are also helpful as
> documentation.
> A big part is proving the backwards compatibility approach via a wrapper widget.

Reusable Rust building blocks for Matrix widgets as proposed in
[MSC4411](https://github.com/matrix-org/matrix-spec-proposals/blob/toger5/widget-state-event/proposals/4411-widget-state-event.md)
(the `m.widget` state event) and
[MSC4412](https://github.com/matrix-org/matrix-spec-proposals/blob/dbkr/widget-base-postmessage-api/proposals/4412-widget-base-postmessage-api.md)
(the JSON action protocol spoken over `postMessage`).

This is an SDK in the true sense of the word—a toolkit consisting of several building blocks:
 - A rust library for the core widget action types
 - An SDK for buiding a widget webapp
 - An SDK that is used to simplify adding widget support for matrix clients
 - A test widget
 - A wrapper so convert legacy widgets into the "hopefully eventually specced" widget/action format
 - A widget test host

The same core is meant to be used on both ends of the wire and from several languages:

![Architecture](docs/diagrams/01-architecture.svg)

More diagrams (legacy widgets, wire format, the actions crate, capabilities, test setup) are in
[`docs/diagrams`](docs/diagrams/README.md).

## Crates

| crate | runs on | purpose |
|---|---|---|
| [`widget-actions`](crates/widget-actions) | everywhere, optional UniFFI | Plain data types: the wire envelope, typed `Action` tree (`WidgetRequest`, `HostRequest`, ...), capability strings, `MatrixEvent`. No I/O, no state. |
| [`widget-base-sdk`](crates/widget-base-sdk) | widget side, wasm + JS | `WidgetClient`: tracks the session (capabilities, `notify_ready`), turns actions into async functions, answers host requests. On `wasm32` also exports the `WidgetApi` JS class wired to `window.parent.postMessage`. |
| [`widget-host-driver`](crates/widget-host-driver) | host side, optional UniFFI | `WidgetHostDriver`: one instance per rendered widget. Feed it widget messages, it performs the handshake, checks capabilities, calls the backend, subscribes to the room for the approved `receive.*` capabilities and answers. Two callbacks reach the iframe: `load_iframe` says what to build (URL, `sandbox`, `allow`), `send_to_widget` carries JSON to it. Also reads the widget state events (MSC4411 `m.widget` and the legacy `im.vector.modular.widgets`): which are widgets, the URL check, the compat wrapper URL and the auto-approved set of a legacy widget. Its `cdylib` carries the UniFFI scaffolding of all three host crates. |
| [`widget-matrix-backend`](crates/widget-matrix-backend) | host side, optional UniFFI | `MatrixBackend`: the trait a host implements once per Matrix SDK, shaped after matrix-rust-rtc's (send room / state / sticky / delayed / to-device, read events / state / relations / account data, OpenID, TURN, RTC transports, user directory, media config, LiveKit; subscribe to the room, to-device messages and TURN credentials). Ships `InMemoryBackend` for tests and the browser test host. See [`docs/parity.md`](docs/parity.md). |
| [`widget-logging`](crates/widget-logging) | bindings only | The logger the bindings install: `RUST_LOG`-style filter, platform log output, optional host sink. See [Logging](#logging). |
| [`uniffi-bindgen`](crates/uniffi-bindgen) | tooling | Binary that generates Kotlin / Swift / Python bindings for the crates above. |

Web packages (npm workspaces under `packages/`, see each README):

| package | what it is |
|---|---|
| [`widget-compat-wrapper`](packages/widget-compat-wrapper) | Hosted widget that wraps a legacy matrix-widget-api widget and speaks MSC4412 to the host. Lets a client drop its legacy widget code during the transition. |
| [`widget-host-bindings`](packages/widget-host-bindings) | The host crates as TypeScript + one wasm module, generated with uniffi-bindgen-react-native (`web` flavour). A JS client implements `MatrixBackend` / `WidgetHostPlatform` against these. |
| [`widget-host`](packages/widget-host) | Browser host on `widget-host-bindings`: one app that logs in with matrix-rust-sdk (matrix-js-sdk in a `js` build) and opens the widgets of your rooms, or runs on mocked in-memory rooms (the DevBackend, chosen on the login screen or by URL parameters), with per-widget dev tools and the legacy/new embedding decision. For debugging widgets and for manual and e2e testing. The design is in [`appDesign.md`](packages/widget-host/appDesign.md). |
| [`test-widgets`](packages/test-widgets) | A legacy and an MSC4412 test widget with buttons for the basic actions and a log of what arrives. |

```sh
npm install
npm run wasm      # widget-base-sdk for the test widgets (needs wasm-pack)
npm run bindings  # host bindings via ubrn (needs wasm-bindgen-cli 0.2.129, see packages/widget-host-bindings)
npm run dev       # host on :5173 (serves the compat wrapper at /widget_compatibility_wrapper/), widgets on :5175
npm test          # wrapper unit tests
```

## Protocol summary (MSC4412)

Every message ("action") is one JSON object, sent with `window.postMessage`:

```json5
{
  "source": "widget" | "host",
  "action": "org.matrix.mscXXXX.send_event",
  "request_id": "<uuid v4>",
  "request": { ... } // or  "response": { ... }
}
```

* `source` names the side that *initiated* the exchange and is the same on request and response
  (`widget` ≙ legacy `fromWidget`, `host` ≙ legacy `toWidget`).
* `action` is `<namespace>.<name>`: `m` once an action is in the spec, the unstable prefix of the
  MSC that defines it until then. This repository sends the unstable names and also accepts
  `m.<name>`. Actions that have no MSC yet use the placeholder `org.matrix.mscXXXX`.
* Every request gets exactly one response with the same `request_id`; `{}` is a plain ack. A
  message is a response if and only if it has `response`.
* Errors are answered with `"response": { "error": { "code": "...", "message": "..." } }`. `code`
  is machine readable: `org.matrix.msc4412.unknown_action`, `.missing_capability`,
  `.invalid_request` or `.unknown`; a code the receiver does not know counts as `unknown`. Failed
  Matrix requests use `org.matrix.mscXXXX.matrix_api_error` and add a `matrix_api_error` object
  (HTTP status, `errcode`, ...).
* A request that is not answered within 10 seconds has failed; a later response is ignored.
  Anything slower (asking the user) is split into two actions that are each acked at once, like
  `request_capabilities` / `update_capabilities`.
* There is no version property. A legacy (matrix-widget-api) message has `api` instead of
  `source`; the driver reports it as `DriverError::LegacyWidgetApi` so the host can load the widget
  through the compat wrapper or fall back to its old implementation.
* The host sends nothing before the widget has sent its first action.
* The widget state event says `uses_widget_api: true` when the widget speaks this API. The host
  then shows a loading state until `notify_ready` arrives (and an error after 15 seconds).

Actions implemented here:

| action | source | meaning | capability |
|---|---|---|---|
| `org.matrix.msc4412.notify_ready` | widget | the widget is ready to be shown | none (core action) |
| `org.matrix.msc4412.request_capabilities` | widget | `{ capabilities }`: ask for initial or additional capabilities, at any time. The ack grants nothing | none (core action) |
| `org.matrix.msc4412.update_capabilities` | host | `{ allowed }`: the full list of capabilities the widget holds now. Sent after a request was decided and when the host takes capabilities away (`driver.revoke_capabilities`) | none (core action) |
| `…send_event` | widget | send a timeline/state event; `room_id` (own room only), `delay` (MSC4157, answers with `delay_id`), `sticky_duration_ms` (MSC4407) | `widget:…send_event.timeline:<type>[#<msgtype>]` / `widget:…send_event.state:<type>[#<key>]`, plus `widget:…send_event.delayed` / `widget:…send_event.sticky` |
| `org.matrix.msc4157.update_delayed_event` | widget | `{ delay_id, action: cancel \| restart \| send }` | `widget:…update_delayed_event` |
| `…forward_event` | host | a new event from sync (the driver's backend subscription) | `host:…forward_event.timeline:<type>[#<msgtype>]` / `host:…forward_event.state:<type>[#<key>]` |
| `org.matrix.msc2876.read_events` | widget | read timeline (`limit`, `msgtype`, `since`) or state (`state_key`: string or `true`); `room_ids` (own room only) | `widget:…read_events.timeline:<type>[#<msgtype>]` / `widget:…read_events.state:<type>[#<key>]` |
| `org.matrix.msc3869.read_relations` | widget | `{ event_id, rel_type?, event_type?, limit?, from?, to?, direction? }` → `{ chunk, next_batch?, prev_batch? }` | results filtered by `widget:…read_relations:<type>[#<msgtype>]` |
| `…update_state` | host | `{ state: [...] }` the current permitted state, on approval and after changes | `host:…update_state:<type>[#<key>]` |
| `…send_to_device` | widget | `{ type, encrypted, messages: { user_id: { device_id: content } } }` | `widget:…send_to_device:<type>` |
| `…forward_to_device` | host | `{ type, sender, content, encrypted }` from the backend's to-device subscription | `host:…forward_to_device:<type>` |
| `…get_openid` | widget | `{}` → `{ access_token, token_type, matrix_server_name, expires_in }` (the OpenID token, at once) | `widget:…get_openid`, granted for one token: the request uses it up, `update_capabilities` follows without it (`driver.set_single_use`) |
| `…watch_turn_servers` / `…unwatch_turn_servers` | widget | start / stop `update_turn_servers` pushes | `host:…update_turn_servers` |
| `…update_turn_servers` | host | `{ uris, username, password }` from the backend's TURN subscription | `host:…update_turn_servers` |
| `org.matrix.msc4515.get_rtc_transports` | widget | `{}` → `{ rtc_transports: [...] }` | `widget:…get_rtc_transports` |
| `org.matrix.msc3973.search_user_directory` | widget | `{ search_term, limit? }` → `{ limited, results }` | `widget:…search_user_directory` |
| `org.matrix.msc4039.get_media_config` | widget | `{}` → `{ "m.upload.size"? }` | `widget:…get_media_config` |
| `org.matrix.msc4039.upload_file` | widget | `{ file: { mimetype?, base64 } }` → `{ content_uri }`; the backend gets raw bytes (`upload_media`) | `widget:…upload_file` |
| `org.matrix.msc4039.download_file` | widget | `{ content_uri }` → `{ file: { mimetype?, base64 } }` (`download_media`) | `widget:…download_file` |
| `com.beeper.read_room_account_data` | widget | `{ type, room_ids? }` → `{ events }` | `widget:…read_room_account_data:<type>` |
| `org.matrix.msc4533.get_rtc_livekit_token` | widget | `{ server_name, url, room_id, slot_id, member_id }` → `{ jwt }` | `widget:…get_rtc_livekit_token` |
| `org.matrix.msc4533.delegate_rtc_livekit_delayed_leave` | widget | `{ url, room_id, slot_id, member_id, delay_id }` → `{}` | `widget:…delegate_rtc_livekit_delayed_leave` |
| `org.matrix.msc2931.navigate` | widget | `{ uri }` (a `matrix.to` permalink) → `WidgetHostPlatform::navigate` | `widget:…navigate` |
| `…set_always_on_screen` | widget | `{ value }` → `{ success }` via `WidgetHostPlatform::set_always_on_screen` | `widget:…set_always_on_screen` |
| `…update_theme` / `…update_language` / `…update_visibility` | host | pushed by `driver.update_theme / update_language / update_visibility` | `host:…update_theme` / `host:…update_language` / `host:…update_visibility` |
| `…get_matrix_context` | widget | `{ user_id, device_id, room_id, display_name, avatar_url, matrix_base_url }`, replaces the legacy URL template parameters | `widget:…get_matrix_context` |
| `…get_client_context` | widget | `{ client_id?, client_theme?, client_language? }` about the embedding client | `widget:…get_client_context` |

`…` in the action column is the placeholder namespace `org.matrix.mscXXXX.` of actions that have
no MSC of their own yet.

Capabilities follow MSC4412 and the naming proposal in
[`docs/spec-appendix/capability-naming-proposal.md`](docs/spec-appendix/capability-naming-proposal.md):
one capability per action, written `source:action[.modifier][:data]`.

* `source` is who sends the action: `widget` for a request the widget may make, `host` for a
  subscription (the host sends the action whenever there is something to send).
* `action` is the value of the action's `action` property, namespace included. `…` in the
  capability column stands for that namespace:
  `widget:org.matrix.mscXXXX.send_event.timeline:m.room.message`,
  `widget:org.matrix.msc2876.read_events.state:m.room.topic`, `widget:org.matrix.msc2931.navigate`.
  The stable spelling `widget:m.navigate` is accepted as well. The same name under another
  namespace is another action, so `widget:org.matrix.mscXXXX.navigate` grants nothing.
* `send_event`, `read_events` and `forward_event` always carry `timeline` or `state`.
* No capability names a room: a widget acts in the room it is embedded in.
* A widget can only ask for more capabilities. Only the host removes them, by sending
  `update_capabilities` with a shorter list.
* The source `webview` is about no action but the widget's iframe: `webview:…sandbox:<token>` and
  `webview:…allow:<feature>`, one web token each (`webview:org.matrix.mscXXXX.allow:camera`). Every
  iframe starts strict (`sandbox="allow-scripts allow-same-origin"`, empty `allow`); the driver
  grants those two tokens without asking and `allow-top-navigation` never, builds the attributes
  from what the widget holds (`webview_attributes`) and hands them to the client
  (`WidgetHostPlatform::load_iframe`). A grant applies with a reload of the iframe
  ([`spec/patch/new/webview-capabilities.md`](spec/patch/new/webview-capabilities.md)).
* The matrix-widget-api capability names (`org.matrix.msc2762.send.event:<type>`, ...) and action
  names (`content_loaded`, `theme_change`, host `send_event`, any name without a namespace) are
  **not** understood by the driver. Legacy widgets run behind the
  [compat wrapper](packages/widget-compat-wrapper), which translates both.

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
api.onCapabilitiesChanged((allowed) => console.log(allowed));   // the full list, also after a revoke

await api.requestCapabilities([
  "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message",
  "widget:org.matrix.msc2876.read_events.timeline:m.room.message",   // readEvents()
  "host:org.matrix.mscXXXX.forward_event.timeline:m.room.message",   // onEvent()
  "widget:org.matrix.mscXXXX.get_matrix_context",
]);
await api.notifyReady();                            // host removes its spinner
const { event_id } = await api.sendEvent("m.room.message", { msgtype: "m.text", body: "hi" });
const history = await api.readEvents("m.room.message", 20);
const { user_id, room_id } = await api.getMatrixContext();   // the get_matrix_context action
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
client.notify_ready().await?;
// incoming:  client.handle_message_from_host(&json)?;
```

### Host (Rust)

```rust
use std::sync::Arc;
use widget_host_driver::{parse_widget_state_event, EmbedOptions, WidgetHostDriver, WidgetHostPlatform, WidgetIframe};

struct Platform { /* handle to the iframe */ }
impl WidgetHostPlatform for Platform {
    fn load_iframe(&self, iframe: WidgetIframe) { /* a new iframe from iframe.url, .sandbox, .allow, behind a loading state */ }
    fn send_to_widget(&self, json: String) { /* iframe.postMessage(JSON.parse(json), the WidgetIframe's origin) */ }
    fn on_capabilities_requested(&self, requested: Vec<Capability>) { /* prompt (the whole open question), then driver.approve_capabilities(..) */ }
    fn on_ready(&self) { /* hide the loading state */ }
    fn navigate(&self, uri: String) -> Result<(), PlatformError> { /* open the matrix.to link */ Ok(()) }
    fn set_always_on_screen(&self, value: bool) -> bool { value }
    // reported to widgets through `get_client_context`
    fn client_id(&self) -> Option<String> { Some("io.example.client".into()) }
    fn client_theme(&self) -> Option<String> { None }
    fn client_language(&self) -> Option<String> { None }
}

let backend: Arc<dyn MatrixBackend> = Arc::new(MyRustSdkBackend::new(room));
// The widget's state event; `Err(Refused)` for a widget that must not be loaded (the URL check).
let options = EmbedOptions { wrapper_url: Some("https://client.example/wrapper/".into()), ..Default::default() };
let widget = parse_widget_state_event(event_type, state_key, content, options.clone())?;
let driver = WidgetHostDriver::new(widget, options, backend, Arc::new(Platform { .. }))?;
// granted without a prompt: what the client remembers of earlier approvals. (A legacy widget runs
// behind the compat wrapper and gets a legacy client's set from the driver, `legacy_auto_approved()`.)
driver.set_auto_approved(remembered);
// granted for one use each (the default; `vec![]` keeps every grant). A time limit is your timer
// plus `driver.revoke_capabilities(..)`.
driver.set_single_use(vec![Capability::GetOpenId]);
driver.start();   // → load_iframe; again whenever webview capabilities change `sandbox` / `allow`

// from the message handler, for messages of the iframe built last:
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
import { uniffiInitAsync, InMemoryBackend, WidgetHostDriver, parseWidgetStateEvent } from "@matrix-widget-tools/widget-host-bindings";
await uniffiInitAsync();
const options = { wrapperUrl: "https://client.example/wrapper/", clientOrigin: location.origin, ownWidgetDirs: [], allowHttp: false };
const widget = parseWidgetStateEvent(event.type, event.state_key, event.content, options);   // throws WidgetEventError
let iframe, widgetOrigin;
const driver = new WidgetHostDriver(widget, options, new InMemoryBackend(roomId, userId).asBackend(), {
  loadIframe: ({ url, origin, sandbox, allow }) => {     // the first iframe, and a new one when sandbox / allow change
    iframe?.remove();
    iframe = Object.assign(document.createElement("iframe"), { src: url, allow, hidden: true });
    iframe.setAttribute("sandbox", sandbox);
    widgetOrigin = origin;
    container.append(iframe);
  },
  sendToWidget: (json) => iframe.contentWindow.postMessage(JSON.parse(json), widgetOrigin),
  onCapabilitiesRequested: (caps) => queueMicrotask(() => driver.approveCapabilities(caps)),
  onReady: () => (iframe.hidden = false),
  navigate: (uri) => { location.href = uri; },
  setAlwaysOnScreen: (value) => value,
  clientId: () => "io.example.client", clientTheme: () => "light", clientLanguage: () => "en",
});
window.addEventListener("message", (ev) => {
  if (ev.source === iframe?.contentWindow && ev.origin === widgetOrigin) driver.handleMessageFromWidget(JSON.stringify(ev.data));
});
driver.start();
```

The driver decides what the iframe loads and with which `sandbox` and `allow`: the widget's URL as
the URL check serialised it (for a legacy widget the compat wrapper), strict attributes unless the
widget holds webview capabilities. `parseWidgetStateEvent` and the constructor check the URL, also
against the client's own origin (`EmbedOptions.clientOrigin`); `embedUrlProblem` is that check
alone. A grant of a webview capability applies with a new iframe: the driver calls `loadIframe`
again and grants the reloaded page what it held without asking.

A real client replaces `InMemoryBackend` with its own `MatrixBackend` object (a matrix-js-sdk
backed one is the next step); `packages/widget-host` is the smallest complete host.

### Host (Kotlin / Swift / Python via UniFFI)

```sh
cargo build --release --features uniffi -p widget-host-driver
cargo run -p uniffi-bindgen -- generate --library target/release/libwidget_host_driver.dylib \
    --language kotlin --out-dir bindings/kotlin
```

The foreign side implements `MatrixBackend` (async operations, the synchronous identity getters
`room_id`, `own_user_id`, `own_device_id`, `display_name`, `avatar_url`, `base_url` that feed
`get_matrix_context`, and the synchronous `subscribe_room` / `subscribe_to_device` /
`subscribe_turn_servers`) and `WidgetHostPlatform`, then uses `WidgetHostDriver`
exactly like the Rust API above. Event payloads cross the FFI as JSON strings (`JsonValue`),
capabilities as their strings.

## Logging

All crates log through the Rust [`log`](https://docs.rs/log) facade. What is installed behind it
depends on how the code is used:

| you use | entry point | default without a call | records go to |
|---|---|---|---|
| widget, JavaScript (`widget-base-sdk` wasm) | `initLogging(level, filter?)` | `warn` | browser console |
| host, JavaScript (`widget-host-bindings`) | `setupLogging(LogConfig.create({ level }))` | `warn` | browser console, and a `LogSink` |
| host, Kotlin / Swift / Python | `setupLogging(LogConfig(level = ...))` | silent | logcat (tag `matrix-widget`) on Android, the unified log on iOS, stderr elsewhere, and a `LogSink` |
| any crate from Rust | your own logger (`env_logger`, `tracing-log`, ...) | silent | wherever that logger writes |
| compat wrapper page | `log_level=<level>` query parameter | `warn` | browser console, prefix `[widget-compat-wrapper]` |

On the web, warnings, errors and Rust panics therefore show up in the console with no setup. A
native host is silent until it calls `setupLogging`, because a library should not claim the
process-wide logger unasked; if the app installed a Rust logger first, that one is kept.

Levels mean the same everywhere:

| level | what |
|---|---|
| `error` | a bug in this SDK |
| `warn` | something was dropped or refused: a rejected message, a missing capability, a failed backend call, a request that timed out, a callback that threw |
| `info` | the lifecycle: ready, capabilities requested / approved / revoked / used up |
| `debug` | one line per message in either direction: action, kind and request id, never the body |
| `trace` | the message bodies as JSON. Bodies that carry credentials (OpenID and LiveKit tokens, TURN passwords) are replaced by `"<redacted>"` |

`filter` overrides the level per target in `RUST_LOG` syntax. Targets are Rust module paths and
match by prefix: `widget_host_driver`, `widget_matrix_backend`, `widget_base_sdk`.

```js
// widget
import init, { initLogging } from "widget-base-sdk";
await init();
initLogging("debug");                                      // or ("warn", "widget_base_sdk::client=trace")

// host (web)
import { LogConfig, LogLevel, setLogSink, setupLogging } from "@matrix-widget-tools/widget-host-bindings";
setupLogging(LogConfig.create({ level: LogLevel.Info, filter: "widget_host_driver::driver=trace" }));
setLogSink({ log: (record) => rageshake.append(`${record.target}: ${record.message}`) });   // optional
```

```kotlin
// host (Android); Swift and Python have the same three functions
setupLogging(LogConfig(level = LogLevel.DEBUG))            // then: adb logcat -s matrix-widget
setLogSink(object : LogSink {
    override fun log(record: LogRecord) = Timber.tag(record.target).d(record.message)
})
```

A `LogSink` receives every record that passes the filter; set `writeToSystem = false` if the
platform log should not get them as well. On native platforms the sink is called from one
dedicated thread, and records are dropped (and counted, `droppedLogRecordCount()`) when it cannot
keep up. `clearLogSink()` removes it. `logEvent(level, target, message)` writes a line of your own
into the same stream.

## Development

```sh
cargo test --workspace                                        # unit + loopback tests
cargo build --target wasm32-unknown-unknown -p widget-base-sdk
cargo build --features uniffi -p widget-host-driver           # FFI scaffolding compiles
npm run bindings && npm run build --workspaces --if-present   # ubrn bindings + web packages
```

`crates/widget-base-sdk/tests/loopback.rs` wires a `WidgetClient` to a `WidgetHostDriver` with an
`InMemoryBackend` and walks through the full lifecycle (capabilities → notify_ready → send →
receive → read → state update). It is the best place to see the whole protocol in motion.

Proposed changes to MSC4411/MSC4412 and drafts of new MSCs live in [`spec/patch`](spec/patch/README.md).

### Dev site (GitHub Pages)

CI builds a static site of the widget host and the test widgets (`npm run build:dev-site`,
[`scripts/build-dev-site.mjs`](scripts/build-dev-site.mjs)) and, once it is turned on, deploys it
from `main` to GitHub Pages: `https://<owner>.github.io/<repository>/`, for this repository
`https://toger5.github.io/matrix-widget-sdk/`. With it, the host and the test widgets can be tried
without a local setup.

| path | what |
|---|---|
| `/` | landing page with these links; `version.json`: commit, ref, build date, CI run |
| `host/` | the widget host on matrix-rust-sdk (the default build). `host/?mode=memory` opens the DevBackend with both test widgets |
| `host-js/` | the same on matrix-js-sdk |
| `widgets/new/`, `widgets/legacy/` | the test widgets. The hosts' examples and the DevBackend's widget form point here (`VITE_TEST_WIDGETS_URL`, see [the host's README](packages/widget-host/README.md#running)) |
| `host/widget_compatibility_wrapper/` | the compat wrapper, part of the host build |

The `web` job of [`.github/workflows/ci.yml`](.github/workflows/ci.yml) builds the site on every
run, after the tests. Once turned on (below), the `deploy-dev-site` job deploys it after `test` and
`web` passed, on a push to `main` and on Actions → CI → Run workflow on `main`. A pull request gets
the site as the artifact `dev-site` of its run (kept 7 days). It is built for the deployed path,
`/<repository>/` unless `DEV_SITE_BASE` (below) says otherwise, so unzip it into a folder of that
name: `unzip dev-site.zip -d /tmp/site/matrix-widget-sdk`, `python3 -m http.server 8088 -d /tmp/site`,
then open `http://localhost:8088/matrix-widget-sdk/`.

**Turning it on** (by hand, once; no secrets, nothing else to set up):

1. Settings → Pages → Build and deployment → Source: **GitHub Actions**. GitHub creates the
   environment `github-pages`, which only accepts deployments from the default branch; keep that.
2. Settings → Secrets and variables → Actions → Variables → New repository variable:
   `DEPLOY_DEV_SITE` = `true`. Only after step 1: without Pages the deploy job fails.
3. Push to `main` or run the workflow. The `deploy-dev-site` job shows the URL.

Until the variable is set, the deploy job is skipped and the workflow only builds (in forks too).
Deleting the variable turns deploying off again; Settings → Pages unpublishes the site. Optional:
the variable `DEV_SITE_BASE`, the path the site is served under (default `/<repository>/`); set it
to `/` when Pages has a custom domain.

**Locally:** after `npm run wasm`, `npm run bindings` and the matrix-rust-sdk bindings
(`npm run bindings -w packages/matrix-sdk-uniffi-js`):

```sh
npm run build:dev-site                          # dist/dev-site, served at /
python3 -m http.server 8088 -d dist/dev-site    # http://localhost:8088/
# as on Pages, under a sub-path:
SITE_BASE=/matrix-widget-sdk/ SITE_OUT=/tmp/site/matrix-widget-sdk npm run build:dev-site
python3 -m http.server 8088 -d /tmp/site        # http://localhost:8088/matrix-widget-sdk/
```

**What to know about it:**

- **Do not log in with an account you care about.** The host and the test widgets share one
  origin (the widgets run with `allow-same-origin`: the host refuses widgets of its own origin
  except these, its own, `ownWidgetDirs` in `packages/widget-host/src/lib/widgetEvents.ts`; the
  legacy test widget runs without it, the compat wrapper's rule for a widget of its own origin),
  and on `*.github.io` the site also shares it
  with every other GitHub Pages site of the same owner. Any page of that origin can read what the
  host stores in the browser: the access token and the encryption keys of a logged-in account. Use
  the DevBackend or a test account, or give the site a domain of its own. The landing page says
  the same.
- **Login** works as locally: the client registers itself with the homeserver's authorization
  server at login, with `host/oidc-callback.html` (or `host-js/…`) as redirect URI. Nothing is
  registered beforehand.
- **Compression:** GitHub Pages compresses `.wasm` with gzip on the fly (measured: a 14 KB
  `application/wasm` file on `mdn.github.io` is served with `content-encoding: gzip`, 14,139 →
  5,998 bytes). There is no brotli, and precompressed files do not help: Pages sets no custom
  headers. CDNs may skip compression above a size limit, so check the matrix-rust-sdk module (about
  20 MB; its name is in the browser's network panel) after the first deploy:
  `curl -sI -H 'Accept-Encoding: gzip, br' https://toger5.github.io/matrix-widget-sdk/host/assets/index_bg-<hash>.wasm | grep -iE '^content-(type|encoding|length)'`.
  It should say `application/wasm`; without compression a first visit downloads 20 MB.
- **No custom headers** are needed: nothing uses `SharedArrayBuffer`, so no COOP/COEP. Pages
  caches every file for 10 minutes.
- **Size:** about 36 MB per deployment (Pages allows 1 GB per site and about 100 GB of traffic a
  month). CI installs no binaryen, so its matrix-rust-sdk module skips the optional `wasm-opt` pass
  and is about 6% larger ([its README](packages/matrix-sdk-uniffi-js/README.md#build)).
- **Build time:** the matrix-rust-sdk bindings are cached. A change to the pin, the SDK additions
  or the build script rebuilds the whole SDK in CI, which takes long (not measured on GitHub's
  runners yet); the result is cached right after that step.

## Not (yet) covered

* **`screenshot`** (host → widget, `m.capability.screenshot`): **intentionally not supported**
  and will not be added. The capability is no longer modelled (it parses as `Capability::Other`)
  and neither the driver nor the compat wrapper handles the action.
* **`m.sticker`** (widget → host, `m.sticker`): **not supported**. The action is unknown to the
  driver and `m.sticker` parses as `Capability::Other`.
* **Legacy capability and action names**: every matrix-widget-api capability string parses as
  `Capability::Other` and grants nothing; the compat wrapper translates them.
* **Timeouts on the host side**: the widget SDK fails a request the host does not answer within
  10 seconds. The driver does not time out its own requests to the widget (they are only acked,
  nothing waits for them), and the compat wrapper does not time out its bootstrap requests.
* **Modal widgets** (`open_modal`, `close_modal`, `set_button_enabled`, `button_clicked`,
  `widget_config`): client UI only, not in MSC4412.
* **Receiving sticky events** (`host:…forward_event.sticky`): the capability parses,
  but nothing delivers them yet. Sending sticky events works.
* **Multi-room access**: one widget, one room. `room_id` / `room_ids` are accepted only when they
  name the widget's own room (`room_ids: "*"` means the own room); other rooms get an error, and
  no capability changes that.
* **A production `MatrixBackend`** for matrix-rust-sdk or matrix-js-sdk. Only `InMemoryBackend`
  exists. An implementation is a thin adapter around `Room::send_raw`,
  `Room::get_state_events`, a room event handler for `subscribe_room`, ...

Legacy (`im.vector.modular.widgets`) widgets are covered: the driver rejects their messages
(`api` instead of `source`) with `DriverError::LegacyWidgetApi`, and `packages/widget-compat-wrapper` runs them on
an MSC4412 host. Smaller gaps (`redact_event`, `parent_delay_id`, `\#` escaping in msgtype
capabilities, the order of the TURN watch acknowledgement) and the full comparison with
matrix-widget-api and matrix-rust-rtc are in [`docs/parity.md`](docs/parity.md). Unknown
capability strings and actions are kept as `Other` / `Unknown`, so they can be added on top.
