# Design feedback

> **Historical.** The record of the review rounds of the first design (2026-11-16); it is not kept up to date. The current design is [appDesign.md](appDesign.md) and `design/`, open decisions are in [implementation_findings.md](implementation_findings.md). The accessibility list "Later, for the implementation" below is still a requirement.

Feedback collected while drawing the mockups for [appDesign.md](appDesign.md) (`design/index.html`) and the view model (`src/appViewModel.ts`).

**Round 1.** Four reviewers looked at the first complete pass, each with a different job:

| Reviewer | Looked at | Question |
| --- | --- | --- |
| Spec | appDesign.md, all leaves, ~60 screenshots | Is every required state drawn, and does a mockup contradict the document? |
| UX / visual | the reference image, ~40 screenshots in both themes | Would a designer sign this off? |
| Accessibility | the color tokens, the markup, screenshots | Does it meet the requirements in "Details" (WCAG AA, ARIA, target sizes)? |
| Implementation | `appViewModel.ts`, the current app code, the leaves | Can the model express every mockup, and does it fit the existing code? |

**Round 2 (2026-11-16).** You answered the open decisions. The answers are worked into the mockups, appDesign.md and the view model; they are listed under [Decided](#decided).

Status of each item in the tables: **done** (changed in the mockups or the view model), **open** (needs your decision), **later** (a requirement for the implementation; a static mockup cannot show it), **superseded** (overtaken by a round 2 decision).

## Decided

| Topic | Decision | Mockups |
| --- | --- | --- |
| Leaving the DevBackend | No header strip. Three ways out: press the DevBackend button in the LeftBar again (tooltip "Leave DevBackend"), switch to an account in the AccountView, or the quiet link-like text button "Leave DevBackend" at the bottom of the DevBackendView | `leftbar/devbackend-hover`, `devbackend/*` |
| Account icon in the DevBackend | It is the DevBackend icon, in the LeftBar and in the AccountView | `leftbar/devbackend`, `sidepanel/account-dev` |
| "Add account" | The last entry of the switch list, also in DevBackend mode. No longer one of the buttons | `sidepanel/account-*` |
| Tab style | Every tab has a slightly different background than the header. Only the active tab has a border. No accent color. An always-on-screen tab only gets the pin icon | `tabs/*` |
| Dev tool panels | No full-width panel and no second row. At most three panels next to each other; opening a fourth closes the oldest. The console is a normal panel | `devtools/fourth-panel` |
| A widget runs once per account | An already open widget is grayed out with "jump to tab". If it is open in another room panel it also offers "move widget here", which closes the tab there and opens the widget here | `roomview/new-tab`, `roomview2/same` |
| Always on screen | It first only adds the pin icon to the tab. Moving away from the widget opens it in the PiP panel. Pressing its tab again closes it there. The "moved to the floating panel" placeholder is gone | `tabs/pinned`, `pip/*` |
| PiP close and limit | Close stops (kills) the widget: an always-on-screen widget otherwise always stays running. No limit on widgets; the container shows 4 boxes and lists the others in an overflow menu | `pip/overflow`, `pip/overflow-menu` |
| Fullscreen | The room header stays. The tab is not shown (only one widget is open) and the + button is not shown by default | `app/fullscreen`, `app/fullscreen-hover` |

How I read four points of your answer. Say if one is wrong:

1. **Second row.** You first asked to show the full-width panel as a second row, and further down to drop the second row and cap the panels at three. I took the later statement.
2. **"Move widget here"** is only offered when the widget is open in *another* room panel. In the same panel the tile only offers "jump to tab".
3. **Fullscreen, "not shown by default".** The tab and the + button appear while the header is hovered or focused (`app/fullscreen-hover`). That is the only way I see to reach them.
4. **Closing the tab of an always-on-screen widget.** I treat it as "moving away": the widget keeps running in the PiP panel, and only the close button there stops it. The same goes for closing its room panel. This is only in the view model (`tab/close`), not in appDesign.md.

Two lines of your message were only leaf titles without a comment ("DevBackend mode (full account list)" and "State: shortcuts, send (delayed) state, state explorer"). Nothing changed there beyond the points above.

## Still open

Points from round 1 that you did not comment on (the mockups keep my pick), and questions the round 2 decisions raise.

1. **DevBackend badge.** A vertical "DEVBACKEND" label in the LeftBar under the cone button. While the LeftBar is collapsed (and in fullscreen, where no fence is visible) a floating badge at the top takes over (`app/devbackend-collapsed`).
2. **Native tabs.** "Slightly transparent labels" fail AA contrast on inactive tabs (3.7:1 to 4.4:1). Only the active native tab keeps 80% opacity; inactive ones differ by their glyph and weight.
3. **⋯ and × on tabs** are shown on the active tab only; on the others they appear on hover and keyboard focus. Otherwise labels shrink to two letters in a narrow panel.
4. **Dev tools docked left or right.** The bar becomes a vertical strip and the panels stack instead of sitting next to each other (`devtools/side-panels`).
5. **Collapsed message rows** also show the time and the dimmed `org.matrix.mscXXXX.` prefix. The document lists only direction, action and response state.
6. **The dev tool bar** also carries a status dot, counters, the dock switch and a close button. The document says it "only has buttons to open and close specific panels".
7. **To-device messages** stay in the per-room page; "Details" suggests moving them next to the media box because they are account-scoped.
8. **Additions that are not in the document:** theme override in the Settings (from "Details"); "Auto-approve OpenID tokens", "Remember capabilities" and "Fail sends" under WidgetHostBehavior (all three exist in the app today); a "last events" count next to "Copy to DevBackend"; a panel pager in narrow windows, where only one room panel is visible.
9. **Fence.** Stripes are 11px wide (22px period) and the gaps between panels grow from 8px to 14px while the DevBackend is active. With the original wide stripes the gaps only showed random blocks.
10. **Fullscreen and a second tab.** As written, opening a second widget (through the + button) ends "only one widget is open", so the rounded containers come back. Should fullscreen instead mean "one room panel", with the tabs shown as soon as there are several?
11. **Which PiP boxes are visible.** The first four always-on-screen widgets in the order they were started. The overflow menu offers "jump to widget" and "close" per widget, but no way to swap a hidden one into the panel.
12. **Dev tools from the PiP panel.** A box can close its dev tools but not open them.
13. **Tab ×, tab + and panel × are close together and look alike.** Suggested: move "close panel" into a menu, or confirm when the panel has several tabs.
14. **Dev tools toggle is ⋯**, which reads as a menu. The document asks for three dots; the PiP panel uses the same glyph.
15. **Leaving the DevBackend after "skip login".** There is no account to go back to. The view model shows the login page then; the document does not say.
16. **Pin icon.** It is the only always-on-screen marker now, so it is drawn as a 13px icon after the tab label. The round 1 version (a small badge on the widget icon) was hard to recognise.

## Gaps in appDesign.md

States that exist (some in today's app) but are not in "Required visualisations". The ones marked *drawn* were added as extra leaves.

- Capability prompt and OpenID prompt of a widget: *drawn* (`widgetview/prompt`). Open: what a prompt looks like inside a 224×140 PiP box.
- Device verification (emoji and recovery key), which `LoggedInView` has today: not drawn. The AccountView only shows "This device is verified".
- "Restoring" and "the stored login could not be started": not drawn. The model moves the failure to the account (`AccountViewModel.status`), because with several accounts one can fail while another works.
- Adding a second account needs the login form while logged in: not drawn (`MainViewModel.addAccount`).
- Empty RoomsArea right after the DevBackend was activated: *drawn* (`app/devbackend-empty`).
- Confirmation dialog for actions that lose state: *drawn* (`app/confirm`).
- Loading and error state of a list: *drawn* for the empty room panel (`panel/loading`, `panel/error`); the other lists follow the same pattern.
- "Send delayed state" is only a toggle in the state form; the delayed-on form and the "Scheduled" list are drawn for timeline events (`devbackend/timeline-delayed`).
- The shortcuts in the document (Ctrl+N, Ctrl+Shift+N, Ctrl+W) contradict "Details" (a browser tab cannot bind them). The mockups show Alt+N, Alt+Shift+N and Alt+W in the tooltips.

While the round 1 mockups were drawn, three lines were added to appDesign.md (empty room panel: no title, centered tiles like the reference image). The spec reviewer caught the mismatch; the empty panel was redrawn (`panel/recents`).

## Spec review

47 of the 53 required leaves mapped cleanly in the first pass; none was missing.

| Finding | Status |
| --- | --- |
| Empty room panel had two titles and a list instead of untitled, centered tiles | done |
| Widgets shown in the PiP panel had no pin marker on their tab | done |
| `pip/enlarged-devtools` showed the same widget in the PiP panel and in its tab | done: a widget is in the PiP panel only while its tab is not the active one |
| Tab bars were clipped without the "all tabs" button in narrow panels | done in the mockups; **later**: detect overflow at runtime and keep the active tab in view |
| The console was the full-width overlay in one leaf and a normal panel in two others | superseded: there is no full-width panel |
| No badge without the LeftBar | done: floating badge, extra leaf |
| `roomview2/same` contradicted its own note (a widget open in both panels) | done |
| `tabs/overflow`: duplicate widgets, "New tab" labelled "Room overview" | done |
| No tooltip for the same-room shortcut | done (on the + button) |
| Round 2 check: `tabs/overflow` showed a pinned inactive tab without its PiP box; `roomview/header` was too narrow to show the counts; a PiP box showed the same sample widget as the tab behind it | done |
| Failure text said 10 s; the app waits 15 s for `notify_ready` | done |
| Empty RoomsArea, confirm dialog, list loading/error, narrow-window panel switch never drawn | done as extra leaves |
| Collapsed message rows, bar extras | open (points 5 and 6) |

## UX and visual review

Works well and was kept: the technical look of the dev tools against the rounded app chrome; the dock logic; the amber dashed "dev" language (login skip card, dev card in the room overview, badge); the DevBackendView structure; the widget loading and failure states; the narrow-window overlay, the info modal and the login page.

| Finding | Status |
| --- | --- |
| Tabs overloaded borders: solid = active, dashed = native, 2px = pinned, so a pinned inactive tab looked more selected than the active one | superseded by the decided tab style |
| Room header and tabs truncate each other below ~500px panel width | done: the header drops the counts first, then the name (avatar only) |
| Clipped tabs were cut mid-letter | done: fade + "all tabs" button |
| No visible way out of the DevBackend | done as decided (the header strip of round 1 is gone) |
| Docked left/right: count badges were rotated and clipped | done: badges stay upright |
| Chart text scaled with the SVG down to ~5px; the legend was cut in half-width panels | done: text is HTML at a fixed 11px, only the lines scale; narrow panels drop the legend and keep the direct labels |
| Full-width overlay was offset and looked like a z-index bug | superseded: there is no full-width panel |
| "Jump to tab" covered the widget icon and name | done: the buttons sit at the bottom of the tile |
| "Copy to DevBackend" row did not wrap in a narrow panel | done |
| Toast covered the widget's controls; expand button overlapped the widget | done: toast at the top, expand button is a handle on the left edge where the collapse button was |
| PiP covered the call's hang-up button; dark boxes blended into a dark widget | done: moved in the mockup, boxes get a thin ring. **later**: snap to panel corners |
| PiP "jump" used the external-link arrow; resize corner was 6px; "close" was ambiguous | done: own "go to tab" icon, 24px corner, close is "stops the widget" as decided |
| Collapsed accordion sections were pinned to the bottom of the box | done: they follow the open section |
| All-rooms search showed dimmed non-matches with a mock-only note | done: only matches |
| Selected segment ("System") and selected chip were nearly invisible in the light theme | done |
| No sash between dev tool panels | done: 8px handle with a visible line |
| Fence turned into random blocks in the gaps | done (point 9); an amber tint on the lighter stripe was suggested and not done |
| Hovering the PiP panel adds a title row and label rows | later: the boxes must not move; the surround grows outward, with a short hover-out delay |
| Tab ×, tab +, and panel × are close together and look alike | open (point 13) |
| Dev tools toggle is ⋯, which reads as a menu | open (point 14) |
| The room header gives no hint that it opens the overview; the green dot in the dev tool bar is unexplained | later: hover state; the dot has a tooltip ("Widget is ready") |
| All sample widgets are dark, so the light theme is hard to judge against real content | not done |

## Accessibility review

Contrast was computed for every text/background pair of both themes. After the round 1 changes below, the reviewer's script reports no failing text pair (re-run with the new values). The round 2 tab style was not re-measured; it uses the same text tokens on `--surface-2` and `--surface-3`, which were part of the measured pairs.

| Finding | Status |
| --- | --- |
| `--text-faint` below 4.5:1 on tinted rows and placeholders (both themes) | done: `#8d8d96` dark, `#63636a` light |
| Light theme: `--highlight`, `--dev`/`--warning`, `--danger` just below 4.5:1 on tinted fills | done: `#177249`, `#7f5300`, `#bd261b` |
| `--border-strong` below 3:1 as the outline of inputs, toggles, tabs | done: `#6f6f7b` dark, `#84847e` light |
| Controls outlined only with `--border` (1.3:1): chips, segmented control | done: controls use `--border-strong`; `--border` is for dividers only |
| Selected state shown by a fill only (segment, dock button, chip, tree row) | done: each has a border or bar as well. The active tab has a border and the full text color |
| Drag grips below 3:1 | done: grips use `--text-muted` |
| Dimmed content failed AA: opened tiles (32% opacity), native tab labels (72%) | done: tiles dim only the icon; native tabs see open point 2 |
| White initials on some avatar hues (4.0:1) | done: avatar lightness 33% |
| Buttons nested inside `role=tab` | done in the markup: the tab is a button, × and ⋯ are siblings, named per widget |
| Widget tiles were not focusable | done: tiles are buttons |
| Icon-only dev tool buttons were named "42" and "2"; the error count was a red fill only | done: `aria-label`, plus an icon |
| Message direction was an arrow of a certain color | done: text badges `W→H` / `H→W` with an accessible name |
| Separators without name and value; handles thinner than 8px | done: 8–10px, `aria-label`, `aria-valuenow`. **later**: arrow keys, Home/End, Enter to reset |
| Targets below 24×24px (tab buttons, dock buttons, small icon buttons, message rows, toggles, chips) | done |
| 10px text in several places | done: 11px minimum |
| Focus ring clipped inside the tab bar and other clipping containers | done: drawn inwards there |
| Toggles were spans | done: `button role=switch` |

Later, for the implementation (not visible in a static mockup):

- Tabs: `role=tabpanel` + `aria-controls`; arrow keys; Delete closes; the "all tabs" button needs `aria-haspopup`/`aria-expanded` and a real menu (`menuitemradio`).
- Dev tool bar: roving tabindex; the dock trio is a radio group.
- Room dropdown: "Add room" is an action and belongs outside the listbox.
- PiP panel: its controls only exist on hover. Show them on `:focus-within` too, and offer move/resize by keyboard.
- Fullscreen: the tab and the + button must also appear on keyboard focus, not only on hover.
- Labels for every input (search fields are placeholder-only); the state explorer needs tree or disclosure semantics; filter chips and segmented controls need button/radio roles everywhere.
- Tooltips are `title` attributes in the mockups (except the drawn "Leave DevBackend" one); a keyboard user never sees them. Use a tooltip component.
- Modal: focus trap, Escape, return focus. Chart: a data table or text alternative with values.
- The two chart colors have the same luminance; the dashed line and the direct labels carry the difference, so both must stay.

## Implementation review (view model)

Kept as proposed: the flat map of running widgets with tabs holding ids; the DevBackend as an account; global settings; no SDK objects in the model; the three tab kinds; sizes as flex shares.

Changed in `src/appViewModel.ts` after the round 1 review:

| Finding | Change |
| --- | --- |
| Message log, console, stats and mocked-room content in the model: every postMessage would create a new `AppViewModel` | Moved out. The model keeps the dev tools *layout*; the data is `WidgetDevToolsData` / `MockedRoomData`, read from per-widget and per-room stores |
| Persisted layout and runtime state were mixed | `WorkspaceLayout` (serialisable, per account, in `workspaces`) is separate from the runtime `widgets` map |
| The inactive accounts' workspaces had no place, so switching could not restore them | `MainViewModel.workspaces: Record<AccountId, WorkspaceLayout>` |
| Tabs referenced runtime ids | The widget id is derived: `widgetInstanceId(roomId, widgetKey)` |
| DevBackend UI state lived inside the SidePanel and was lost when it closed | `MainViewModel.devBackend`; `SidePanelViewModel` is `{ view?, width }` |
| Stored derived state: tile `openIn`, `narrow`, per-panel copies of rooms and widgets | Removed. `widgetSlot`, `widgetTab` and `data.rooms` answer them |
| A PiP widget whose room panel is closed could not be expressed | A widget no longer stores its tab; `widgetTab` may return nothing |
| Capability and OpenID prompt can be pending together | `prompts: { capabilities?, openId? }`, two intents |
| A screen-level "restore failed" cannot say which account failed | `AccountViewModel.status` and `error` |
| No login state for "add account", no login intents | `LoginViewModel`, `MainViewModel.addAccount`, `login/*` intents |
| Per-box PiP sizes in one mockup | One `boxSize`; the mockup was fixed |
| Actions mixed intents with effects; several were missing | Renamed to `AppIntent`, handled by a controller; added restore retry, tab move, room removal, send form, media resize, capability revoke/grant |
| `rememberCapabilities` missing | Added to `WidgetHostBehavior` |

Changed for the round 2 decisions:

| Decision | Change |
| --- | --- |
| Always on screen only adds the pin; the PiP panel shows the widget while its tab is not shown | `WidgetInstanceViewModel.alwaysOnScreen` (set by the widget). The PiP content is derived: `pipWidgetIds`. `PipViewModel.widgetIds` and the `widget/unpin` intent are gone |
| No limit on always-on-screen widgets | `PIP_VISIBLE_BOXES = 4`; `widgetSlot` answers "hidden" for a widget in the overflow |
| PiP close stops the widget | `widget/close` is the way to stop an always-on-screen widget; `tab/close` leaves it running (my reading, see above) |
| At most three dev tool panels, no full-width panel | `MAX_DEV_TOOL_PANELS = 3`; `overlayPanel` and `FULL_WIDTH_PANELS` are gone |
| "Move widget here" | `tab/moveWidgetHere` |
| Leaving the DevBackend with its LeftBar button | `devBackend/toggle` and `MainViewModel.returnAccountId` (the account to go back to) |
| Fullscreen keeps the header | `fullscreenWidget` no longer excludes open dev tools or PiP widgets |

Prerequisites in the existing code. The design cannot be built on these as they are:

- **Multi-account.** `SessionProvider` holds one login: both SDK sessions use a single storage key and `restore()` returns one session.
- **"No Matrix requests while the DevBackend is active."** `LiveSession` has no suspend, only `logout()`.
- **Several mocked rooms with shared media.** `InMemoryBackend.new(room_id, user_id)` is one room with its own media, to-device list and `fail_sends`.
- **Widgets of a mocked room.** `MemorySession` keeps widget events in a private array, so sending a widget state event from the DevBackendView would not add a widget.
- **Driver panel "Add" and "Approve".** `approve_capabilities` only grants what the pending request contains, and `DriverSnapshot` has no denied list. Both need driver changes (widget-api-change checklist), or the buttons go.
- **`RoomBackend` lifetime.** `RoomView` owns and disposes it today. It must be ref-counted per (account, room), or closing a panel kills PiP widgets and the second panel on the same room.
- **Iframe layer.** Render one flat list keyed by widget id in a stable order: React moves DOM nodes when keyed siblings reorder, which reloads the iframes. Switching the account unmounts all iframes, so "restore" restores the layout and starts the widgets again.
- **Synchronous platform callbacks.** `setAlwaysOnScreen` returns a bool synchronously (today always `false`). Without a limit it can always answer `true`, but the store still has to be writable outside React. The `navigate` confirmation is a synchronous `window.confirm` and cannot become an async modal as is.
- **Data `LiveSession` does not provide:** display name, user avatar, homeserver, device id, account page URL, room topic, members and member count, encryption state. "Copy to DevBackend" needs all state plus the last N events, but `read_room_events` and `read_room_state` require an event type.
- **Fields the mockups show without a source:** when a delayed event fires and which widget scheduled it (`DelayedEvent` has `delay_ms` and `restarts`); timestamp and sender widget of to-device messages; file name and uploader of media.
- **e2e contract.** The URL parameters (`mode=memory`, `room`, `user`, `event`, `autoload`, `autoApprove`, `wrapper`) have no entry point in the model yet, and the README promises plain-DOM assertions on the full message log, the driver snapshot JSON and the store dumps. A virtualised, collapsed log breaks them; keep a test hook.
- **No place in the design yet:** password login, unresolvable widget events (listed disabled today), "reload widgets", a widget URL changing while it runs, the store-panel tools (TURN, room account data, RTC transports, clear store, media download), and the log kinds `err`/`info`/`sdk` (`onDriverLog` is global, so SDK lines cannot be attributed to one widget).
