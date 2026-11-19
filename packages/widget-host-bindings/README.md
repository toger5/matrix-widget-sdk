# widget-host-bindings

TypeScript bindings for the **host side** of the widget API: `matrix-widget-host-driver`,
`matrix-widget-host-backend-interface` and `matrix-widget-actions`, generated from their UniFFI scaffolding with
[uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native) (ubrn, `web`
flavour) and shipped as one wasm module. A JavaScript client implements `MatrixBackend` and
`WidgetHostPlatform` and drives `WidgetHostDriver`, exactly like a Kotlin or Swift client does
through the native UniFFI bindings.

The widget side (`matrix-widget-sdk`) is not part of this: it only ever runs inside a widget and
keeps its own wasm-bindgen build.

## From npm

```sh
npm install @matrix-widget-sdk/host
```

The npm package is this package bundled into one ES module (`index.js`) with its wasm at
`generated/wasm-bindgen/index_bg.wasm`. It finds the wasm with `new URL(…, import.meta.url)`, which
Vite, webpack 5 and Rollup turn into an emitted asset. In Vite, exclude the package from
dependency pre-bundling (`optimizeDeps: { exclude: ["@matrix-widget-sdk/host"] }`), which would
move the module away from the file. The type declarations use `Symbol.dispose`, so add
`"ESNext.Disposable"` to `lib` in the tsconfig (or set `skipLibCheck`). The rest of this README
covers building it from the repository. `scripts/pack-npm.mjs` makes the npm package (RELEASING.md).

![Architecture](../../docs/diagrams/01-architecture.svg)

## Prerequisites

```sh
rustup target add wasm32-unknown-unknown
cargo install wasm-bindgen-cli --version 0.2.129 --locked   # must equal wasm-crate.patch.toml
npm install                                                   # from the repository root
```

ubrn checks that the `wasm-bindgen` CLI version equals the `wasm-bindgen` crate version compiled
into the module. `wasm-crate.patch.toml` pins that crate version; keep the two numbers and the
root `Cargo.lock` in sync. `UBRN_WASM_BINDGEN=/path/to/wasm-bindgen` points ubrn at a specific
binary.

## Building

```sh
npm run bindings          # from the repository root (= npm run ubrn:web in this package)
```

`ubrn build web` (configured in `ubrn.config.yaml`):

1. builds `crates/matrix-widget-host-driver` natively with the `uniffi` feature and reads the UniFFI
   metadata of all three crates from that library,
2. writes `src/generated/matrix_widget_actions.ts`, `matrix_widget_host_backend_interface.ts`, `matrix_widget_host_driver.ts`
   (plus `*-ffi.ts` and `index.web.ts`),
3. writes a small wasm-bindgen shim crate to `rust_modules/wasm/`, builds it for
   `wasm32-unknown-unknown` and runs `wasm-bindgen`, producing `src/generated/wasm-bindgen/`
   (`index.js`, `index_bg.wasm`, type declarations).

The npm scripts set `CARGO_TARGET_DIR` to `rust_modules/target`: with a target directory shared
between two checkouts (git worktrees), ubrn writes the other checkout's path into
`rust_modules/wasm/Cargo.toml` and the wasm link fails with duplicate `wasm-bindgen` symbols.

`src/generated/` and `rust_modules/` are build outputs and gitignored. `src/index.ts` is the
package entry: it loads the wasm by URL (bundler friendly) and re-exports the three namespaces.

## Using it

```ts
import {
  uniffiInitAsync, InMemoryBackend, WidgetHostDriver, matrixEventFromJson, parseWidgetStateEvent,
  type EmbedOptions, type MatrixBackend, type WidgetHostPlatform, type RoomSink, type RoomSubjects, type Subscription,
} from "@matrix-widget-sdk/host";

await uniffiInitAsync();                                   // once, before anything else

let iframe: HTMLIFrameElement | undefined;
let widgetOrigin = "";
const platform: WidgetHostPlatform = {
  // The first iframe (`driver.start()`), and a new one whenever webview capabilities change `sandbox` / `allow`.
  loadIframe: ({ url, origin, sandbox, allow }) => {
    iframe?.remove();
    iframe = Object.assign(document.createElement("iframe"), { src: url, allow, hidden: true });
    iframe.setAttribute("sandbox", sandbox);
    widgetOrigin = origin;
    container.append(iframe);
  },
  sendToWidget: (json) => iframe!.contentWindow!.postMessage(JSON.parse(json), widgetOrigin),
  onCapabilitiesRequested: (requested) => queueMicrotask(() => driver.approveCapabilities(requested)),
  onReady: () => (iframe!.hidden = false),               // `notify_ready`; at once for a widget without `uses_widget_api`
  navigate: (uri) => { location.href = uri; },
  setAlwaysOnScreen: (value) => value,
  clientId: () => "io.example.client", clientTheme: () => "light", clientLanguage: () => "en",
};
const backend = new InMemoryBackend("!room:example.org", "@alice:example.org");
const options: EmbedOptions = { wrapperUrl: "https://client.example/wrapper/", clientOrigin: location.origin, ownWidgetDirs: [], allowHttp: false };
// Throws a `WidgetEventError`: `Refused` (list `e.inner.widget`, disabled, with `e.inner.reason`), `Removed`, `NotAWidgetType`.
const widget = parseWidgetStateEvent(event.type, event.state_key, event.content, options);
const driver = new WidgetHostDriver(widget, options, backend.asBackend(), platform);   // throws `Refused` as well
// `get_openid` is granted for one token at a time by default; `driver.setSingleUse([])` keeps every grant.
driver.setAutoApproved(remembered);                        // what the client remembers; before `start()`

window.addEventListener("message", (ev) => {
  if (ev.source === iframe?.contentWindow && ev.origin === widgetOrigin) driver.handleMessageFromWidget(JSON.stringify(ev.data));
});
driver.start();                                            // → loadIframe
// InMemoryBackend specific public api to mock a sync response
backend.inject(matrixEventFromJson(JSON.stringify(eventFromSync)));   // reaches the widget if permitted
```

### Implementing `MatrixBackend` (e.g. on matrix-js-sdk)

`MatrixBackend` is a plain interface shaped after matrix-rust-rtc's: identity getters, async
operations (`sendRoomEvent` / `sendStateEvent` / `sendStickyEvent` / `sendDelayedEvent` & co.,
`timelineRead` / `timelinePaginateBackwards` / `relations` / `readRoomAccountData`, `openidToken`,
`rtcTransports`, `searchUserDirectory`, `mediaConfig`, `uploadMedia` / `downloadMedia` (raw bytes
as `ArrayBuffer`), `sendToDeviceMessage`, the LiveKit pair;
each returns a `Promise` and throws `new BackendError.Failed({ errcode, status, reason })` to
fail, which the widget sees as `error.matrix_api_error`), and the subscription half:

```ts
subscribeRoom(roomId: string, subjects: RoomSubjects, sink: RoomSink): Subscription
subscribeToDevice(eventTypes: string[], sink: ToDeviceSink): Subscription
subscribeTurnServers(sink: TurnServerSink): Subscription
subscribeTimeline(roomId: string, sink: TimelineSink): Subscription
```

Every method is required (UniFFI traits have no defaults); an operation the client cannot offer
throws `BackendError.Failed` with a reason. The semantics are in the Rust docs of
`matrix-widget-host-backend-interface` and in `docs/parity.md`. In short:

- `subscribeRoom` is synchronous (the sink may be called from inside it). Deliver the **current
  set** of every requested state type at once (`sink.onStateEvents(type, events)`, `[]` for none)
  and after every change, forward new timeline events with `sink.onTimelineEvents([event])`, and
  return `{ cancel() { … } }`. The driver re-subscribes whenever the approved `host:…`
  capabilities grow.
- `timelineRead(roomId, from, limit, filter)` returns cached events older than `from`, **newest
  first**, with the `PaginationStatus`, and throws `BackendError.EventNotCached({ eventId })` for
  a `from` it does not cache. `timelinePaginateBackwards` resolves at once with the status;
  `subscribeTimeline` reports status changes, resets and late decryptions.

Notes on the generated types: records are camelCase (`eventType`, `stateKey`), `u64` fields such
as `originServerTs` are `bigint`, event `content` is a plain JS value, capabilities are strings
(`host:org.matrix.mscXXXX.forward_event.timeline:m.room.message`), enums with data and errors are
tagged classes with their fields in `inner` (`new BackendError.Failed({ … })`,
`WidgetEventError.Refused.instanceOf(e) && e.inner.reason`), and `PaginationStatus` is a numeric
enum. `matrixEventFromJson` / `matrixEventToJson` convert between the record and client-server
API JSON. `capabilityIsKnown` tells a capability of the widget API from a string the driver does
not know (e.g. to set it apart in a permission prompt). Strings coming back from the bindings lose
a leading U+FEFF (default `TextDecoder`), so put the event's own `url` and state key into the
definition handed to the constructor.

Widget state events (`parseWidgetStateEvent`, `widgetUrlProblem`, `widgetEventTypes`), the iframe
(`loadIframe`, `webviewAttributes`, `legacyAutoApproved`) and the capability prompt
(`onCapabilitiesRequested`, `approveCapabilities`) are described in the
[driver's README](../../crates/matrix-widget-host-driver/README.md); the TypeScript names are the
camelCase of the Rust ones.
