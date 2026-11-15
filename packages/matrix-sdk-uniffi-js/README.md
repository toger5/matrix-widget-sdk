# matrix-sdk-uniffi-js

matrix-rust-sdk for the browser: the `matrix-sdk-ffi` API (the one Element X uses on iOS and
Android) as TypeScript plus one wasm module. The bindings are generated from the SDK's UniFFI
scaffolding with [uniffi-bindgen-react-native](https://github.com/jhugman/uniffi-bindgen-react-native)
(ubrn), `web` flavour. They are not wasm-bindgen bindings written by hand, hence the name.

There is no official package of the full SDK for the web. [Aurora](https://github.com/element-hq/aurora)
builds the same thing with a local script and commits the output. This package is that build,
made repeatable, so that apps can depend on it instead of vendoring a binary. It contains nothing
specific to widgets and is meant to move out of this repository.

## Build

```sh
npm run bindings -w packages/matrix-sdk-uniffi-js
```

Needs:

- the Rust target `wasm32-unknown-unknown`
- optionally binaryen's `wasm-opt`, which shrinks the binary

The `wasm-bindgen` CLI has to match the SDK's `Cargo.lock` exactly, so the script installs that
version into `rust_modules/tools` instead of relying on the one on `PATH`.

`scripts/build.sh` checks the SDK out into `rust_modules/`, patches it, and writes
`src/generated/`. Both are build output and not committed. A first build compiles the whole SDK
twice (natively for the metadata, then for wasm) and takes a long time and several GB of disk.

## What the build changes

Upstream does not build `matrix-sdk-ffi` for wasm32, so the SDK checkout is edited before building:

| Change | Why |
|---|---|
| drop `experimental-search` from the ffi's `matrix-sdk` features | pulls in tantivy, which does not build for wasm32 |
| pin `tracing-appender` to 0.2.4 | 0.2.5 depends on `symlink`, which does not build for wasm32 |
| two build passes | the SDK workspace can only list `bindings/wasm` once ubrn has generated it |
| copy `sdk-additions/` in and declare its modules | ffi API that upstream does not have yet, see below |

Two more steps exist only because ubrn is taken from an unreleased branch (see the pin):

| Step | Why |
|---|---|
| fetch ubrn's `Cargo.lock` for the pinned commit | npm leaves it out of a git install, and without it the ubrn CLI resolves `uniffi_bindgen` 0.32.2, which it does not compile with |
| rewrite `@ubjs/core` imports in `src/generated` to `uniffi-bindgen-react-native` | the runtime matching this ubrn is not published as `@ubjs/core`; it is the main export of the ubrn package. Other packages in this repository keep their own `@ubjs/core` |

Both go away once ubrn releases uniffi 0.32 support.

## API added to the SDK

`sdk-additions/` holds Rust files that are copied over the SDK checkout. They add what a widget
host needs and the ffi does not expose. Everything is in new files, so the only edit to an
upstream file is one `mod` line per file (done by `declare_module` in `scripts/build.sh`, which
fails loudly if the line it inserts after is gone). They are written to be sent upstream as they
are.

| File | Adds |
|---|---|
| `bindings/matrix-sdk-ffi/src/room/raw_events.rs` | `Room::events_raw`, `paginate_events_raw_backwards`, `subscribe_to_events_raw`: the room's event cache as JSON, any event type, decrypted. `Room::relations_raw`: one page of `/relations`, decrypted. `Room::account_data_raw`: room account data from the store |
| `crates/matrix-sdk-ui/src/room_list_service/full_state.rs` | `RoomListService::set_room_subscriptions_with_full_state`: a room subscription with `required_state: [["*", "*"]]` instead of the SDK's fixed list |
| `bindings/matrix-sdk-ffi/src/room_list_full_state.rs` | `RoomListService::subscribe_to_room_with_full_state`: the above for one room, returning once the state has arrived (or after a timeout) |

## The pin

| | |
|---|---|
| matrix-rust-sdk | `main` at `ce0552083` (2026-11-13), uniffi 0.32.1 |
| ubrn | `neekolas/uniffi-bindgen-react-native` at `b625018`, the tip of the unmerged `uniffi-0.32/ci-typecheck` branch. Released ubrn is on uniffi 0.31 ([ubrn#449](https://github.com/jhugman/uniffi-bindgen-react-native/issues/449)) |
| ffi features | `js`, `indexeddb`, `unstable-msc4354` (sticky events); the ffi's default features are off |
| wasm-bindgen | 0.2.128, from the SDK's lock file |
| Output | 72 MB wasm without `wasm-opt` (14.8 MB gzip), 2.8 MB of TypeScript for `matrix_sdk_ffi` |

The generated TypeScript passes `tsc --noEmit` (`npm run typecheck`). Moving the pin means
checking the first table above against the new commit and that `sdk-additions/` still compiles. The last SDK commit that builds with
released ubrn is `b994f47f` (2026-09-15); its ffi lacks most of what the widget host needs.

## Use

```ts
import { uniffiInitAsync, ClientBuilder } from "matrix-sdk-uniffi-js";

await uniffiInitAsync();
const client = await new ClientBuilder().serverNameOrHomeserverUrl("matrix.org").build();
```

The wasm file is imported with `?url`, which Vite understands. Exclude the package from Vite's
dependency pre-bundling (`optimizeDeps.exclude`).

## Licence

The SDK is Apache-2.0, ubrn and its runtime are MPL-2.0.
