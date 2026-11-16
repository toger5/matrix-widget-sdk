---
name: widget-api-change
description: Checklist of every place that has to stay in sync when the widget API changes in this repository. Use before and after adding, renaming or removing an action, a capability, a request/response field, a platform callback or a backend method, and whenever the capability naming proposal changes.
---

# Changing the widget API

The API is defined once in Rust and repeated, by hand, in several other places: the host driver's
permission rules, the widget SDK, the compat wrapper's legacy tables, the test widgets, the docs
and the diagrams. The compiler catches only part of it. Work through the sections that apply to
your change, top to bottom, then run the checks at the end.

## Rules that are already decided

Do not reopen these without asking Timo.

- **Source of truth for names:** MSC4412 (envelope, core actions, error codes, capability format)
  and `docs/spec-appendix/capability-naming-proposal.md`, and inside it the section "The schema".
  MSC4412 wins where they differ.
- **Envelope:** `source`, `action`, `request_id`, `request` / `response`. No `version`; a legacy
  message is one with `api` instead of `source`.
- **Errors** are `{ error: { code, message } }`. Use the `WidgetError` constructors
  (`unknown_action`, `missing_capability`, `invalid_request`, `new` for `unknown`,
  `with_matrix_error`); do not build a code by hand. If the code and the proposal disagree, fix one of them in the same change.
- **Capabilities** are `source ":" action [ "." modifier ] [ ":" data ]`, where `action` is the
  wire name of the action (`namespace "." name`).
  - `source` is `widget` (a request the widget makes) or `host` (a subscription).
  - The namespace is the one the action is sent with: the unstable prefix of its MSC, the
    placeholder `org.matrix.mscXXXX` for actions without an MSC, `org.matrix.msc4412` for the
    three core actions (which have no capability). The stable `m` is accepted when parsing. The
    action → namespace table is repeated per language, see section 2.
  - One capability per action. `send_event`, `read_events` and `forward_event` always carry
    `timeline` or `state`; they have no bare form.
  - No capability names a room. One widget, one room.
  - The source `webview` is about no action: one token of the widget iframe's `sandbox`
    (`webview:org.matrix.mscXXXX.sandbox:<token>`) or `allow` (`webview:…allow:<feature>`), value
    `[a-z][a-z0-9-]*` up to 64 characters, else `Other`. Base (`allow-scripts`,
    `allow-same-origin`) is granted unasked, `allow-top-navigation*` never; a grant applies with a
    reload. Proposed in `spec/patch/new/webview-capabilities.md` and
    `spec/patch/msc4412/capability-sources.md`.
- **Actions** are verbs, and no name is used by both sources. An action with an MSC keeps that
  MSC's unstable prefix as the emitted name, with the stable `m.<name>` as serde `alias`. Every
  action has a namespace; a bare name is not accepted.
- **No aliases for old names.** A renamed action or capability is not accepted under its old name
  by the driver or the SDK. The compat wrapper is the only place legacy names are understood.
- **Legacy side is frozen.** `packages/test-widgets/legacy/` and everything in the wrapper that
  faces the inner iframe keep matrix-widget-api's names.
- **Backend method names** follow matrix-rust-rtc (`rtc_livekit_get_token`, ...), not the action
  names. Do not rename them to match an action.
- **Spec changes go with the code.** A change to something MSC4411 or MSC4412 defines, or an
  action meant for a new MSC, comes with a file in `spec/patch/` in the same change. See
  `spec/patch/README.md` and the `widget-mscs` skill.

## 1. The action itself (Rust, `crates/widget-actions`)

| what | where |
|---|---|
| Body types, header doc comment ("Requires `…`"), roundtrip test | `src/actions/<widget\|host>/<action>.rs`, one file per action |
| Wire name (`rename`), stable alias, variant doc comment | `src/actions/widget/mod.rs` (`WidgetRequest` **and** `WidgetResponse`), `src/actions/host/mod.rs` (`HostRequest` **and** `HostResponse`) |
| Module declaration | the same `mod.rs` |
| Re-export of the body types | `src/lib.rs` |
| "Old name is unknown" test, when renaming | `renamed_actions_are_only_known_by_their_new_name` in both `mod.rs` test modules |

A rename also means renaming the file, the variant and the body types, so the code matches the wire.

## 2. The capability (Rust, `crates/widget-actions/src/capabilities.rs`)

- `Capability` variant and its doc comment.
- Without data: one row in `UNIT_CAPABILITIES`. With data: a head constant, an arm in
  `with_data` (parse) and an arm in `parts` (format).
- A constructor (`Capability::read_events(..)`) if the capability carries data.
- Matching: an `allows_*` method on `Capability` and on the `CapabilitySet` trait and its impl.
- Tests in the same file: add the string to `all()`; add near-misses to
  `strings_outside_the_scheme_are_other`; extend `matching` / `each_action_has_its_own_capability`.
- The namespace of each action lives in `namespace_of` here and has to equal the prefix of the
  action's serde `rename` (the test `capabilities_embed_the_action_name` checks it). The same
  table is repeated in `packages/widget-compat-wrapper/src/capabilities.ts` (`ACTION_NAMESPACES`),
  `packages/test-widgets/new/capabilities.ts` (`NAMESPACES`), as literals in
  `packages/widget-host/src/widgetStateEvent.ts` (`LEGACY_AUTO_APPROVED`) and in test strings. Moving an
  action to another namespace means changing all of them. The constants `MSC4412_NAMESPACE`,
  `PLACEHOLDER_NAMESPACE` and `STABLE_NAMESPACE` are in `src/wire.rs`.
- **Webview capabilities** (source `webview`): `Capability::WebviewSandbox` / `WebviewAllow`, the
  value check `is_webview_value`, `is_webview`; `capabilities_embed_the_action_name` skips them,
  `webview_capabilities_name_no_action` checks that `sandbox` / `allow` are no action names. Their
  namespace is the one of their MSC draft (`namespace_of`: the placeholder). The strings are
  repeated in the compat wrapper (`webviewCapability`, `LEGACY_SANDBOX` / `LEGACY_ALLOW` /
  `LEGACY_WEBVIEW_CAPABILITIES`, `normalizeCapability`), the host (`LEGACY_WEBVIEW` in
  `src/widgetStateEvent.ts`; `test/webview.test.ts` compares it with the wrapper's) and the test
  widget (`WEBVIEW_CAPABILITIES`, not in its default list). A new source needs its own arms in
  `with_data` / `parts` and the same treatment.

## 3. Host driver (`crates/widget-host-driver/src`)

| what | where |
|---|---|
| Which capability a widget request needs | `driver/access.rs` `required_capability` (exhaustive match: a new `WidgetRequest` variant does not compile without a rule); only such a capability can be single use (`set_single_use`, default `get_openid`; used up in `driver/requests.rs` `handle_request`) |
| Which capability a host push needs | `driver/access.rs` `push_capability` (exhaustive over `HostRequest`) |
| Checks that depend on the body (event type, state key, msgtype, room) | `driver/access.rs` `check_send_event`, `check_room(s)`, `may_read`, `may_read_relation`, `may_forward`, `may_update_state` |
| Handling the request, calling the backend | `driver/requests.rs` `answer` and its helpers |
| What the driver subscribes to and forwards | `driver/subscriptions.rs` `subjects_for`, `to_device_types_for`, `forward_*` |
| Public methods (pushes, approval, revocation, single-use capabilities) | `driver/mod.rs`; these are exported over UniFFI, see section 6 |
| Platform callbacks | `platform.rs` (`WidgetHostPlatform`) |
| Webview capabilities: which are granted without asking (base), never (`allow-top-navigation*`) or asked, and the iframe attributes | `webview.rs` (`WebviewPolicy`, `webview_attributes`, exported); used in `driver/mod.rs` (`State::question`, `approve_capabilities`) and `driver/requests.rs` (`request_capabilities`) |
| The widget state event (MSC4411, `uses_widget_api` of MSC4412): which events are widgets, the URL check, the compat wrapper's URL (its query parameters are the wrapper's README) | `widget_event.rs` (`WidgetDefinition::parse` / `embed`), `widget_url.rs` (`widget_url_problem`; `embed_url_problem` with `EmbedOptions`: no page of the client's compat wrapper, no page of the client's own origin but its own widget directories; table `tests/widget_urls.json`, which the host's `test/widgetStateEvent.test.ts` also compares with Node's URL parser and the compat wrapper's `test/url.test.ts` / `test/wrapper.test.ts` with its own checks); used by the host through `packages/widget-host/src/lib/widgetEvents.ts` (`embedOptions`) |
| Tests | unit tests in `access.rs` and `subscriptions.rs`; end to end in `driver/tests.rs` (helpers `setup`, `feed`, `grant`, `grant_and_drain`, `send`, `event`) |

Error messages name the capability (`Missing capability: <string>`, code `…missing_capability`);
tests assert on them.

## 4. Backend (`crates/widget-matrix-backend/src`)

Only when the action needs something new from Matrix.

- The `MatrixBackend` trait and its sinks in `lib.rs`.
- `InMemoryBackend` in `in_memory.rs` (it backs every Rust test and the browser host's DevBackend).
- The browser host implements the trait twice in TypeScript, once per Matrix SDK. A new or changed
  method needs its mapping in both, and a case in both tests:
  - matrix-rust-sdk (the default build): `packages/widget-host/src/matrix_session/rust/backend/rustSdkBackend.ts`,
    test `packages/widget-host/test/rustSdkBackend.test.ts`. If the SDK's ffi lacks the call, it is
    added in `packages/matrix-sdk-uniffi-js/sdk-additions/` (new files only, see that README).
  - matrix-js-sdk: `packages/widget-host/src/matrix_session/js/backend/jsSdkBackend.ts`,
    test `packages/widget-host/test/jsSdkBackend.test.ts`.
  - `packages/widget-host/test/backendContract.ts` runs against both and the DevBackend.
- Account-scoped data (media, to-device messages, TURN credentials, RTC transports) is mirrored
  across the rooms' `InMemoryBackend`s by the DevBackend,
  `packages/widget-host/src/matrix_session/memory/devBackend.ts`.
- The table in `docs/parity.md` §3 that compares the trait with matrix-rust-rtc.

## 5. Widget SDK (`crates/widget-base-sdk`)

| what | where |
|---|---|
| Async method per widget action, "Needs `…`" doc comment | `src/client.rs` |
| Handling of host requests, delegate callbacks | `src/client.rs` (`WidgetDelegate`) |
| JS API: `js_name`, callback registration, module doc example | `src/wasm.rs` (hand-written wasm-bindgen; this crate is **not** UniFFI) |
| Tests | `src/client.rs` tests, `tests/loopback.rs` (client ↔ driver ↔ `InMemoryBackend`) |

A changed `js_name` breaks `packages/test-widgets/new/main.ts`.

## 6. Generated code (never edit, always rebuild)

- `packages/widget-host-bindings/src/generated/**` and `rust_modules/`: `npm run bindings`
  (ubrn, from the UniFFI scaffolding of `widget-host-driver`). `Capability` crosses the FFI as its
  string; records and methods become camelCase.
- `crates/widget-base-sdk/pkg/`: `npm run wasm`.
- `packages/*/dist/`.

`packages/widget-host/test/driver.test.ts` runs against the generated bindings, so it fails with
stale ones. Rebuild before `npm test`, and restart every running Vite server afterwards (it caches
the compressed wasm). Timings, the UniFFI-on-the-web rules and the version pins: the
`rust-host-crates` skill.

## 7. Compat wrapper (`packages/widget-compat-wrapper`)

This is where legacy names meet new ones. It is hand-written TypeScript and shares no code with
Rust, so nothing fails to compile when it is forgotten.

| what | where |
|---|---|
| Legacy capability → new capabilities | `src/capabilities.ts` `LEGACY_RULES` |
| Capabilities a legacy host allowed without asking | `src/capabilities.ts` `IMPLICIT_CAPABILITIES` |
| Legacy action name ↔ host action name, per direction | `src/envelope.ts` `LEGACY_TO_NEW` (`widget` and `host` tables) |
| Context actions and their capabilities, negotiation, `update_capabilities` → legacy `notify_capabilities` rewrite | `src/bridge.ts` |
| Webview capabilities of a legacy client's iframe, requested at `start()` (`START_CAPABILITIES`); the inner iframe's constant `sandbox` / `allow` and the rule for a legacy widget of the wrapper's own origin | `src/capabilities.ts` (`LEGACY_WEBVIEW_CAPABILITIES`), `src/wrapper.ts` (`innerIframe`, `INNER_SANDBOX`, `INNER_ALLOW`); tests `test/capabilities.test.ts`, `test/bridge.test.ts`, `test/wrapper.test.ts` |
| Core action names, error codes, the code added to legacy errors | `src/envelope.ts` |
| Bodies that need conversion (files) | `src/files.ts`, wired in `src/bridge.ts` |
| Legacy URL template variables fed by the context actions | `src/template.ts` |
| Tests | `test/capabilities.test.ts` (the `MIGRATION` table), `test/envelope.test.ts`, `test/bridge.test.ts` |
| Docs | `README.md` (action name table, capability table) |

Ask for every change:

- Does a legacy widget send or receive this action? Then the name mapping needs a row (if the
  names differ) and `bridge.test.ts` a case.
- Does a legacy capability cover this action? Then `LEGACY_RULES` must expand to the new
  capability, otherwise legacy widgets silently lose the action.
- Did a legacy host allow it without a capability? Then it belongs in `IMPLICIT_CAPABILITIES`,
  and in `LEGACY_AUTO_APPROVED` of the test host.
- The legacy names come from matrix-widget-api:
  `node_modules/matrix-widget-api/lib/interfaces/WidgetApiAction.d.ts` and `Capabilities.d.ts`.

## 8. Test host and test widgets

| what | where |
|---|---|
| Driver calls, platform callbacks (`WidgetHostPlatform`), the message pump, capability answers and what is remembered (never a single-use capability) | `packages/widget-host/src/app/runtime/widgetRuntime.ts`; the store and its migrations: `src/lib/capabilityStore.ts` |
| Host pushes the dev tools send by hand (`update_theme`, `update_language`, `update_visibility`) | intent `devTools/mockHostAction` in `packages/widget-host/src/appViewModel.ts`, `WidgetRuntime.mockHostAction`, buttons in `packages/widget-host/src/views/widget/DriverPanel.tsx` |
| Label, section and risk mark of a capability in the permission prompt | `LABELS`, `SECTIONS`, `RISKS` in `packages/widget-host/src/views/widget/format.ts` (keyed by action name without namespace; webview capabilities: `ALLOW` and `SANDBOX`, keyed by feature / token, section "Browser permissions"; the only source of this copy, changed as a design step of the `widget-host-ui` agent); `test/capabilityFormat.test.ts` checks every capability of the test widget. What the driver does not know (`capabilityIsKnown`) goes to "Unknown to this app" |
| Auto-approved capabilities of legacy widgets, their webview set (`LEGACY_WEBVIEW`) | `packages/widget-host/src/widgetStateEvent.ts` |
| The widget iframe's `sandbox` / `allow`: built per start from the webview capabilities (`webviewFor`), the restart when one is granted or revoked (`webviewChanged`), what is kept across restarts (`webviewKept`) and the loop guard | `src/lib/webview.ts`, `src/app/runtime/widgetRuntime.ts`, `src/app/controller.ts` (`applyWebview`), `WidgetInstanceViewModel.webview` rendered by `WidgetIframes` in `src/app/AppRoot.tsx`; tests `test/webview.test.ts`, `e2e/webview.spec.ts` |
| Controls of the in-memory store (the DevBackendView) | `packages/widget-host/src/matrix_session/memory/devBackend.ts` (editing API), `packages/widget-host/src/views/devbackend/` |
| End to end through the JS bindings | `packages/widget-host/test/driver.test.ts` |
| What every backend must do behind the driver | `packages/widget-host/test/backendContract.ts` |
| Action names and capability strings asserted in the browser (Playwright) | `packages/widget-host/e2e/widget.spec.ts`, `devtools.spec.ts`, `devbackend.spec.ts`, `devbackendTimeline.spec.ts`, `webview.spec.ts` |
| New widget: capability lists (`WEBVIEW_CAPABILITIES` apart from the default list) | `packages/test-widgets/new/capabilities.ts` |
| New widget: a button per action, log labels | `packages/test-widgets/new/main.ts` |
| Legacy widget: only when matrix-widget-api itself gained the action | `packages/test-widgets/legacy/main.ts`, `legacy/capabilities.ts` |

A UI change in the host (a new button, panel or prompt) follows the `widget-host-ui` agent
(`.claude/agents/widget-host-ui.md`); the host's architecture is in the `widget-host` skill.

Logging needs no change for a new action: the driver and the client log every message by its
action name. Only if the action's body carries a credential, add its name to `SECRET_ACTIONS` in
`WireMessage::to_log_json` (`crates/widget-actions/src/wire.rs`) so trace logs redact it.

## 9. Docs

| what | where |
|---|---|
| The naming scheme, both action tables, renamed actions, migration table, examples | `docs/spec-appendix/capability-naming-proposal.md` |
| Changes to MSC text, new MSC drafts | `spec/patch/` (see its README) |
| Action inventory (both directions), "Capability strings" table, decisions, "raised, not built" | `docs/parity.md` |
| Action table, capability notes, JS and Rust examples, "Not (yet) covered" | `README.md` |
| Crate READMEs | `crates/widget-actions/README.md`, `crates/widget-base-sdk/README.md`, `crates/widget-host-driver/README.md` |
| Package READMEs | `packages/widget-compat-wrapper/README.md`, `packages/widget-host/README.md`, `packages/widget-host-bindings/README.md`, `packages/test-widgets/README.md` |
| Doc comments that name a capability or action | the action files, `actions/*/mod.rs`, `client.rs`, `wasm.rs`, the driver modules, `platform.rs` |

## 10. Diagrams (`docs/diagrams/*.svg`, hand-written)

| file | shows |
|---|---|
| `01-architecture.svg` | crates, platform callbacks, driver push methods |
| `02-legacy-widgets.svg` | the compat wrapper: capability expansion, action renames |
| `03-wire-format-changes.svg` | envelope, renamed actions |
| `04-actions-crate.svg` | the four enums and their variants |
| `05-action-inventory.svg` | every action with its capability |
| `06-capabilities.svg` | anatomy of a capability string, one capability per action, `allows_*` |
| `07-test-setup.svg` | test host, wrapper, both test widgets |

Keep them valid XML (`xmllint --noout`) and check that text still fits its box.

## Checks

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace
cargo build --features uniffi -p widget-host-driver
cargo build --target wasm32-unknown-unknown -p widget-base-sdk
npm run wasm && npm run bindings && npm run build --workspaces --if-present && npm test
(cd packages/widget-host && npx playwright test)   # the host in DevBackend mode with both test widgets
for f in docs/diagrams/*.svg; do xmllint --noout "$f"; done
```

Then search for the old name. After a rename the only places it may remain are:

- `packages/widget-compat-wrapper/src/{capabilities,envelope}.ts` and the wrapper's tests and README,
- `packages/test-widgets/legacy/`,
- the "today" / "legacy" columns of `docs/spec-appendix/capability-naming-proposal.md` and `docs/parity.md`,
- the "old name is unknown" tests in Rust and in `packages/widget-host/test/driver.test.ts`,
- `MatrixBackend` method names.

```sh
grep -rn "<old_name>" --include='*.rs' --include='*.ts' --include='*.md' --include='*.html' --include='*.svg' . \
  | grep -vE "node_modules|/dist/|/pkg/|/generated/|rust_modules|/target/"
```

For a behaviour change, also run the browser setup (`npm run dev`: host on 5173, which also serves the wrapper at `/widget_compatibility_wrapper/`,
widgets on 5175) and load both test widgets. `packages/widget-host/README.md` lists the URL
parameters for scripted runs (`autoload=1`, `autoApprove=1`, `event=<json>`, `seed=/e2e/seeds/lab.json`).
