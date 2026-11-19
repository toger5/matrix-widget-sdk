---
name: rust-host-crates
description: The Rust crates of this repository and the code generated from them - the crate graph, which output comes from which crate (packages/widget-host-bindings via ubrn, crates/matrix-widget-sdk/pkg via wasm-pack, Kotlin/Swift via uniffi-bindgen), the rules of UniFFI on the web (sync subscribe_*, no Blob, bigint, camelCase, Capability and JsonValue, error classes, the lost leading U+FEFF), what to rebuild with which command and how long it takes, restarting Vite after a rebuild, the version pins (uniffi 0.31 vs the SDK's 0.32, wasm-bindgen 0.2.129, two ubrn runtimes) and how to export something new to TypeScript. Use before changing a Rust crate, exporting a function or type to the bindings, bumping uniffi / ubrn / wasm-bindgen, and when the host behaves as if a Rust change did not happen.
---

# The Rust crates and their bindings

Widget API changes are the `widget-api-change` skill; the matrix-rust-sdk bindings
(`packages/matrix-sdk-uniffi-js`) the `matrix-session` skill and that package's README.

## Crate graph

| crate | depends on | generated from it |
|---|---|---|
| `matrix-widget-actions` (wire types, `Capability`, `JsonValue`) | serde, base64, thiserror (`uniffi` optional) | part of the host bindings; used by the widget SDK |
| `matrix-widget-host-backend-interface` (`MatrixBackend`, sinks, `InMemoryBackend`) | actions | part of the host bindings |
| `matrix-widget-logging` | log, env_filter | |
| `matrix-widget-host-driver` (driver, platform, state event parser) | the three above | its `cdylib` (`uniffi` feature) carries all three host crates: `packages/widget-host-bindings` (ubrn, web), Kotlin / Swift / Python (`crates/uniffi-bindgen`) |
| `matrix-widget-sdk` (widget side, hand-written wasm-bindgen, **not** UniFFI) | actions (driver only as dev-dependency for `tests/loopback.rs`) | `crates/matrix-widget-sdk/pkg` (`npm run wasm`) |

Host-only dependencies never go into `matrix-widget-actions`: everything there lands in the widget's wasm.

## UniFFI on the web (ubrn, `web` flavour)

- **Sync where foreign code returns an object:** a JS-implemented async method cannot return one, so
  `subscribe_room` / `subscribe_to_device` / `subscribe_turn_servers` / `subscribe_timeline` are
  synchronous; the sink may be called from inside them.
- **Bytes are `ArrayBuffer`, never `Blob`**; widget messages cross as JSON strings, files as base64.
- **`u64` / `i64` are `bigint`.** **camelCase** for fields, functions and methods; Option fields are
  `field?: T`, Option arguments `T | undefined`.
- **`Capability` is its string; `JsonValue` a plain JS value** (`crates/matrix-widget-actions/uniffi.toml`),
  a JSON string in Kotlin / Swift.
- **Enums with data and errors are tagged classes** with `tag` and `inner`
  (`WidgetEventError.Refused.instanceOf(e) && e.inner.reason`), not the Rust error text; give every
  error variant the fields a caller needs. Enums without data are numeric TS enums.
- **A leading U+FEFF of a returned string is lost** (default `TextDecoder`): never trust a
  security-relevant string round-tripped through a record (the host's `src/lib/widgetEvents.ts`
  re-inserts the event's own `url` and state key).
- **Traits implemented in JS need every method** (no defaults).
- **Init first:** `await uniffiInitAsync()`; vitest loads the wasm via `packages/widget-host/test/harness.ts`.
- Views never import the bindings (`widget-host` skill).

## Rebuilds

| you changed | run (root) | time | then |
|---|---|---|---|
| actions, backend interface, driver | `npm run bindings` | ~15 s incremental; ~3 min cold | **restart every Vite server** of the host; tsc + vitest |
| `matrix-widget-sdk` | `npm run wasm` | ~5 s | restart the test widgets' server (5175) |
| the SDK pin or `sdk-additions/` | `npm run bindings -w packages/matrix-sdk-uniffi-js` | long (whole SDK twice) | restart Vite |

- **Vite caches the compressed wasm** (`compressWasm` in `packages/widget-host/vite.config.ts`):
  after a rebuild a running server keeps serving the old driver (old behaviour, or a missing export).
  Playwright reuses a running server on 5173: restart it.
- `npm install` / `npm ci` run the bindings' `prepare` (a full `ubrn build web`): they need Rust,
  `wasm32-unknown-unknown` and the `wasm-bindgen` CLI.
- `npm run bindings` uses `CARGO_TARGET_DIR=packages/widget-host-bindings/rust_modules/target`. A
  shared target dir (`build.target-dir` in `~/.cargo/config.toml`) with a second worktree mixes up
  the crates of both checkouts (duplicate `wasm-bindgen` symbols). The dead-code warnings of
  `matrix-widget-host-wasm` (one per sink trait implemented in Rust) are expected.
- Never edit `src/generated/`, `rust_modules/`, `crates/matrix-widget-sdk/pkg/` or `dist/`.
- Published (RELEASING.md): keep the literal `new URL("./generated/wasm-bindgen/index_bg.wasm",
  import.meta.url)` in `packages/widget-host-bindings/src/index.ts`. A new dependency of a published
  crate must be on crates.io. One version for all: `node scripts/set-version.mjs <v>`.

## Version pins

| what | where | note |
|---|---|---|
| `uniffi = "=0.31"` | root `Cargo.toml` | must match ubrn and `@ubjs/core` `0.31.0-6` in `packages/widget-host-bindings/package.json` |
| the SDK's uniffi 0.32 | `packages/matrix-sdk-uniffi-js` (ubrn from a fork commit) | its runtime is imported as `uniffi-bindgen-react-native` (rewritten in `scripts/build.sh`): the two bindings packages use their own runtime copies on purpose |
| `wasm-bindgen 0.2.129` | root `Cargo.toml`, `packages/widget-host-bindings/wasm-crate.patch.toml`, `.github/actions/setup-web/action.yml` | the CLI on `PATH` must be the same (`cargo install wasm-bindgen-cli --version 0.2.129 --locked`) |
| `rust-version = "1.82"` | root `Cargo.toml` | stale: dependencies need 1.89; CI uses stable |

## Exporting something new

1. `#[cfg_attr(feature = "uniffi", uniffi::export)]` on the function, `uniffi::Record` / `Enum` /
   `Error` derives behind `cfg_attr`; re-export from the crate's `lib.rs` (examples:
   `capability_is_known`, `parse_widget_state_event`, `legacy_auto_approved`).
2. `cargo build --features uniffi -p matrix-widget-host-driver`, `npm run bindings`; check the
   generated name in `packages/widget-host-bindings/src/generated/`.
3. Use it from the host's model or controller (`src/lib/`, `src/app/`), never a view; test it in
   vitest against the real wasm.
4. Document it in `packages/widget-host-bindings/README.md` and the crate's README.

## Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo build --features uniffi -p matrix-widget-host-driver
cargo build --target wasm32-unknown-unknown -p matrix-widget-sdk
npm run bindings && npm test
```

Then restart the dev server and run Playwright on a fresh server (`packages/widget-host`).
