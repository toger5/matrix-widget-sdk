---
name: widget-api-change
description: Checklist of every place that has to stay in sync when the widget API changes in this repository. Use before and after adding, renaming or removing an action, a capability, a request/response field, a platform callback or a backend method, and whenever the capability naming proposal changes.
---

# Changing the widget API

The API is defined once in Rust and repeated by hand in the driver's permission rules, the widget
SDK, the compat wrapper, the test widgets, the docs and the diagrams. The compiler catches only part
of it. Work through the sections that apply, then run the checks. If a file or symbol named here no
longer exists, find its successor and say so in your report.

## Decided rules (do not reopen without asking Timo)

- **Source of truth for names:** MSC4412 (envelope, core actions, error codes, capability format)
  and "The schema" in `docs/spec-appendix/capability-naming-proposal.md`. MSC4412 wins.
- **Envelope:** `source`, `action`, `request_id`, `request` / `response`; no `version`; a legacy
  message has `api` instead of `source`.
- **Errors:** use the `WidgetError` constructors (`unknown_action`, `missing_capability`,
  `invalid_request`, `new`, `with_matrix_error`), never a hand-built code. Messages name the
  capability (`Missing capability: <string>`); tests assert on them.
- **Capabilities:** `source ":" action [ "." modifier ] [ ":" data ]`, `action` = the wire name
  including its namespace. One capability per action. `send_event` / `forward_event` always carry
  `timeline` or `state`. No capability names a room (one widget, one room). Source `webview` is
  about no action: one `sandbox` token or `allow` feature (`[a-z][a-z0-9-]*`, ≤ 64 chars, else
  `Other`); base tokens granted unasked, `allow-top-navigation*` never, a grant applies with a reload.
- **Namespaces:** the unstable prefix of the action's MSC, `org.matrix.mscXXXX` without one,
  `org.matrix.msc4412` for the three core actions (no capability). Stable `m.<name>` is a serde
  `alias`. A bare name is never accepted.
- **Actions** are verbs; no name is used by both sources.
- **No aliases for old names** in the driver or the SDK; only the compat wrapper knows legacy names.
- **Legacy side is frozen:** `packages/test-widgets/legacy/` and the wrapper code facing the inner
  iframe keep matrix-widget-api's names.
- **Backend method names** follow matrix-rust-rtc (`rtc_livekit_get_token`), not the action names.
- **Spec changes go with the code:** a change to what MSC4411/MSC4412 define, or an action meant for
  a new MSC, comes with a file in `spec/patch/` (`widget-mscs` skill).

## 1. Action (`crates/matrix-widget-actions`)

- Body types, doc header ("Requires `…`"), roundtrip test: `src/actions/<widget|host>/<action>.rs`.
- Variant with `rename` (wire name) and `alias` (stable), in **both** enums of the folder's `mod.rs`
  (`WidgetRequest` + `WidgetResponse`, or `HostRequest` + `HostResponse`); module declaration there;
  re-export of the body types in `src/lib.rs`.
- A rename renames file, variant and body types, and extends the "old name is unknown" test in both
  `mod.rs` test modules.
- A body that carries a credential: add the action to `SECRET_ACTIONS` (`src/wire.rs`) so trace logs
  redact it. Otherwise logging needs nothing.

## 2. Capability (`crates/matrix-widget-actions/src/capabilities.rs`)

- `Capability` variant; no data: a row in `UNIT_CAPABILITIES`; with data: a head constant, an arm in
  `with_data` (parse) and in `parts` (format), and a constructor.
- `allows_*` on `Capability` and on the `CapabilitySet` trait + impl.
- Tests in the file: the list of all capability strings, the near-misses that must stay `Other`, the
  matching tests, the check that each capability embeds its action's wire name.
- `namespace_of` must equal the prefix of the action's `rename`. The same table is repeated in
  `packages/widget-compat-wrapper/src/capabilities.ts` (`ACTION_NAMESPACES`),
  `packages/test-widgets/new/capabilities.ts` (`NAMESPACES`) and test strings. Namespace constants:
  `src/wire.rs`.
- Webview capabilities are repeated in the compat wrapper (`LEGACY_WEBVIEW_CAPABILITIES`,
  `normalizeCapability`), the driver's legacy set (`LEGACY_SANDBOX` / `LEGACY_ALLOW` in
  `crates/matrix-widget-host-driver/src/webview.rs`; the host's `test/webview.test.ts` compares it with
  the wrapper's), `canonicalWebview` in the host's `src/lib/webview.ts`, and the test widget
  (`WEBVIEW_CAPABILITIES`). A new source needs its own arms in `with_data` / `parts`.

## 3. Host driver (`crates/matrix-widget-host-driver/src`)

| what | where |
|---|---|
| capability a request needs (exhaustive; single use only for these) | `driver/access.rs` `required_capability` |
| capability a host push needs (exhaustive) | `driver/access.rs` `push_capability` |
| body-dependent checks (type, state key, msgtype, room) | `driver/access.rs` `check_send_event`, `check_room(s)`, `may_*` |
| handling, backend calls, single use | `driver/requests.rs` `answer`, `handle_request` |
| subscriptions and forwarding | `driver/subscriptions.rs` `subjects_for`, `to_device_types_for`, `forward_*` |
| public API (exported over UniFFI, §6) | `driver/mod.rs` |
| platform callbacks | `platform.rs`; every implementation needs the new one: the host's `widgetRuntime.ts`, `test/harness.ts`, the Rust test platforms (`driver/tests.rs`, `crates/matrix-widget-sdk/tests/loopback.rs`), README examples |
| webview policy, iframe attributes, legacy auto-approved set | `webview.rs`; reload on change: `driver/mod.rs` `State::sync_iframe` |
| widget state event, URL check | `widget_event.rs`, `widget_url.rs` (table `tests/widget_urls.json`, also checked by the host's and the wrapper's tests) |
| tests | unit tests in `access.rs`, `subscriptions.rs`; end to end in `driver/tests.rs` |

## 4. Backend (`crates/matrix-widget-host-backend-interface/src`)

Only when the action needs something new from Matrix.

- The trait and its sinks in `lib.rs`; `InMemoryBackend` in `in_memory.rs` (backs every Rust test
  and the host's DevBackend).
- The host implements it twice, each with a test: `packages/widget-host/src/matrix_session/rust/backend/`
  (`test/rustSdkBackend.test.ts`; missing SDK API goes into `packages/matrix-sdk-uniffi-js/sdk-additions/`)
  and `src/matrix_session/js/backend/` (`test/jsSdkBackend.test.ts`). `test/backendContract.ts` runs
  against both and the DevBackend.
- Account-scoped data is mirrored across the DevBackend's rooms in
  `packages/widget-host/src/matrix_session/memory/devBackend.ts`.
- `docs/parity.md` §3.

## 5. Widget SDK (`crates/matrix-widget-sdk`)

- Async method per widget action ("Needs `…`" doc), host request handling, `WidgetDelegate`: `src/client.rs`.
- JS API (hand-written wasm-bindgen, **not** UniFFI): `src/wasm.rs`. A changed `js_name` breaks
  `packages/test-widgets/new/main.ts`.
- Tests: `src/client.rs`, `tests/loopback.rs`.

## 6. Generated code (never edit, rebuild)

`npm run bindings` (`packages/widget-host-bindings/src/generated/`, `rust_modules/`), `npm run wasm`
(`crates/matrix-widget-sdk/pkg/`). The host's `test/driver.test.ts` runs on the bindings: rebuild
before testing and restart Vite. Details: `rust-host-crates` skill.

## 7. Compat wrapper (`packages/widget-compat-wrapper`)

Hand-written, shares no code with Rust: nothing fails to compile when it is forgotten.

| what | where |
|---|---|
| legacy capability → new capabilities; what a legacy host allowed unasked | `src/capabilities.ts` `LEGACY_RULES`, `IMPLICIT_CAPABILITIES` |
| legacy ↔ new action names, core names, error codes | `src/envelope.ts` `LEGACY_TO_NEW` |
| context actions, negotiation, `update_capabilities` → `notify_capabilities` | `src/bridge.ts` |
| webview set of the wrapper and its inner iframe | `src/capabilities.ts`, `src/wrapper.ts` (`innerIframe`) |
| file bodies, URL templates | `src/files.ts`, `src/template.ts` |
| tests, docs | `test/*.test.ts`, `README.md` |

Ask: does a legacy widget send or receive this action (name mapping + a bridge test)? Does a legacy
capability cover it (`LEGACY_RULES`, else legacy widgets silently lose it)? Did a legacy host allow
it unasked (`IMPLICIT_CAPABILITIES` and the driver's `legacy_auto_approved`)? Legacy names:
`node_modules/matrix-widget-api/lib/interfaces/WidgetApiAction.d.ts`, `Capabilities.d.ts`.

## 8. Test host and test widgets

| what | where (`packages/widget-host/` unless stated) |
|---|---|
| driver calls, platform callbacks, what is remembered (never a single-use capability) | `src/app/runtime/widgetRuntime.ts`, `src/lib/capabilityStore.ts` |
| hand-sent host pushes in the dev tools | intent `devTools/mockHostAction`, `src/views/widget/DriverPanel.tsx` |
| prompt label, section, risk of a capability | `src/views/widget/format.ts` (`LABELS`, `SECTIONS`, `RISKS`, `ALLOW`, `SANDBOX`); `test/capabilityFormat.test.ts`; copy changes follow the `widget-host-ui` agent |
| widget state events | `src/lib/widgetEvents.ts`, `test/widgetStateEvent.test.ts` |
| iframe `src` / `sandbox` / `allow` | from the driver's `loadIframe` only: `widgetRuntime.ts`, `src/app/controller.ts` `loadIframe`, `WidgetIframes` in `src/app/AppRoot.tsx` |
| DevBackend controls | `src/matrix_session/memory/devBackend.ts`, `src/views/devbackend/` |
| JS end to end, backend contract | `test/driver.test.ts`, `test/backendContract.ts` |
| strings asserted in Playwright | `e2e/*.spec.ts` |
| new test widget: capability lists, a button per action | `packages/test-widgets/new/capabilities.ts`, `new/main.ts` |
| legacy test widget (only when matrix-widget-api gained the action) | `packages/test-widgets/legacy/` |

## 9. Docs and diagrams

- `docs/spec-appendix/capability-naming-proposal.md` (schema, action tables, renames, migration).
- `docs/parity.md` (inventory, capability table, backend vs. rtc, not built).
- `spec/patch/` for spec text.
- READMEs of the crates and packages touched; doc comments naming the action or capability.
- `docs/diagrams/0*.svg` (hand-written; `xmllint --noout`, text must fit its box): 01 architecture
  and callbacks, 02 compat wrapper, 03 envelope and renames, 04 actions crate enums, 05 action
  inventory, 06 capabilities, 07 test setup.

## Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo build --features uniffi -p matrix-widget-host-driver
cargo build --target wasm32-unknown-unknown -p matrix-widget-sdk
npm run wasm && npm run bindings && npm run build --workspaces --if-present && npm test
(cd packages/widget-host && npx playwright test)
for f in docs/diagrams/*.svg; do xmllint --noout "$f"; done
```

After a rename, search for the old name:

```sh
grep -rn "<old_name>" --include='*.rs' --include='*.ts' --include='*.md' --include='*.html' --include='*.svg' . \
  | grep -vE "node_modules|/dist/|/pkg/|/generated/|rust_modules|/target/"
```

It may remain only in the compat wrapper (`src/capabilities.ts`, `src/envelope.ts`, tests, README),
`packages/test-widgets/legacy/`, the legacy columns of the naming proposal and `docs/parity.md`, the
"old name is unknown" tests (Rust and the host's `test/driver.test.ts`), and `MatrixBackend` method
names.

For a behaviour change also load both test widgets in the browser (`npm run dev`; URL parameters
for scripted runs in `packages/widget-host/README.md`).
