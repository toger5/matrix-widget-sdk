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

The npm scripts set `CARGO_TARGET_DIR` to `rust_modules/target`, so this build (the ubrn CLI
included) never shares a cargo target directory with another checkout of this repository. With
a shared one (`build.target-dir` in `~/.cargo/config.toml`, and a second git worktree) cargo
takes the crates of the two checkouts for the same ones: the ubrn CLI then writes the other
checkout's path into `rust_modules/wasm/Cargo.toml` and the wasm link fails with duplicate
`wasm-bindgen` symbols.

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
throws `BackendError.Failed` with a reason. The methods are listed with their semantics in
`docs/parity.md` and in the Rust docs of `matrix-widget-host-backend-interface`.

Register listeners for `subjects.timelineEventTypes` and `subjects.stateEventTypes` on the room,
deliver the **current set** of every requested state type right away (`sink.onStateEvents(type,
events)`, an empty array when there is none) and then after every change, forward new timeline
events with `sink.onTimelineEvents([event])`, and return `{ cancel() { /* remove listeners */ } }`.
`subscribeRoom` is synchronous; the sink may be called from inside it. The driver calls it
whenever the widget's approved `host:…` capabilities grow and cancels the previous subscription.

The timeline cache (`read_timeline`, `paginate_timeline`, `notify_timeline_update`;
`spec/patch/new/timeline-reading.md`): `timelineRead(roomId, from, limit, filter)` walks the
client's cached timeline from the event older than `from` (the newest when `undefined`), returns
up to `limit` events matching any `TimelineFilter` (`{ eventType, msgtype? }`) **newest first**
with the `PaginationStatus`, and throws `new BackendError.EventNotCached({ eventId })` for a `from`
it does not cache. `timelinePaginateBackwards(roomId, limit)` starts (or joins) a back-pagination
and resolves **at once** with the status; `subscribeTimeline` reports
`sink.onTimelineUpdate({ pagination, paginationError, reset, decrypted })` when the status changes
(after the fetched events are cached), when the cache is reset, and when cached events were
decrypted late. `InMemoryBackend` keeps a pagination pending until `resolvePagination(events,
startReached)` / `failPagination(message)`; `pendingPagination()` and `paginationStatus()` show it.

Notes on the generated types: records are camelCase (`eventType`, `stateKey`), `u64` fields such
as `originServerTs` are `bigint`, event `content` is a plain JS value, capabilities are strings
(`host:org.matrix.mscXXXX.forward_event.timeline:m.room.message`), enums with data and errors are
tagged classes (`new BackendError.Failed({ … })`, `BackendError.EventNotCached.instanceOf(e)`), and
`PaginationStatus` is a numeric enum (`PaginationStatus.Idle`). `matrixEventFromJson` /
`matrixEventToJson` convert between the record and client-server API JSON. `capabilityIsKnown`
tells a capability of the widget API from a string the driver does not know (which it may grant,
but which allows nothing), e.g. to set the latter apart in a permission prompt.

Which state events are widgets, and what to load for one, is the driver's too (see its README):
`parseWidgetStateEvent(eventType, stateKey, content, options)` returns a `WidgetDefinition` (`name`,
`url`, `usesWidgetApi`, `legacy?`, …) for a widget the client may load; it makes the check the
driver's constructor makes with the same `options` (the URL check, and no page of the compat
wrapper at `options.wrapperUrl`, no page of `options.clientOrigin` outside `options.ownWidgetDirs`;
`options` is the plain object `EmbedOptions { wrapperUrl?, clientOrigin?, ownWidgetDirs, allowHttp }`;
to check a URL alone, as a form does, parse a minimal `m.widget` event `{ name, url }`).
`widgetUrlProblem(url, allowHttp)` is the URL check without the options, and
`widgetEventTypes()` the event types to read. The parser and the constructor throw a
`WidgetEventError` (`NotAWidgetType`, `Removed`, `Refused`; `Refused` carries the whole definition
in `widget`, to list it disabled). Errors of the bindings carry their fields in `inner`
(`e.inner.reason`), not the text of the Rust error. Strings coming back from the bindings lose a
leading U+FEFF (they are decoded with a default `TextDecoder`), so the host puts the event's own
`url` and state key into the definition it hands to the constructor.

What the iframe loads reaches the client through `loadIframe(iframe)`: `WidgetIframe { url, origin,
sandbox, allow }`, the URL as the check serialised it (for a legacy widget the compat wrapper), its
origin as the `postMessage` target, and the attributes made from the widget's webview capabilities
(`webview:…sandbox:<token>`, `webview:…allow:<feature>`): `sandbox: "allow-scripts allow-same-origin"`
and an empty `allow` for none. The driver calls it from `start()` and again when a granted, revoked
or auto-approved webview capability changes the attributes; the same driver goes on, forgets the
old page and grants the new one what the old held without asking (`snapshot().carried`). The driver
grants the base tokens without calling `onCapabilitiesRequested` and never grants
`allow-top-navigation`. `webviewAttributes(capabilities)` is the function behind the attributes,
`legacyAutoApproved()` the list a legacy widget gets without asking (the driver applies it itself).
A widget without `usesWidgetApi` gets `onReady` right after `loadIframe`; its messages are refused
with `DriverError.NoWidgetApi`.

`onCapabilitiesRequested` gets the whole open question: a request that arrives before
`approveCapabilities` joins it, and the callback is called again with all of it (without what the
widget holds already or gets without asking). One `approveCapabilities` answers every request.
