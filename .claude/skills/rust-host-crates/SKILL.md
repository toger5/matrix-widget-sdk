---
name: rust-host-crates
description: The Rust crates of this repository and the code generated from them - the crate graph, which output comes from which crate (packages/widget-host-bindings via ubrn, crates/matrix-widget-sdk/pkg via wasm-pack, Kotlin/Swift via uniffi-bindgen), the rules of UniFFI on the web (sync subscribe_*, no Blob, bigint, camelCase, Capability and JsonValue, error classes, the lost leading U+FEFF), what to rebuild with which command and how long it takes, restarting Vite after a rebuild, the version pins (uniffi 0.31 vs the SDK's 0.32, wasm-bindgen 0.2.129, two ubrn runtimes) and how to export something new to TypeScript. Use before changing a Rust crate, exporting a function or type to the bindings, bumping uniffi / ubrn / wasm-bindgen, and when the host behaves as if a Rust change did not happen.
---

# The Rust crates and their bindings

What changes in the widget API itself (actions, capabilities, backend methods) is the
`widget-api-change` skill; the matrix-rust-sdk bindings (`packages/matrix-sdk-uniffi-js`) are the
`matrix-session` skill and that package's README. This skill is the layer in between: crates,
generated code, rebuilds.

## Crate graph

| crate | what | depends on | generated from it |
|---|---|---|---|
| `matrix-widget-actions` | wire types: envelope, `WidgetRequest` / `HostRequest` & co., `Capability`, `JsonValue`, `MatrixEvent`; `capability_is_known` | serde, serde_json, base64, thiserror (`uniffi` optional) | part of the host bindings; used by the widget SDK too |
| `matrix-widget-host-backend-interface` | the `MatrixBackend` trait, its sinks, `InMemoryBackend` | `matrix-widget-actions` | part of the host bindings |
| `matrix-widget-logging` | the logger the bindings install | log, env_filter | (Rust only) |
| `matrix-widget-host-driver` | `WidgetHostDriver`, `WidgetHostPlatform`, the widget state event parser (`widget_event.rs`, `widget_url.rs`, with `url`) | the three above | its `cdylib` (`uniffi` feature) carries the UniFFI scaffolding of all three host crates: `packages/widget-host-bindings` (ubrn, web), Kotlin / Swift / Python (`crates/uniffi-bindgen`, root README) |
| `matrix-widget-sdk` | the widget side, hand-written wasm-bindgen (**not** UniFFI) | `matrix-widget-actions` (the driver only as a dev-dependency, for `tests/loopback.rs`) | `crates/matrix-widget-sdk/pkg` (`npm run wasm`, wasm-pack), used by `packages/test-widgets/new` |
| `uniffi-bindgen` | CLI for the native bindings | uniffi | |

Host-only dependencies belong in `matrix-widget-host-driver` (or `matrix-widget-host-backend-interface`), never in
`matrix-widget-actions`: everything there also lands in the widget's wasm.

## UniFFI on the web (ubrn, `web` flavour)

The TypeScript in `packages/widget-host-bindings/src/generated/` follows these rules; Kotlin and
Swift differ where noted.

- **Sync where an object comes back from foreign code.** A foreign (JS-implemented) async method
  cannot return an object, so `MatrixBackend::subscribe_room`, `subscribe_to_device` and
  `subscribe_turn_servers` are synchronous and return a `Subscription`; the sink may be called from
  inside them. Async exported methods and async foreign methods without objects are `Promise`s.
- **Bytes are `ArrayBuffer`, never `Blob`.** Every widget message crosses as a JSON string;
  files travel base64 in the MSC4412 body (`docs/parity.md` §6).
- **`u64` / `i64` are `bigint`** (`originServerTs`).
- **camelCase:** record fields, functions, methods (`parse_widget_state_event` →
  `parseWidgetStateEvent`, `state_key` → `stateKey`). Option fields are `field?: T`, Option
  arguments `T | undefined`.
- **`Capability` is its string** (a `custom_type!` in `matrix-widget-actions`). **`JsonValue` is a plain
  JS value** in TypeScript (`crates/matrix-widget-actions/uniffi.toml` maps it through `JSON.parse` /
  `JSON.stringify`), a JSON string in Kotlin / Swift.
- **Enums with data are tagged classes** (`new BackendError.EventNotCached({ eventId })`, `x.tag`);
  enums without data are numeric TS enums (`PaginationStatus.Idle`).
- **Errors are classes with `tag` and `inner`**, not the text of the Rust error:
  `WidgetEventError.Refused.instanceOf(e) && e.inner.reason`. Give every error variant the fields a
  caller needs to show it.
- **A leading U+FEFF of a string coming back from Rust is lost** (the generated `stringConverter`
  uses a default `TextDecoder`). Do not round-trip a security-relevant string through a record and
  trust the copy: `src/lib/widgetEvents.ts` (`definitionOf`) puts the event's own `url` (and state
  key) into the `WidgetDefinition` it hands to the driver's constructor.
- **Traits implemented in JS need every method** (UniFFI has no defaults).
- **Init first:** `await uniffiInitAsync()` (the host's `src/main.tsx`) before any call. vitest
  loads the wasm by hand (`packages/widget-host/test/harness.ts`; import it in a test whose code
  calls the bindings).
- **Views never import the bindings.** A result reaches a view through the view model
  (`CapabilityPromptViewModel.unknown`) or `ViewEnv` (`widgetEvents`); see the `widget-host` skill.

## Rebuilds

Measured on an Apple M1 Pro (10 cores), 2026-11-16:

| you changed | run (from the root) | time | then |
|---|---|---|---|
| Rust in `matrix-widget-actions`, `matrix-widget-host-backend-interface`, `matrix-widget-host-driver` | `npm run bindings` | nothing changed: 11 s; a source file: 16–18 s; a new dependency (`url` with ICU4X): 63 s; cold (fresh target dir, building the ubrn CLI included): about 3 minutes (183 s) | `npx tsc --noEmit` and vitest in `packages/widget-host`; **restart every Vite server** that serves the host |
| `matrix-widget-sdk` | `npm run wasm` | about 5 s incremental (wasm-pack) | restart the test widgets' dev server (5175) |
| the SDK pin or `sdk-additions/` of `packages/matrix-sdk-uniffi-js` | `npm run bindings -w packages/matrix-sdk-uniffi-js` | the first build compiles the whole SDK twice (native and wasm), several GB; the `wasm-opt` pass alone about 5 minutes (its README) | restart Vite |

- **Vite caches the compressed wasm** per file (`compressWasm` in
  `packages/widget-host/vite.config.ts`), so a running dev or preview server keeps serving the old
  driver after `npm run bindings` until it is restarted. Symptoms: the host behaves as before the
  change, or a call fails with a missing export. The repository's Playwright config reuses a
  running server on 5173; start a fresh one (another port, `reuseExistingServer: false`) or restart.
- `npm install` / `npm ci` at the root run the `prepare` script of `widget-host-bindings`, which is
  a full `ubrn build web`: they need the Rust toolchain, the `wasm32-unknown-unknown` target and
  the `wasm-bindgen` CLI, and take as long as a cold `npm run bindings`.
- `npm run bindings` runs ubrn with `CARGO_TARGET_DIR=packages/widget-host-bindings/rust_modules/target`
  (about 2 GB): it builds `matrix-widget-host-driver` natively with `uniffi` (for the metadata),
  generates `src/generated/*.ts`, writes the wasm shim crate `rust_modules/wasm/` (its own
  `Cargo.lock`), builds it for wasm32 (`opt-level 3`, LTO) and runs `wasm-bindgen`. The 4
  dead-code warnings of `matrix-widget-host-wasm` (one per sink trait implemented in Rust) are expected.
- Never edit `src/generated/`, `rust_modules/`, `crates/matrix-widget-sdk/pkg/` or `dist/`; rebuild.
- Published (RELEASING.md): `crates/matrix-widget-sdk/pkg` as `@matrix-widget-sdk/widget` and
  `packages/widget-host-bindings` as `@matrix-widget-sdk/host` (bundled by `scripts/pack-npm.mjs`;
  its wasm is found with `new URL("./generated/wasm-bindgen/index_bg.wasm", import.meta.url)` in
  `src/index.ts`, keep that literal), and the crates `matrix-widget-actions`, `matrix-widget-logging`,
  `matrix-widget-host-backend-interface`, `matrix-widget-host-driver`. A new dependency of a published crate must be on
  crates.io (a path dependency needs a `version`); `matrix-widget-sdk` is `publish = false`. One
  version for all: `node scripts/set-version.mjs <v>`.
- Size of `index_bg.wasm` after this group: 2.15 MB (521 KB gzip); the `url` crate with ICU4X
  IDNA added 257 KB (92 KB gzip). Not optimised further: no `wasm-opt`, and the shim's
  `opt-level` can only be changed through `CARGO_PROFILE_RELEASE_OPT_LEVEL` (the patch file cannot
  change its type), as the SDK's `scripts/build.sh` does.

## Version pins

| what | where | note |
|---|---|---|
| `uniffi = "=0.31"` | root `Cargo.toml` | must match ubrn `0.31.0-6` (`uniffi-bindgen-react-native`, dev dependency) and its runtime `@ubjs/core` `0.31.0-6` in `packages/widget-host-bindings/package.json` |
| the SDK's uniffi 0.32 | `packages/matrix-sdk-uniffi-js` (ubrn from a commit of the neekolas fork, `package.json`) | its generated code imports the runtime as `uniffi-bindgen-react-native` (rewritten in `scripts/build.sh`), so the two bindings packages each use their own runtime copy on purpose |
| `wasm-bindgen 0.2.129` | root `Cargo.toml`, `packages/widget-host-bindings/wasm-crate.patch.toml`, `.github/actions/setup-web/action.yml` (`wasm-bindgen-cli@0.2.129`, used by ci.yml and release.yml) | the CLI on `PATH` must be the same version (`cargo install wasm-bindgen-cli --version 0.2.129 --locked`); the SDK installs its own CLI into its `rust_modules/tools` |
| `rust-version = "1.82"` | root `Cargo.toml` | not true any more: `uuid` 1.29 needs 1.89, ICU4X 2.4 (via `url`) 1.88; CI uses stable |

A shared `CARGO_TARGET_DIR` (`build.target-dir` in `~/.cargo/config.toml`) together with a second
worktree makes cargo mix up the crates of both checkouts (duplicate `wasm-bindgen` symbols); the
bindings scripts set their own target dir for that reason.

## Exporting something new

1. In the crate: `#[cfg_attr(feature = "uniffi", uniffi::export)]` on a free function (`&str`
   arguments work), `derive(uniffi::Record)` / `uniffi::Enum` / `uniffi::Error` on the types, all
   behind `cfg_attr` so the plain Rust build has no UniFFI. Re-export it from the crate's `lib.rs`.
   Examples: `capability_is_known` (`matrix-widget-actions`), `parse_widget_state_event`,
   `widget_url_problem`, `embed_url_problem`, `legacy_auto_approved` (`matrix-widget-host-driver`).
2. `cargo build --features uniffi -p matrix-widget-host-driver`, then `npm run bindings`; check the
   generated name and shape in `src/generated/matrix_widget_host_driver.ts` (or `matrix_widget_actions.ts`).
3. Use it from the model or the controller of the host (`src/lib/`, `src/app/`), never from a view.
   Test it in vitest against the real wasm (`test/harness.ts`).
4. Document it in `packages/widget-host-bindings/README.md` ("Notes on the generated types") and
   the crate's README.

## Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo build --features uniffi -p matrix-widget-host-driver
cargo build --target wasm32-unknown-unknown -p matrix-widget-sdk
npm run bindings && npm test        # root: compat wrapper and host unit tests on the new bindings
```

Then restart the dev server and run Playwright on a fresh server (`packages/widget-host`).
