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
- optional: binaryen's `wasm-opt` (`brew install binaryen`) for the last size pass. Without it
  the script prints a warning, skips the pass and the module is about 6% larger (20 MB instead
  of 18.9 MB). `REQUIRE_WASM_OPT=1` makes a missing `wasm-opt` an error. CI does not install
  binaryen, so its builds (and the dev site) carry the larger module.

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
| `bindings/matrix-sdk-ffi/src/room/raw_timeline_changes.rs` | `Room::subscribe_to_timeline_changes_raw`: what the event cache does to the room's timeline that is neither a sync nor a pagination: `on_reset` (cleared or reset, or the listener lagged) and `on_decrypted` (events the redecryptor replaced in place, as JSON). For the widget host's `notify_timeline_update` and the RoomTimeline. Not verified against a homeserver |
| `crates/matrix-sdk-ui/src/room_list_service/full_state.rs` | `RoomListService::set_room_subscriptions_with_full_state`: a room subscription with `required_state: [["*", "*"]]` instead of the SDK's fixed list |
| `bindings/matrix-sdk-ffi/src/room_list_full_state.rs` | `RoomListService::subscribe_to_room_with_full_state`: the above for one room, returning once the state has arrived (or after a timeout) |
| `crates/matrix-sdk-ui/src/room_list_service/extra_state.rs` | `RoomListService::sync_extra_state_for_all_rooms`: a second sliding sync list (`extra_state`, growing, no timeline) on the room list's connection, whose `required_state` the caller chooses. The `required_state` of the `all_rooms` list is fixed |
| `bindings/matrix-sdk-ffi/src/room_list_extra_state.rs` | `RoomListService::sync_extra_state_for_all_rooms`: the above for a list of state event types, any state key |

## Wasm size

Measured at the pin below. "Without" is what `ubrn build web --release` produces on its own:
cargo's default release profile and no post-processing. "With" includes the optional
`wasm-opt` pass; without it (no binaryen installed, as in CI) the file is 20 MB.

| | Without optimisations | With |
|---|---|---|
| wasm file | 72.2 MB | 18.9 MB |
| gzip (`-9`) | 14.7 MB | 6.7 MB |
| brotli (`-q 11`) | 7.6 MB | 4.5 MB |
| code section | 49.2 MB | 15.2 MB |
| name section (function names) | 18.5 MB | removed |
| data section | 4.1 MB | 3.3 MB |
| functions | 75,810 | 40,333 |

The wasm is built in the SDK's workspace, which has no `[profile.release]`, so the profile in
this repository's `Cargo.toml` does not apply to it. `scripts/build.sh` sets the profile through
`CARGO_PROFILE_RELEASE_*` environment variables instead, which needs no edit of the checkout:

| Optimisation | Setting | What it does |
|---|---|---|
| optimise for size | `opt-level = "z"` | the default, `3`, trades size for speed: more inlining, loop unrolling, and generic code compiled again in every crate that uses it |
| link-time optimisation | `lto = "fat"` | optimises all crates as one unit, which merges those duplicated generics and removes code nothing reaches |
| one codegen unit | `codegen-units = 1` | the default of 16 splits each crate into parts that are optimised separately |
| strip | `strip = true` | drops the name section. Build scripts and proc macros are left unstripped (`build-override`), as stripped proc-macro dylibs can fail to load on recent macOS |
| `wasm-opt -Oz` | binaryen, after `wasm-bindgen`; skipped when `wasm-opt` is not installed | a wasm-level size pass over the finished module |

The profile and the strip take the file from 72.2 MB to 20 MB; `wasm-opt` takes it to 18.9 MB.
The price is build time (the wasm pass takes about 5 minutes) and Rust panics that show function
indices instead of names in their stack trace. For a local build with names, remove
`CARGO_PROFILE_RELEASE_STRIP` from the script.

What remains is mostly code that cannot be removed without changing what is built: UniFFI
exports the whole ffi API (1,650 functions), and every export keeps its code alive whether an
app calls it or not. Going further means turning off ffi features or exporting a smaller API.

## The pin

| | |
|---|---|
| matrix-rust-sdk | `main` at `ce0552083` (2026-11-13), uniffi 0.32.1 |
| ubrn | `neekolas/uniffi-bindgen-react-native` at `b625018`, the tip of the unmerged `uniffi-0.32/ci-typecheck` branch. Released ubrn is on uniffi 0.31 ([ubrn#449](https://github.com/jhugman/uniffi-bindgen-react-native/issues/449)) |
| ffi features | `js`, `indexeddb`, `unstable-msc4354` (sticky events); the ffi's default features are off |
| wasm-bindgen | 0.2.128, from the SDK's lock file |
| Output | 18.9 MB wasm (see [Wasm size](#wasm-size)), 2.8 MB of TypeScript for `matrix_sdk_ffi` |

The generated TypeScript passes `tsc --noEmit` (`npm run typecheck`). Moving the pin means
checking the first table above against the new commit and that `sdk-additions/` still compiles. The last SDK commit that builds with
released ubrn is `b994f47f` (2026-09-15); its ffi lacks most of what the widget host needs.

## Use

```ts
import { uniffiInitAsync, ClientBuilder } from "matrix-sdk-uniffi-js";

await uniffiInitAsync();
const client = await new ClientBuilder().serverNameOrHomeserverUrl("matrix.org").build();
```

The wasm file is found with `new URL("./generated/wasm-bindgen/index_bg.wasm", import.meta.url)`,
which Vite, webpack 5 and Rollup turn into an emitted asset. Exclude the package from Vite's
dependency pre-bundling (`optimizeDeps.exclude`), which would move the module away from the file.

## Licence

The SDK is Apache-2.0, ubrn and its runtime are MPL-2.0.
