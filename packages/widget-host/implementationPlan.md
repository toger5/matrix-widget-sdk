# Implementation plan

> **Historical.** The plan of the first implementation (commit `c1ef94d`); it is not kept up to date, and some files named in section 1 do not exist. Section 2 (moving widgets without a reload) still describes how the app works. The current structure is in [README.md](README.md) and [src/views/README.md](src/views/README.md).

How the design ([appDesign.md](appDesign.md), [designFeedback.md](designFeedback.md), `design/`) becomes the app. What came up on the way is in [implementation_findings.md](implementation_findings.md).

1. [Gaps in the existing code](#1-gaps-in-the-existing-code)
2. [Moving widgets without a reload](#2-moving-widgets-without-a-reload)
3. [MVVM](#3-mvvm)
4. [Views](#4-views)
5. [Playwright tests](#5-playwright-tests)

## 1. Gaps in the existing code

The list is "Prerequisites in the existing code" at the end of designFeedback.md. No Rust crate and no widget API is changed for any of them; where a clean fix needs that, the gap is closed in TypeScript and recorded as a finding.

| Gap | Plan | Where |
| --- | --- | --- |
| Multi-account | `SessionProvider.stored()` / `restore(accountId)` / `clearStored(accountId)`; every login has its own storage namespace; a login in the old single-key layout is migrated | `src/session.ts`, `src/matrix_session/{js,rust}` |
| No Matrix requests while the DevBackend is active | `LiveSession.suspend()` / `resume()`; the controller suspends every Matrix session when the DevBackend becomes the active account | same |
| Several mocked rooms, shared media | `DevBackend` keeps one `InMemoryBackend` per room and mirrors media and to-device messages between them | `src/matrix_session/memory/devBackend.ts` |
| Widgets of a mocked room | The widget list is derived from the room state, so a widget state event sent from the DevBackendView adds a widget | same |
| Driver panel "Add" and "Approve" | "Add" pre-approves: the capability joins the driver's auto-approved set and is granted the next time the widget asks. There is no "denied" list in the driver; the host records what it denied itself | `src/app/runtime/widgetRuntime.ts` |
| `RoomBackend` lifetime | Ref-counted per (account, room) in the runtime registry; a widget holds one reference | `src/app/runtime/backends.ts` |
| Iframe layer | See section 2 | `src/app/WidgetIframes.tsx`, `src/views/ui/WidgetSlot.tsx` |
| Synchronous platform callbacks | `setAlwaysOnScreen` answers `true` and updates the store (which lives outside React). `navigate` keeps the synchronous `window.confirm` | `src/app/runtime/widgetRuntime.ts` |
| Data `LiveSession` does not provide | `account()`, `roomDetails()`, `exportRoom()`, `RoomSummary.memberCount` | `src/session.ts` and the three sessions |
| Fields without a source | The DevBackend records when it first saw a to-device message or a scheduled event and the file name of host uploads. Which widget scheduled or uploaded something stays unknown | `devBackend.ts` |
| e2e contract | The URL parameters still start the in-memory mode. `window.widgetHost` is the test hook: `populate(seed)`, `state()`, `messages(widgetId)`, `driverSnapshot(widgetId)`, `store(roomId)` | `src/app/testHook.ts` |
| No place in the design yet | Password login is part of the login form. Unresolvable widget events are disabled tiles. The store tools (TURN, account data, RTC transports) are methods of `DevBackend` without UI | findings |

## 2. Moving widgets without a reload

A widget is an iframe, and an iframe reloads when its DOM node is removed and inserted again. A widget has to move between a tab, another room panel and the PictureInPicturePanel while it keeps running (a call must not drop).

Measured in Chromium, Firefox and WebKit (Playwright builds, 2026-11-16) with an iframe holding a random token and a typed input value:

| Technique | Chromium | Firefox | WebKit | Verdict |
| --- | --- | --- | --- | --- |
| `appendChild` to the new place | reloads | reloads | reloads | no |
| Shadow DOM, moving the iframe between shadow trees | reloads | reloads | reloads | no: a shadow root does not change what a move is |
| **Shadow DOM slots**: the iframe stays a light-DOM child of the host element, the shadow tree renders `<slot name="widget-<id>">` where the widget is shown | keeps state | keeps state | keeps state | **chosen** |
| `Element.moveBefore()` | keeps state | keeps state | not available | not yet |
| One persistent layer, each iframe positioned over a placeholder with JS | works by construction | | | fallback |

**Slots (chosen).** A slotted element is displayed at the position of its slot but never leaves its place in the DOM. So:

- `main.tsx` creates one host element with an open shadow root. The whole UI (React) is rendered into the shadow root.
- `WidgetIframes` renders one `<iframe slot="widget-<id>">` per running widget as light-DOM children of the host element: a flat list keyed by widget id, never reordered.
- A view shows a widget by rendering `<WidgetSlot widgetId>`, which is a `<slot name="widget-<id>">`. Where the view model says the widget is (`widgetSlot()`: a tab body, a PiP box, nowhere), that is where a slot is rendered. Nothing is measured and nothing is positioned.
- While no slot of a widget exists (its tab is not active and it is not always on screen) the iframe is not displayed but keeps running, like `display: none`.

What this gives compared with the layer: the widget is part of the normal layout, so rounded corners, clipping, scrolling, resizing, tooltips, menus and modals need no z-index or geometry code, and there is no frame of lag while a panel is dragged.

What it costs:

- Styles must be inside the shadow root. `app.css` is imported as text (`?inline`) and adopted by the document (for the tokens on `:root`) and by the shadow root. `@import` does not work in an adopted stylesheet, so the fonts are self-hosted (`@fontsource`).
- Selectors with `:root[data-theme]` do not reach into a shadow tree: the theme attribute is also set on the app's root element and the selectors are `[data-theme=…]`.
- Storybook renders views without the shadow root. There a `<slot>` shows its children, which is where a story puts a stand-in widget.
- Anything that searches the document (`document.querySelector`, focus traps, `document.activeElement`) must use the shadow root. Playwright locators pierce open shadow roots.
- A widget must have at most one slot on screen. The view model guarantees it: `widgetSlot()` returns one place.

**Fallback (layer).** If slots turn out not to work somewhere (an embedding that cannot use a shadow root): keep `WidgetIframes` as it is, give the host element `position: relative`, and let `WidgetSlot` render a placeholder `<div>` whose rectangle (ResizeObserver + scroll listeners) positions the iframe absolutely. Only `WidgetSlot` and `WidgetIframes` change; no view does. Its known problems are the ones named in the task: z-order against tooltips and modals, clipping by rounded containers, and lag while dragging.

**`moveBefore()`** would allow a plain React tree. It is missing in WebKit, and React does not use it for keyed moves across parents. Revisit when both changed.

Switching the account still unmounts every iframe: the widgets of an inactive account do not run. Restoring a workspace starts its widgets again.

## 3. MVVM

| Layer | What | Where |
| --- | --- | --- |
| Model | Sessions, room backends, drivers, iframes, the DevBackend | `src/matrix_session`, `src/app/runtime` |
| View model | One serialisable `AppViewModel` + derived functions + the `AppIntent` union | `src/appViewModel.ts` |
| Controller | Holds the view model in a store, turns intents into view model changes and effects, feeds runtime events back into the view model, persists the layout | `src/app/controller.ts`, `src/app/layout.ts` (pure transitions, unit tested) |
| View | Pure components: props are slices of the view model; `useDispatch()` sends intents; hooks of `useViewEnv()` read high-frequency data (dev tools log, mocked room content, room details) | `src/views` (rules in `src/views/README.md`) |

Steps:

1. Shared atoms, tokens and the view environment; Storybook (`npm run storybook`).
2. The views, built in parallel against stub files that fix each view's props (section 4), each with a few stories compared against its mockup leaf by screenshot.
3. The controller and the runtime (`AppController`, `WidgetRuntime`, backends registry, persistence, test hook), then `main.tsx` puts them together and the old `App.tsx`, `LoggedInView`, `RoomView`, `WidgetView`, `MemoryView`, `MemoryStorePanel` go away.
4. Playwright tests (section 5).

High-frequency data stays out of the view model: `WidgetRuntime.devTools` (one store per widget) and `DevBackend.snapshot()` are read with `useSyncExternalStore`.

## 4. Views

Each view ports the markup of its mockup function (`design/src/components.mjs`) and is styled by `src/styles/app.css` (a copy of `design/mock.css`).

| View | Files | Props (view model slice) | Mockup functions | Leaves | Intents |
| --- | --- | --- | --- | --- | --- |
| AppShell | `views/app/AppShell.tsx` | `vm` | `app` | `app/*`, `complete/*` | keyboard shortcuts, `leftBar/expand`, `panel/focus`, `toast/dismiss` |
| LoginView | `views/app/LoginView.tsx` | `login`, `adding` | `loginPage` | `app/login` | `login/*` |
| LeftBar | `views/app/LeftBar.tsx` | `leftBar`, `devTools`, `devBackendActive`, `sidePanelView`, `account` | `leftBar` | `leftbar/*` | `modal/open`, `panel/new`, `devBackend/toggle`, `sidePanel/toggle`, `leftBar/collapse` |
| Modal | `views/app/Modal.tsx` | `modal` | `infoModal`, `confirmModal` | `app/info-modal`, `app/confirm` | `modal/close`, the confirmed intent |
| SidePanel | `views/sidepanel/SidePanel.tsx` | `main`, `settings` | `sideBox`, `sideTitle` | `sidepanel/closed`, `roomsarea/shifted` | `sidePanel/*` |
| AccountView | `views/sidepanel/AccountView.tsx` | `accounts`, `activeAccountId` | `accountView` | `sidepanel/account-*` | `account/*` |
| SettingsView | `views/sidepanel/SettingsView.tsx` | `settings`, `devBackendActive` | `settingsView` | `sidepanel/settings-*` | `settings/set` |
| DevBackendView | `views/devbackend/*` | `devBackend`, `canLeave`; data: `useMockedRoomData()` | `devBackendView` and its sections | `devbackend/*` | `mock/*`, `media/*`, `devBackend/leave` |
| RoomsArea, RoomPanel | `views/rooms/RoomsArea.tsx`, `RoomPanel.tsx` | `main`, `settings`, `fullscreen`, `renderWidget` | `roomPanel`, `app` (empty area) | `roomsarea/*`, `app/devbackend-empty`, `app/fullscreen*` | `panel/*` |
| RoomPicker | `views/rooms/RoomPicker.tsx` | panel, `main.data` | `recentsBody`, `allRoomsBody` | `panel/*` | `picker/setMode`, `panel/openRoom` |
| RoomView, TabBar, WidgetTiles | `views/rooms/*` | panel content, `main.widgets` | `roomHeader`, `tab`, `tabMenu`, `tilesBody` | `roomview/*`, `tabs/*`, `roomview2/*` | `tab/*`, `widget/jumpToTab`, `devTools/toggle` |
| RoomOverview | `views/rooms/RoomOverview.tsx` | `main`, `roomId`, `devTools`; data: `useRoomDetails()` | `overviewBody` | `overview/*` | `tab/openWidget`, `room/copyToDevBackend` |
| WidgetView | `views/widget/WidgetView.tsx` | `widget`, `devTools`, `compact`, `tab` | `widgetView` | `widgetview/*` | `widget/retry`, `widget/answer*` |
| WidgetDevToolBar and panels | `views/widget/DevToolBar.tsx`, `MessagesPanel.tsx`, `StatsPanel.tsx`, `DriverPanel.tsx`, `ConsolePanel.tsx` | `devTools`; data: `useDevToolsData()` | `devToolBar` and the panel functions | `devtools/*` | `devTools/*` |
| PipPanel | `views/pip/PipPanel.tsx` | `pip`, `items`, `more`, `renderWidget` | `pip` | `pip/*` | `pip/*`, `widget/jumpToTab`, `widget/close`, `devTools/toggle` |

`renderWidget(widgetId)` is created by the AppShell and passed to RoomsArea and PipPanel, so neither imports the WidgetView. It is called for the place `widgetSlot()` names, and only there.

## 5. Playwright tests

Only the DevBackend mode is used, so no test needs a homeserver. Leaves that need a Matrix account (several accounts, restore failures, "Copy to DevBackend" from a real room) are listed as not reachable in `e2e/leaves.md`.

- **One page per worker.** A worker-scoped fixture opens the host once (`?mode=memory`); wasm is loaded once. `playwright.config.ts` starts the host (5173) and the test widgets (5175) and reuses running servers.
- **Seeds instead of clicks.** `await host.populate("lab")` loads `e2e/seeds/lab.json` and calls `window.widgetHost.populate(seed)`: it stops every widget, closes every panel, replaces the content of the DevBackend and applies the seed's `open` list (rooms and widgets to open) and `settings`. A test therefore starts from a known screen in a few milliseconds.
- **Shape of a test:** populate, press a few buttons, assert, done. The next test populates again; nothing is torn down.
- **Leaves.** Every test names the leaf it reaches (`leaf("tabs/pinned")`), which also saves a screenshot under `leaf-screenshots/` to compare with `design/leaves/`.
- **Assertions** use roles and accessible names (the names of the mockups). For the widget API they read `window.widgetHost.messages(widgetId)` and `driverSnapshot(widgetId)` instead of the DOM of the message log.
