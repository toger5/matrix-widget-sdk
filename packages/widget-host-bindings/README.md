# widget-host-bindings

TypeScript bindings for the **host side** of the widget API: `widget-host-driver`,
`widget-matrix-backend` and `widget-actions`, generated from their UniFFI scaffolding with
[uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native) (ubrn, `web`
flavour) and shipped as one wasm module. A JavaScript client implements `MatrixBackend` and
`WidgetHostPlatform` and drives `WidgetHostDriver`, exactly like a Kotlin or Swift client does
through the native UniFFI bindings.

The widget side (`widget-base-sdk`) is not part of this: it only ever runs inside a widget and
keeps its own wasm-bindgen build.

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

1. builds `crates/widget-host-driver` natively with the `uniffi` feature and reads the UniFFI
   metadata of all three crates from that library,
2. writes `src/generated/widget_actions.ts`, `widget_matrix_backend.ts`, `widget_host_driver.ts`
   (plus `*-ffi.ts` and `index.web.ts`),
3. writes a small wasm-bindgen shim crate to `rust_modules/wasm/`, builds it for
   `wasm32-unknown-unknown` and runs `wasm-bindgen`, producing `src/generated/wasm-bindgen/`
   (`index.js`, `index_bg.wasm`, type declarations).

`src/generated/` and `rust_modules/` are build outputs and gitignored. `src/index.ts` is the
package entry: it loads the wasm by URL (bundler friendly) and re-exports the three namespaces.

## Using it

```ts
import {
  uniffiInitAsync, InMemoryBackend, WidgetHostDriver, matrixEventFromJson,
  type MatrixBackend, type WidgetHostPlatform, type RoomSink, type RoomSubjects, type Subscription,
} from "@matrix-widget-tools/widget-host-bindings";

await uniffiInitAsync();                                   // once, before anything else

const platform: WidgetHostPlatform = {
  sendToWidget: (json) => iframe.contentWindow!.postMessage(JSON.parse(json), widgetOrigin),
  onCapabilitiesRequested: (requested) => queueMicrotask(() => driver.approveCapabilities(requested)),
  onContentLoaded: () => (iframe.hidden = false),
  clientId: () => "io.example.client", clientTheme: () => "light", clientLanguage: () => "en",
};
const backend = new InMemoryBackend("!room:example.org", "@alice:example.org");
const driver = new WidgetHostDriver(backend.asBackend(), platform);

window.addEventListener("message", (ev) => {
  if (ev.source === iframe.contentWindow) driver.handleMessageFromWidget(JSON.stringify(ev.data));
});
backend.inject(matrixEventFromJson(JSON.stringify(eventFromSync)));   // reaches the widget if permitted
```

### Implementing `MatrixBackend` (e.g. on matrix-js-sdk)

`MatrixBackend` is a plain interface: identity getters, async `sendEvent` / `sendStateEvent` /
`readEvents` / `readState` (return a `Promise`, throw a `BackendError.*` to fail), and the
subscription half:

```ts
subscribeRoom(roomId: string, subjects: RoomSubjects, sink: RoomSink): Subscription
```

Register listeners for `subjects.timelineEventTypes` and `subjects.stateEventTypes` on the room,
deliver the **current set** of every requested state type right away (`sink.onStateEvents(type,
events)`, an empty array when there is none) and then after every change, forward new timeline
events with `sink.onTimelineEvents([event])`, and return `{ cancel() { /* remove listeners */ } }`.
`subscribeRoom` is synchronous; the sink may be called from inside it. The driver calls it
whenever the widget's approved `receive.*` capabilities grow and cancels the previous subscription.

Notes on the generated types: records are camelCase (`eventType`, `stateKey`), `u64` fields such
as `originServerTs` are `bigint`, event `content` is a plain JS value, capabilities are strings
(`org.matrix.msc2762.receive.event:m.room.message`), and `StateKeySelector` is a tagged class
(`new StateKeySelector.Any()` / `new StateKeySelector.Key({ key })`). `matrixEventFromJson` /
`matrixEventToJson` convert between the record and client-server API JSON.
