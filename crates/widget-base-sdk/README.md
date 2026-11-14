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
]);
await api.notifyReady();                                           // host shows the widget

await api.sendEvent("m.room.message", { msgtype: "m.text", body: "hi" });
const history = await api.readEvents("m.room.message", 20);
```

To own the transport (e.g. in tests), use `new WidgetApi((json) => …)` and feed incoming
messages to `api.handleMessageFromHost(data)`.

## How to use it (Rust)

Implement `WidgetDelegate::send_to_host` (and the `on_*` callbacks you need), create
`WidgetClient::new(Rc::new(delegate))`, and pass incoming JSON to
`client.handle_message_from_host(&json)`. The client is single-threaded (`!Send`).

A native build is used only by `tests/loopback.rs`, which connects a `WidgetClient` to a real
`WidgetHostDriver` and `InMemoryBackend`.
