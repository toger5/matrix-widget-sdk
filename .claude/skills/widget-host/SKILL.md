---
name: widget-host
description: Architecture of the widget host app (packages/widget-host) and how to change it without breaking its structure. Covers the MVVM layers and their import rules, the controller and intents, the widget runtime and why the iframes live outside the React tree, the session seam (only src/matrix_session imports a Matrix SDK; rust or js build), the DevBackend, seeds and the window.widgetHost test hook, and where to add an intent, a view, a setting, a DevBackend feature or a dev tools panel. Use before changing code in packages/widget-host, and to run or look at the host app.
---

# The widget host app

`packages/widget-host`: a browser widget host on `matrix-widget-host-driver` (through
`packages/widget-host-bindings`), logged in with matrix-rust-sdk (a `js` build: matrix-js-sdk) or on
the DevBackend (mocked in-memory rooms). Paths below are relative to it.

**UI changes** follow the `widget-host-ui` agent (`.claude/agents/widget-host-ui.md`). The sessions
inside are the `matrix-session` skill; protocol changes the `widget-api-change` skill; Rust rebuilds
the `rust-host-crates` skill.

Read, do not repeat: `README.md` (running, choosing the SDK, URL parameters, the test hook, security notes),
`src/views/README.md` (rules for views, CSS, stories, `e2e/tools/shot.mjs`), `e2e/README.md` and
`e2e/stories.md` (Playwright harness, which test reaches which story), `appDesign.md` (the design),
the stories (the visual specification), the header comment of `src/appViewModel.ts` (the view model
tree), `implementation_findings.md` (open decisions, bookmarked in code as `// TODO-FINDING <name>`).

## Layers and import rules

| layer | files | may import | must not import |
|---|---|---|---|
| view model | `src/appViewModel.ts` | types from `src/session.ts`, `src/widgetStateEvent.ts` | anything with runtime state |
| view | `src/views/**` | `appViewModel`, `views/env`, `views/ui`, `views/helpers`, `src/widgetStateEvent.ts`, types from `src/session.ts` | `src/app/**`, `src/lib/**`, `src/matrix_session/**`, the bindings, an SDK |
| controller | `src/app/controller.ts`; pure helpers `src/app/layout.ts`, `persistence.ts`, `store.ts` | everything below | views (except `views/helpers`) |
| model / runtime | `src/session.ts`, `src/app/runtime/`, `src/matrix_session/**`, `src/lib/**` | bindings, `src/app/store.ts`, view model types; an SDK only inside `src/matrix_session/{js,rust}/` | views, the controller |
| composition root | `src/main.tsx`, `src/app/AppRoot.tsx` | all | |
| data | `src/exampleWidgets.ts`, `src/dock/` (pure dock model) | types only / nothing | anything else |

Check (each prints nothing when the rules hold):

```sh
cd packages/widget-host
grep -rnE 'from "((\.\./)+(lib|matrix_session)/|\.\./\.\./app/|@matrix-widget-sdk/host|matrix-js-sdk|matrix-sdk-uniffi-js)' src/views
grep -nE 'from "\.\./app/' src/views/*.ts src/views/*.tsx
grep -rnE 'from "(\.\./)+session"' src/views | grep -v ':import type '
grep -rlE '(from |import\()"(matrix-js-sdk|matrix-sdk-uniffi-js)' src | grep -vE '^src/matrix_session/(js|rust)/'
```

## Data flow

- A view sends `dispatch(intent)`; `AppController.handle()` is a `switch` over `AppIntent` whose
  `default` assigns to `never`, so `npx tsc --noEmit` lists every unhandled intent. Cases change the
  view model (`setMain` / `setWorkspace` / `setWidget` / `setAccount`, one `Store`) and run effects.
  An exception in an intent becomes a toast. Intents that lose state carry `confirmed?: boolean`
  (the confirm modal re-sends them).
- The runtime reports back through `WidgetRuntimeEvents`, which are controller events, not intents.
- High-frequency data is not in the view model: `WidgetRuntime.devTools`, `DevBackend.subscribe` /
  `snapshot()`, `LiveSession.roomDetails` / `timeline` / `roomState`. Views read it with the hooks
  of `useViewEnv()`: implemented in `viewEnv()` (`src/app/AppRoot.tsx`), faked in
  `src/views/storyEnv.tsx`, defaulted in `src/views/env.tsx`. A new hook needs all three.
- What a view needs from the bindings arrives as a value or function (view model or `ViewEnv`, e.g.
  `widgetEvents`), never as an import; stories get a fake.
- State only one view needs stays in `useState`.

## Widgets and iframes (gotchas)

- Moving an iframe in the DOM reloads it. `WidgetIframes` (`src/app/AppRoot.tsx`) renders every
  iframe into the host element's light DOM (`createPortal`, keyed `<id>#<generation>`, never moved);
  a view shows a widget only through `<WidgetSlot>` (`src/views/ui/WidgetSlot.tsx`). Never render an
  `<iframe>` in a view. `widgetSlot()` gives each widget exactly one place; PiP is derived.
- The UI lives in a shadow root: `document.querySelector` / `activeElement` do not see it; theme
  selectors are `[data-theme=…]`; styles are adopted from `src/styles/app.css?inline`, which only
  lists files in cascade layers (an adopted sheet ignores `@import`). Stories render without the
  shadow root.
- Key presses inside an iframe never reach the host.
- The iframe's `src`, `sandbox` and `allow` come only from the driver (`WidgetHostPlatform.loadIframe`
  → `WidgetInstanceViewModel.iframe` → `WidgetIframes`). Never hard-code or build them in the host.
  A webview grant makes the driver call `loadIframe` again (controller `loadIframe`: new generation,
  reload guard). The defaults are the driver's (`webview.rs`); changing them is a security decision:
  ask first.
- The driver calls platform callbacks synchronously from inside its methods: anything that calls
  back into the driver or changes the view model is deferred (`later`, a microtask). Messages are
  accepted only from the widget's `contentWindow` and its `WidgetIframe.origin`; keep both checks.
- A widget runs once per account (`WidgetInstanceId` = `<room id>|<widget key>`). Reload
  (`widget/reload`) disposes the runtime and starts a new one (`startWidget`): grants that lived
  only in the old runtime are gone.
- Which state events are widgets and whether they may load is the driver's parser, used through
  `src/lib/widgetEvents.ts`. A page of the host's own origin resolves as `sameOrigin` and opens only
  after "Open anyway" (dev tools). Strings returned by the bindings lose a leading U+FEFF, so the
  parser puts the event's own `url` and state key into the definition.

## Sessions and the DevBackend

- `src/session.ts` is the Matrix client as interfaces; `sessions` loads one SDK lazily
  (`VITE_MATRIX_SDK`; `npm run dev:js` / `build:js` for matrix-js-sdk). Three implementations:
  `src/matrix_session/rust/`, `js/` and the DevBackend (`memory/devBackend.ts`); something added to
  `LiveSession` is added to all three. The DevBackend path loads no SDK code (the e2e tests rely on it).
- The DevBackend is an account (`DEV_ACCOUNT_ID`), in memory only, listed while
  `settings.devBackend` is on (independent of `settings.devTools`). One `InMemoryBackend` per mocked
  room; account-scoped data is mirrored across them. It has no change notification: the controller
  calls `refresh()` after every widget message, so keep it cheap; `snapshot()` returns the same object
  until something changed.
- The Dev tools (`RoomToolsViewModel`, `src/views/devbackend/`) are one panel in two modes: on the
  DevBackend `roomTools/*` intents go to it, otherwise to the room's backend as the account
  (`withRoomBackend`; confirmations in `src/app/roomTools.ts`).
- Seeds: `DevBackendSeed` (`src/matrix_session/memory/seed.ts`) is validated strictly (unknown
  fields are errors). `HostSeed` (`src/app/controller.ts`) adds local widgets and the screen;
  `toSeed()` is the way back. Examples: `e2e/seeds/*.json`.
- `window.widgetHost` (`src/app/testHook.ts`): extend it when a test needs a fact that is not on
  screen; return plain JSON.

## Where to add …

- **An intent**: `AppIntent` member with a trailing comment → case in `handle()` → pure transition
  in `src/app/layout.ts` + `test/layout.test.ts` if it moves panels, tabs or dev tools.
- **A view**: the `widget-host-ui` process (sketch first); a folder per area in `src/views/`, a
  `…Props` interface, a story per state, fixtures in `src/views/fixtures.ts`, app-only CSS in
  `src/views/<area>/<file>.css` (listed in `src/styles/app.css`).
- **A setting**: `SettingsViewModel` → `loadPersisted` (`src/app/persistence.ts` parses field by
  field: an unlisted field is lost on reload) → `SettingsView.tsx` and its story.
- **A persisted layout field**: read it in `upgradeWorkspace` (`src/app/layout.ts`) with a default
  for older layouts (`localStorage` `widget_host_ui_v1`), plus a case in `test/layout.test.ts`.
- **A DevBackend feature**: a `DevBackend` method → `MockedRoomData` (bottom of `appViewModel.ts`),
  `snapshot()`, `EMPTY_MOCKED_ROOM_DATA` (`src/views/env.tsx`), `MOCKED_ROOM_DATA` (fixtures) → a
  `mock/*` or `media/*` intent → the section in `src/views/devbackend/` → seed support if tests need
  it → `test/devBackend.test.ts` → `e2e/devbackend*.spec.ts`.
- **A dev tools panel**: `DevToolPanel` → data in `WidgetDevToolsData` (recorded by `WidgetRuntime`,
  empty in `emptyData()` and `EMPTY_DEV_TOOLS_DATA`, fixture in `DEV_TOOLS_DATA`) →
  `src/views/widget/<Name>Panel.tsx` → case in `DevTools.tsx`, entry in `DEV_TOOL_PANELS`
  (`DevToolBar.tsx`) → `e2e/devtools.spec.ts`.
- **A keyboard shortcut**: the `keydown` handler in `src/views/app/AppShell.tsx`; show it in the
  button's `title`. It does not fire while a widget has focus.
- **Data from the session**: `src/session.ts` → three implementations → a `ViewEnv` hook or
  `AccountDataViewModel` (filled by `watchRooms`).
- **Something from the driver**: `widgetRuntime.ts` → `WidgetRuntimeEvents` or the dev tools store →
  controller. New driver API is a Rust change.

## Run and check

- Once, and after every Rust change (then restart the dev server, it caches the wasm): `npm run
  bindings` and `npm run wasm` from the root; the rust SDK bindings
  (`npm run bindings -w packages/matrix-sdk-uniffi-js`, slow). tsc and vitest need both.
- `npm run dev` (root): host on 5173, test widgets on 5175; `?mode=memory` opens the DevBackend,
  `?seed=/e2e/seeds/lab.json` a seeded screen.
- `npm run storybook -w @matrix-widget-tools/widget-host` (6006); `node e2e/tools/shot.mjs` for
  screenshots (`shot.mjs all <dir>` before and after a change that should not change pixels).
- Stop every server you started.

```sh
cd packages/widget-host
npx tsc --noEmit            # no ESLint: the type checker is the linter
npx vitest run
npx playwright test
node e2e/tools/stories.mjs  # stories vs. e2e/stories.md and every story id named in docs and tests
```

Plus the import check above. Do not resolve an open finding in passing; list it in your report.
