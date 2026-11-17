# widget-base-sdk

**Responsibility:** the widget side of the widget API. It runs **only inside the widget's
webview** and is shipped as wasm with the widget. It is never part of a Matrix client.

`WidgetClient` keeps the widget's session state (requested capabilities, the capabilities the
host allowed, `notify_ready`), turns every action into an async function, matches responses to
requests, fails requests the host does not answer within 10 seconds, and acknowledges what the
host pushes. On `wasm32` it exports the JavaScript class `WidgetApi`,
which talks to `window.parent` via `postMessage`.

![Architecture](../../docs/diagrams/01-architecture.svg)

## How to use it (JavaScript)

```sh
wasm-pack build crates/widget-base-sdk --target web --out-dir pkg
```

```js
import init, { WidgetApi } from "./pkg/widget_base_sdk.js";
await init();

const api = WidgetApi.connectToParent("https://client.example");   // target origin of the host
api.onEvent((event) => render(event));                             // forward_event from the host
api.onStateUpdate((state) => renderState(state));                  // update_state
api.onCapabilitiesChanged((allowed) => console.log(allowed));      // the full list, also after a revoke

await api.requestCapabilities([
  "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message",
  "host:org.matrix.mscXXXX.forward_event.timeline:m.room.message",   // onEvent
  "webview:org.matrix.mscXXXX.allow:camera",                         // the iframe may use the camera
]);
await api.notifyReady();                                           // host shows the widget

await api.sendEvent("m.room.message", { msgtype: "m.text", body: "hi" });
// The timeline cache, newest first; older events with `from`; `paginateTimeline` asks the client
// to fetch more, and `onTimelineUpdate` says when they are there (spec/patch/new/timeline-reading.md).
const { events, pagination } = await api.readTimeline({ limit: 20 });

// An OpenID token: the host grants `widget:…get_openid` for one token at a time, so this requests
// the capability when needed (the user is usually asked) and rejects when it is refused.
const { access_token, matrix_server_name } = await api.requestOpenIdToken();
```

To own the transport (e.g. in tests), use `new WidgetApi((json) => …)` and feed incoming
messages to `api.handleMessageFromHost(data)`.

Webview capabilities (`webview:…allow:<feature>`, `webview:…sandbox:<token>`) are the browser
permissions of the widget's own iframe, which starts strict (scripts and its own origin, nothing
else). They are requested like any other capability, but a host applies a grant by loading the
widget again: request them before `notifyReady()`, and expect the page to start over once (the
next start's request is granted at once). See
[`spec/patch/new/webview-capabilities.md`](../../spec/patch/new/webview-capabilities.md).

### Logging

Warnings (a rejected message, a request that timed out, a callback of yours that threw), errors
and Rust panics are written to the browser console as soon as `init()` has run. For more:

```js
import init, { initLogging } from "./pkg/widget_base_sdk.js";
await init();
initLogging("debug");                                   // off | error | warn | info | debug | trace
initLogging("warn", "widget_base_sdk::client=trace");   // RUST_LOG-style filter per module
```

`debug` prints one line per message, `trace` adds the bodies (credentials redacted). The levels
are described in the [repository README](../../README.md#logging). From Rust, the client only
emits `log` records; install any logger you like.

## How to use it (Rust)

Implement `WidgetDelegate::send_to_host` (and the `on_*` callbacks you need), create
`WidgetClient::new(Rc::new(delegate))`, and pass incoming JSON to
`client.handle_message_from_host(&json)`. The client is single-threaded (`!Send`).

A native build is used only by `tests/loopback.rs`, which connects a `WidgetClient` to a real
`WidgetHostDriver` and `InMemoryBackend`.
