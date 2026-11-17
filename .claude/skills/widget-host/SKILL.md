---
name: widget-host
description: Architecture of the widget host app (packages/widget-host) and how to change it without breaking its structure. Covers the MVVM layers and their import rules, the controller and intents, the widget runtime and why the iframes live outside the React tree, the session seam (only src/matrix_session imports a Matrix SDK; rust or js build), the DevBackend, seeds and the window.widgetHost test hook, and where to add an intent, a view, a setting, a DevBackend feature or a dev tools panel. Use before changing code in packages/widget-host, and to run or look at the host app.
---

# The widget host app

`packages/widget-host` is a browser widget host on `matrix-widget-host-driver` (through
`packages/widget-host-bindings`). It runs on a logged-in Matrix account (matrix-rust-sdk; a `js`
build uses matrix-js-sdk) or on the DevBackend, mocked in-memory rooms. It is the debugging tool
for widgets and the end-to-end test setup of this repository.

**UI changes** (a view, panel, section, prompt, flow or layout) follow the process of the
`widget-host-ui` agent (`.claude/agents/widget-host-ui.md`): design first, then the code bottom up,
then the tests. This skill is the architecture that process relies on.

## Read first; do not repeat what these say

All paths below are relative to `packages/widget-host/`.

| doc | for | status |
|---|---|---|
| `README.md` | features, URL parameters, running, choosing the SDK, the test hook | current |
| `src/views/README.md` | rules for views: props, markup, CSS, accessibility, stories, `e2e/tools/shot.mjs` | current |
| `e2e/README.md`, `e2e/stories.md` | the Playwright harness; which test reaches which story | current |
| `appDesign.md` | what the UI is: the design | current, the specification |
| the stories (`src/views/**/*.stories.tsx`, `npm run storybook`) | every state of the UI, one story each; `Sketch/…` stories are designed but not built (`.claude/skills/sketch-stories/SKILL.md`) | current, the visual specification |
| header comment of `src/appViewModel.ts` | the view model tree and the rules it encodes | current |
| `implementation_findings.md` | open decisions, each marked in the code with `// TODO-FINDING <name>` | current, kept up to date |
| `implementationPlan.md` | plan of the first implementation; section 2 (iframe slots, measured per browser) still holds; section 1 names files that do not exist | historical |
| `designFeedback.md` | review rounds of the first design; its accessibility list "Later, for the implementation" is still a requirement | historical |

## Layers and import rules

| layer | files | may import | must not import |
|---|---|---|---|
| view model | `src/appViewModel.ts` | types from `src/session.ts`, `src/widgetStateEvent.ts` | anything with runtime state |
| view | `src/views/**` | `appViewModel`, `views/env` (`useDispatch`, `useViewEnv`), `views/ui`, `views/helpers`, `src/widgetStateEvent.ts` (pure: types, keys, event types), types from `src/session.ts` | `src/app/**`, `src/lib/**`, `src/matrix_session/**`, the bindings, an SDK |
| controller | `src/app/controller.ts`; pure helpers `src/app/layout.ts`, `persistence.ts`, `store.ts` | everything below | views (except the pure `views/helpers`) |
| model / runtime | `src/session.ts`, `src/app/runtime/` (`widgetRuntime.ts`, `deviceVerification.ts`), `src/matrix_session/**`, `src/lib/**` (`widgetEvents.ts`: the driver's state event parser) | bindings, `src/app/store.ts`, view model types; an SDK only inside `src/matrix_session/{js,rust}/` | views, the controller |
| composition root | `src/main.tsx` (shadow root, bindings init, controller, test hook), `src/app/AppRoot.tsx` (`ViewEnv` on the controller, widget iframes) | all | |
| data (any layer imports it) | `src/exampleWidgets.ts` (state events of the test widgets; their URL comes from `VITE_TEST_WIDGETS_URL` at build time) | types only | anything else |

Check (each prints nothing when the rules hold):

```sh
cd packages/widget-host
grep -rnE 'from "((\.\./)+(lib|matrix_session)/|\.\./\.\./app/|@matrix-widget-sdk/host|matrix-js-sdk|matrix-sdk-uniffi-js)' src/views
grep -nE 'from "\.\./app/' src/views/*.ts src/views/*.tsx
grep -rnE 'from "(\.\./)+session"' src/views | grep -v ':import type '       # value imports; `import type` is fine
grep -rlE '(from |import\()"(matrix-js-sdk|matrix-sdk-uniffi-js)' src | grep -vE '^src/matrix_session/(js|rust)/'
```

## How data flows

- A view sends `dispatch(intent)`. `AppController.dispatch` runs `handle()`, a `switch` over
  `AppIntent` whose `default` assigns to `never`, so `npx tsc --noEmit` lists every intent without a
  case. A case changes the view model through `setMain` / `setWorkspace` / `setWidget` /
  `setAccount` (one `Store`, read with `useSyncExternalStore`) and runs effects (session, runtime,
  DevBackend, clipboard). An exception in an intent becomes a toast.
- Intents that lose state carry `confirmed?: boolean`: the controller opens the confirm modal,
  which sends the intent again with `confirmed: true`.
- The runtime reports back through `WidgetRuntimeEvents` (`ready`, `failed`,
  `capabilitiesRequested`, `alwaysOnScreen`, `activity`, `loadIframe`); the controller turns
  them into view model changes. These are controller events, not intents.
- High-frequency data is not in the view model: `WidgetRuntime.devTools` (a `Store` per widget),
  `DevBackend.subscribe` / `snapshot()`, `LiveSession.roomDetails` / `timeline` / `roomState`. Views read it with the hooks of
  `useViewEnv()`, implemented in `viewEnv()` of `src/app/AppRoot.tsx` and faked in
  `src/views/storyEnv.tsx`. A new hook needs both, plus its default in `src/views/env.tsx`.
- What a view needs from the bindings reaches it as a value or a function, never as an import:
  through the view model (`CapabilityPromptViewModel.unknown`, from `capabilityIsKnown`) or
  through `ViewEnv` (`widgetEvents`, the driver's widget state event parser: pass it to
  `roomWidgets`; the widget forms use its `urlProblem`). Stories get a fake (no wasm).
- State only one view needs (a draft, a hover, an open menu) stays in `useState`.
- `src/app/layout.ts` holds the pure transitions of panels, tabs and dev tools; they are unit
  tested in `test/layout.test.ts`.

## Widgets and iframes

- Moving an iframe in the DOM reloads it. So `WidgetIframes` (in `src/app/AppRoot.tsx`) renders
  every iframe into the light DOM of the host element (`createPortal`), keyed `<id>#<generation>`
  and never moved, and a view shows a widget only with `<WidgetSlot widgetId>`
  (`src/views/ui/WidgetSlot.tsx`), a `<slot>`. Never render an `<iframe>` in a view.
- `widgetSlot()` in `appViewModel.ts` names one place per widget (tab, PiP box or hidden); a widget
  must never have two slots on screen. The PiP panel is derived (`pipWidgetIds`); nothing stores
  "is in PiP".
- The UI lives in a shadow root: `document.querySelector` and `document.activeElement` do not see
  it, theme selectors are `[data-theme=…]` on the app root, styles are adopted from
  `src/styles/app.css?inline`, fonts are self-hosted. `app.css` only lists files in cascade layers
  (`tokens, base, atoms, views`): the design rules `src/styles/<area>.css`, then the app-only
  `src/views/<area>/*.css`. Vite inlines the imports; an adopted sheet would ignore `@import`.
  Stories render without the shadow root, where a `<slot>` shows its children (the `FakeWidget`
  of `ViewEnv.widgetStandIn`); they load `.storybook/preview.css` (`app.css` plus the story-only
  `.storybook/mockup.css`).
- Key presses and clicks inside an iframe never reach the host. `AppRoot` focuses the widget's
  panel when the window loses focus to an iframe.
- The iframe's `src`, `sandbox` and `allow` are set in one place, `WidgetIframes`, from
  `WidgetInstanceViewModel.iframe`, which is what the driver said (`WidgetHostPlatform.loadIframe`,
  a `WidgetIframe`): the URL it checked (for a legacy widget the compat wrapper), and strict
  attributes (`allow-scripts allow-same-origin`, empty `allow`) plus the webview capabilities the
  widget holds or gets without asking (`webview:…`; remembered, a legacy client's set for a legacy
  widget). Never hard-code them, never build them in the host. A grant or revocation of one makes
  the driver call `loadIframe` again (`WidgetRuntimeEvents.loadIframe` → controller `loadIframe`:
  a new generation behind the loading state, no prompt, a reload guard). Runtime and driver stay;
  the driver grants the reloaded page what the widget held (`DriverSnapshot.carried`). The default
  and the legacy set are the driver's (`crates/matrix-widget-host-driver/src/webview.rs`); changing them
  is a security decision: ask first. `src/lib/webview.ts` only tells webview capabilities apart
  (`isWebviewCapability`, `canonicalWebview`).
- `WidgetRuntime` owns the driver of one widget. The driver calls the platform callbacks
  synchronously from inside its own methods, so anything that calls back into the driver or
  changes the view model is deferred (`later`, a microtask). Messages are accepted only from the
  widget's own `contentWindow` and posted to the widget's origin (`WidgetIframe.origin`); keep
  both checks. The driver is made from the widget's `WidgetDefinition` (the constructor throws for
  one the host must not load) and started after `setAutoApproved` with what is remembered. A
  widget without `uses_widget_api: true` is ready right after `loadIframe`; the driver answers
  none of its messages. A reload (`widget/reload`: Retry, the reload button of the dev tools)
  disposes the runtime (and frees its driver) and makes a new one (`newRuntime` in the
  controller): what was granted only while the widget ran is gone, also after the reload guard.
- A widget runs once per account (`WidgetInstanceId` = `<room id>|<widget key>`). Switching the
  account stops every widget; its workspace starts them again.
- Which state events are widgets and whether the host may load them is the driver's parser
  (`parse_widget_state_event`, `widget_url_problem`, `embed_url_problem` in
  `crates/matrix-widget-host-driver`; the last refuses the host's own compat wrapper and every other page
  of the host's origin, except the test widgets it ships itself), used through
  `src/lib/widgetEvents.ts` (`hostWidgetEvents.resolve` → `{ widget, problem? }`, `describesWidget`,
  `wrapperUrl`, `embedOptions`, `ownWidgetDirs`). How a widget is embedded
  (directly, or through the compat wrapper for `im.vector.modular.widgets`) and what a legacy
  widget gets without asking (`legacy_auto_approved`) is decided by its driver, not by the host.
  `src/widgetStateEvent.ts` keeps the host's types (`StateEvent`, `WidgetEventParser`; it
  re-exports the bindings' `WidgetDefinition` and `WidgetIframe` as types), keys (`widgetKey`,
  `localWidgetKey`) and the event types.

## The session seam

The inside of the two SDK implementations (storage, login, suspend/resume, device verification,
their tests) is the `matrix-session` skill (`.claude/skills/matrix-session/SKILL.md`).

- `src/session.ts` is the whole Matrix client as interfaces (`SessionProvider`, `LiveSession`,
  `RoomBackend` (a `MatrixBackend` with `dispose`), `RoomDetails`, …) plus `sessions`, which loads
  one SDK lazily. `VITE_MATRIX_SDK` picks it at build time: matrix-rust-sdk by default,
  matrix-js-sdk with `npm run dev:js` / `build:js`.
- It has three implementations: `src/matrix_session/rust/`, `src/matrix_session/js/` and the
  DevBackend (`src/matrix_session/memory/devBackend.ts`). Something added to `LiveSession` is added
  to all three. Tests with faked clients: `test/rustSessionData.test.ts`,
  `test/jsSessionData.test.ts`, `test/devBackend.test.ts`. Backend methods follow the
  `widget-api-change` skill (section 4); `test/backendContract.ts` runs against all three backends.
- The DevBackend path loads no SDK code; the e2e tests rely on that.
- The `MatrixBackend` implementations stay folders inside this app (`matrix_session/*/backend/`),
  not packages (decided). SDK API that the rust build lacks goes into
  `packages/matrix-sdk-uniffi-js/sdk-additions/` (see its README).
- Neither SDK implementation has run against a homeserver beyond the login options. Say so when a
  change depends on it.

## DevBackend, seeds and the test hook

- The DevBackend is an account (`DEV_ACCOUNT_ID`); activating it switches `activeAccountId`. Its
  content lives in memory only, so its workspace (and its local widgets) are not persisted. It is
  listed while `settings.devBackend` is on (`syncDevAccount`), which is independent of
  `settings.devTools` (the Dev tools, the widget dev tools and "Add widget", for any account).
- The Dev tools (`sidePanel.view` "roomTools", `RoomToolsViewModel`, `src/views/devbackend/`) are
  one panel in two modes: while the DevBackend is active the DevBackendView (`roomTools/*` intents
  go to the DevBackend, any sender), else the rooms of the account's room panels (`roomTools/*` go
  to the room's backend as the account, `withRoomBackend` in the controller; what asks first is
  `roomChangeConfirmation` in `src/app/roomTools.ts`). Both read a room with `useRoomTimeline` and
  `useRoomState` (`LiveSession.roomState`), so the e2e tests of the DevBackendView cover the
  account's read path too.
- One `InMemoryBackend` per mocked room. Account-scoped data (media, to-device, "fail sends", TURN, RTC
  transports) is mirrored across them in `devBackend.ts`. The backend has no change notification:
  the controller calls `refresh()` after every widget message, so keep `refresh()` cheap;
  `snapshot()` returns the same object until `refresh()` finds a change (`useSyncExternalStore`).
- Seeds: `DevBackendSeed` (`src/matrix_session/memory/seed.ts`) is the content and is validated
  strictly: every object lists its known fields, an unknown field is an error. `HostSeed`
  (`src/app/controller.ts`) adds the local widgets (`localWidgets`, checked with
  `validateWidgetEvent` of `seed.ts`) and the screen (`settings`, `open`, `sidePanel`, `behavior`,
  `leftBarCollapsed`, `notifyReadyTimeoutMs`); `populate()` hands only the content fields to the
  DevBackend and always turns `settings.devBackend` on. `toSeed()` is the way back (content only).
  Examples: `e2e/seeds/*.json`.
- `window.widgetHost` (`src/app/testHook.ts`): `populate`, `state`, `dispatch`, `widgets`,
  `messages`, `driverSnapshot`, `webview` (a widget's generation and iframe attributes), `devTools`, `store`. Extend it when a test needs a fact that is not
  on screen; return plain JSON.

## Where to add …

- **An intent**: a member of `AppIntent` with a trailing comment (what it does; `confirmed?` if a
  modal confirms it) → a case in `handle()` (tsc finds the missing one) → a pure transition in
  `layout.ts` plus a case in `test/layout.test.ts` if it moves panels, tabs or dev tools → the view
  dispatches it.
- **A view**: the `widget-host-ui` process (a sketch story first: the `sketch-stories` skill); a
  folder per area in `src/views/`, a `…Props` interface, a story per state, fixtures in
  `src/views/fixtures.ts`, app-only CSS in the area's
  `src/views/<area>/<file>.css` (a new file is listed in `src/styles/app.css`).
- **A setting**: `SettingsViewModel` → `loadPersisted` in `src/app/persistence.ts` (it parses the
  settings field by field: an unlisted field is lost on reload) → `src/views/sidepanel/SettingsView.tsx`
  and its story → the views that depend on it get it as a prop. `settings/set` and
  `HostSeed.settings` need no change.
- **A persisted layout field** (`WorkspaceLayout` and what it contains): stored layouts
  (`localStorage` key `widget_host_ui_v1`) predate the field. `loadPersisted` passes each through
  `upgradeWorkspace` (`src/app/layout.ts`), which rebuilds it field by field: read the new field
  there, with a default for older layouts, and add a case to `test/layout.test.ts`; a field it does
  not read is lost on reload. A removed kind (the old `native` and `new` tabs) is dropped there.
  The other fields of `PersistedUi` are not validated: make them optional or default them where
  they are read.
- **A DevBackend feature**: a method of `DevBackend` (a Rust change to `InMemoryBackend` only via
  `widget-api-change`) → its data in `MockedRoomData` (bottom of `appViewModel.ts`), `snapshot()`,
  `EMPTY_MOCKED_ROOM_DATA` (`src/views/env.tsx`) and `MOCKED_ROOM_DATA` (fixtures) → a `mock/*` or
  `media/*` intent and its case → the section in `src/views/devbackend/` (a new collapsible section
  also needs `RoomToolsSection` and maybe the `openSections` default in `defaultRoomToolsVm`,
  `src/app/roomTools.ts`) →
  seed support (validation in `seed.ts`, `DevBackend.toSeed`) if tests should set it up →
  `test/devBackend.test.ts` → `e2e/devbackend*.spec.ts`.
- **A dev tools panel**: `DevToolPanel` → its data in `WidgetDevToolsData`, recorded by
  `WidgetRuntime`, with empty values in `emptyData()` (`widgetRuntime.ts`) and
  `EMPTY_DEV_TOOLS_DATA` (`env.tsx`) and a fixture in `DEV_TOOLS_DATA` → the view
  `src/views/widget/<Name>Panel.tsx` → a case in `DevTools.tsx` and an entry in `DEV_TOOL_PANELS`
  (`DevToolBar.tsx`; the dock positions are `DOCKS` there and `WidgetDevToolsLayout["dock"]`) →
  `e2e/devtools.spec.ts`.
- **A keyboard shortcut**: the `keydown` handler in `src/views/app/AppShell.tsx` dispatches an
  intent; show the shortcut in the button's `title`. It does not fire while a widget has focus.
- **Data from the Matrix session**: `src/session.ts` → the three implementations → a `ViewEnv`
  hook (per room, on demand) or `AccountDataViewModel` (filled by `watchRooms` in the controller).
- **Something from the driver**: `widgetRuntime.ts` (driver methods, `DriverSnapshot`) →
  `WidgetRuntimeEvents` or the dev tools store → controller. New driver API is a Rust change:
  `widget-api-change` skill; rebuilding the bindings (and restarting Vite after it): the
  `rust-host-crates` skill.

## Run and look at it

- Once (and after every Rust change, then restart the dev server: it caches the wasm): `npm run bindings` and `npm run wasm` from the root, and the rust SDK bindings
  (`npm run bindings -w packages/matrix-sdk-uniffi-js`, slow); tsc and vitest need both bindings
  packages.
- `npm run dev` from the root starts the host (5173) and the test widgets (5175).
  `http://localhost:5173/?mode=memory` opens the DevBackend; `?seed=/e2e/seeds/lab.json` opens a
  seeded screen. More URL parameters are in `README.md`.
- `npm run storybook -w @matrix-widget-tools/widget-host` (port 6006). Screenshots of a story or a
  URL: `node e2e/tools/shot.mjs` (usage in `src/views/README.md`); `shot.mjs all <dir>` shoots
  every story, to compare before and after a change that should not change pixels.
- Stop every server you started.

## Checks

```sh
cd packages/widget-host
npx tsc --noEmit            # there is no ESLint: the type checker is the linter
npx vitest run
npx playwright test         # starts or reuses the host and the test widgets
node e2e/tools/stories.mjs  # stories vs. e2e/stories.md, the tests' host.story() and the ids in comments
```

Plus the import check above. Known gaps and open decisions are in `implementation_findings.md`;
do not resolve one in passing, list it in your report.
