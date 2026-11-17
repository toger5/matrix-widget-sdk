# Implementation findings

What came up while the design ([appDesign.md](appDesign.md), [designFeedback.md](designFeedback.md), the stories) was implemented ([implementationPlan.md](implementationPlan.md)). A designed detail that is not built is a sketch story (`Sketch/…`, named in its finding).

- **Controversial**: there is no clear best option, so you decide. Every one is marked in the code with `// TODO-FINDING <name> - <details>`; search for the name to find the place. "Now" is what the code does until you decide.
- **Trivial**: there is a clear best option. They are listed at the end.

```sh
grep -rn "TODO-FINDING" src e2e        # all bookmarks
grep -rn "TODO-FINDING <name>" src     # one finding
```

## Corrections to the design documents

Not decisions, but statements in the documents that turned out wrong or outdated. The documents were not edited.

- `src/appViewModel.ts` differs from `implementationPlan.md`: the LeftBar's Dev tools button never switches accounts (`sidePanel/toggle` "roomTools"; `devBackend/activate` and `devBackend/leave` are the text buttons at the bottom of the Dev tools, `canLeaveDevBackend` decides the latter), `widget/close` asks for confirmation, `WidgetInstanceViewModel.generation` is new, and the views added `picker/reloadRooms` and `devTools/copyMessage`.

## Controversial

### Widget runtime and driver

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `driver-grant-capability` | `src/app/runtime/widgetRuntime.ts` (`grant`) | "Add" in the driver panel: the driver only grants what a pending request contains | (a) new driver method that grants to a running widget (widget-api-change checklist; may a host grant what was not requested?) (b) pre-approve only (c) remove the button | (b): the capability joins the auto-approved set and is granted the next time the widget asks. For a one-use capability (`get_openid`) that is "Always": every next token without asking, remembered when remembering is on; also "Approve" of the Denied list |
| `driver-denied-list` | `widgetRuntime.ts` (`refreshCapabilities`) | The driver panel shows "denied", `DriverSnapshot` has no such list | (a) the driver reports it (b) the host records it | (b): what this host denied since the widget started, minus later grants. Lost on reload |
| `navigate-confirm-is-synchronous` | `widgetRuntime.ts` (`navigate`) | The driver's `navigate` callback must answer synchronously, so the confirmation cannot be the app's modal | (a) async platform callback in the driver (b) answer "ok" at once and ask afterwards (c) keep `window.confirm` | (c) |
| `console-panel-source` | `widgetRuntime.ts` (constructor) | The console panel should show the widget's own console; a cross-origin iframe's console cannot be read | (a) a new widget API action with which the SDK / compat wrapper forwards logs (b) show the host's and the driver's log about the widget | (b). The driver's log is global, so with several widgets every console shows every record |
| `widget-url-changes-while-running` | `src/app/controller.ts` (`reconcile`) | A widget's state event changes (URL, name) while it runs | (a) reload at once (loses state) (b) mark the tab "changed, reload?" (c) nothing | (c): it keeps the old URL until it is reloaded (reload button of the dev tool bar) or closed and opened again |
| `dev-tools-off-same-origin-widget` | `src/app/controller.ts` (`settings/set`) | Dev tools are turned off while a widget on this host's own origin that the user opened ("Open anyway") runs | (a) stop it at once, back to the prompt (b) ask first (c) let it run until it is closed or reloaded | (c): a reload then shows the prompt without "Open anyway" |
| `close-tab-of-always-on-screen-widget` | `controller.ts` (`closeTab`) | Closing the tab or the room panel of an always-on-screen widget | (a) it keeps running in the PiP panel; only the PiP close button stops it (b) it stops like any widget | (a), the reading of designFeedback.md that is not in appDesign.md |

### App shell, login, accounts

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `login-password-step` | `src/views/app/LoginView.tsx` | The design says "No password is entered here"; password login is not designed | (a) separate step (b) inline fields; and what to show if a server offers OAuth and a password | (b): the fields appear once the homeserver offers a password; editing the homeserver goes back to "Continue" |
| `add-account-overlay` | `src/views/app/AppShell.tsx` | "Add account" while logged in is not drawn | (a) full-page overlay (b) modal (c) in the SidePanel | (a), the app behind it is `inert` |
| `toast-dismiss-button` | `AppShell.tsx` | The designed toast has no dismiss control and no timeout | (a) × button (b) timeout only | Both: × and 4 s |
| `floating-dev-badge-covers-header` | `src/views/app/AppShell.tsx` | The floating DevBackend badge (LeftBar collapsed) sits on top of the room panel header, as designed | move it to a corner / leave it | Left there; presses go through it |
| `restore-failed-actions` | `src/views/sidepanel/AccountView.tsx` | Where "Try again" / "Log out" go for an account whose restore failed | (a) buttons next to the error (b) menu rows | Error box under the card, "Try again" as the first menu row, the existing "Log out" row |
| `account-status-markers` | `AccountView.tsx` (`StatusMark`) | The design shows no account states in the switch list | (a) pills (b) subtitle line (c) disabled row | (a): "paused", "Restoring…", "restore failed"; rows stay clickable |
| `devbackend-account-actions` | `AccountView.tsx` (`DevAccountBody`) | Does the DevBackend account offer "Copy Matrix URI" or "Log out"? | yes / no | No, as designed |
| `narrow-side-panel-width` | `src/views/sidepanel/SidePanel.tsx` | Width of the overlaying SidePanel in a narrow window (no handle there) | (a) the persisted width (b) a fixed one | (a), capped to the window |
| `verification-methods-always-offered` | `src/views/sidepanel/DeviceVerification.tsx` | The "Verify this device" box offers both ways even when one cannot work (no other device, no recovery key set up) | (a) always both (b) only what the session says can work (needs `LiveSession` to tell) | (a): the session's error says why afterwards |

### DevBackend

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `devbackend-header-buttons` | `src/views/devbackend/RoomBox.tsx` | Where "close panel", "clear room" and "remove room" go; the designed header only has the dropdown | (a) header buttons (b) inside the dropdown | A ⋯ menu ("Room actions", DevBackend only) and × next to the dropdown; the Dev tools of a Matrix account have the × too |
| `devbackend-destructive-confirm` | `RoomBox.tsx` | Clear room / remove room lose state | confirm or not | Not confirmed |
| `devbackend-rtc-member-shape` | `src/views/devbackend/TimelineSection.tsx` | Which event the "RTC member" form sends | (a) `org.matrix.msc4143.rtc.member` timeline event (b) `org.matrix.msc3401.call.member` state event | (a), with a guessed content (empty = left) |
| `devbackend-raw-form-shape` | `TimelineSection.tsx` | Raw JSON: one editor for `{type, sender, content}` (as designed) or type + content fields | either | One editor |
| `devbackend-todevice-sender` | `src/views/devbackend/ClientBox.tsx` | The design has one sender select (sketch `sketch-sidepanel-devbackendview-tools--to-device`) | select / separate fields | Separate user id and device id fields |
| `devbackend-extra-store-tools` | `DevBackendView.tsx` | The old store tools have no place in the design: push TURN credentials, room account data, RTC transports, fire the oldest delayed event | sections of the Client Backend Tool (room account data: of the room box) / drop them | Not in the UI; they exist as methods of `DevBackend` |
| `devbackend-delayed-sender` | `src/views/devbackend/TimelineSection.tsx`, `devBackend.ts` | The send form offers any sender, but the backend only schedules a delayed event for the DevBackend user | disable the sender field while "Delayed" is on / allow it in the backend | The refusal is shown as a toast |
| `room-tools-delayed-list` | `src/app/controller.ts` (`sendToRoom`) | The Dev tools of a Matrix account cannot ask the homeserver for the room's delayed events (no list in the rust bindings; MSC4140 has `GET /delayed_events`, which matrix-js-sdk can call) | (a) list only what was scheduled here, until sent, cancelled or due (b) the homeserver's list where an SDK offers it (js; rust with an SDK addition) | (a), not persisted, forgotten on logout; a delayed event a widget scheduled is not listed, and only listed ones can be sent, restarted or cancelled from here. Needs MSC4140 on the homeserver; a refusal is a toast |
| `room-tools-state-refresh` | `src/app/AppRoot.tsx` (`useRoomState`), `roomStateVersion` in `src/appViewModel.ts` | When the Dev tools read the room state again | (a) the whole state on every new state event of the timeline (b) apply the state event to the state read before (c) a state change listener per SDK | (a): one `/state` request per new state event in both SDKs; the first read waits for the timeline. A change without a new state event in the timeline (a gap in the sync, the redaction of a state event) is shown with the next one |

The DevBackend runtime (`src/matrix_session/memory/devBackend.ts`):

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `devbackend-shared-account-store` | `devBackend.ts` | Media, to-device messages and "fail sends" are account-scoped, `InMemoryBackend` keeps them per room | (a) mirror them between the rooms' backends in TypeScript (b) an account-level store in the Rust `InMemoryBackend` | (a). Two rooms can issue the same `media-<n>` URI; the first seen wins |
| `devbackend-no-change-notification` | `devBackend.ts` (`refresh`) | `InMemoryBackend` does not say when it changed | (a) a callback or a version counter in Rust (b) re-read | (b): the controller calls `refresh()` after every widget message; it re-reads every room including all media bytes |
| `devbackend-delayed-events-do-not-fire` | `devBackend.ts` | A scheduled event never fires by itself | (a) manual "Send now" only (b) a timer per event | (a) |
| `devbackend-clear-room-keeps-skeleton` | `devBackend.ts` (`clearRoom`) | What "Clear room" leaves | (a) nothing (b) create event, name and the own membership | (b); the widgets go |
| `devbackend-copied-room-user` | `devBackend.ts` (`importRoom`) | Who the DevBackend user is in a copied room | (a) joined as an extra member (b) act as the original user (c) rewrite the events | (a) |
| `devbackend-widget-event-timestamps` | `devBackend.ts` | The backend uses a counter as `origin_server_ts` of events a widget sends | fix in Rust / patch in the host | The host shows the first-seen time when the value is below 1e11 |

### PictureInPicturePanel

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `pip-vertical-label-space` | `src/views/pip/PipPanel.tsx` | Stacked vertically, the designed labels sit between the boxes, so showing them on hover would move the boxes (which must not move) | (a) reserve the label space while idle (b) labels left of the boxes | (a): idle gaps are 38px instead of 6px |
| `pip-resize-moves` | `PipPanel.tsx` (`resized`) | Position is anchored bottom-right and the resize corner is bottom-right too | (a) a resize also moves (b) corner top-left (c) position top-left | (a): `pip/resize` + `pip/move` |

### Rooms, tabs, overview

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `fullscreen-close-button` | `src/views/rooms/RoomView.tsx` | appDesign.md lists what the fullscreen header hides (tab, +) and does not mention "close panel"; the design drew it | always visible / hidden with the tab | Hidden with the tab and +, back on hover or focus |
| `tab-arrow-keys-manual-activation` | `src/views/rooms/TabBar.tsx` | appDesign.md: "arrow keys switch". Switching a tab can move an always-on-screen widget into the PiP panel | (a) arrows activate (b) arrows move focus, Enter/Space activates | (b) |
| `inactive-tab-buttons-overlay` | `TabBar.tsx` | ⋯ and × of an inactive tab appear on hover | (a) overlay the end of the label (b) take space (the tabs shift) (c) only on the active tab | (a). With five or more tabs the tabs are so narrow that a press in the middle of an inactive tab hits ⋯ and opens the dev tools instead of activating the tab |
| `overview-show-all-members` | `src/views/rooms/RoomOverview.tsx` | The design has a "Show all 12 members" link (sketch `sketch-rooms-roomoverview--plain`); there is no data and no intent for the full list | add an intent and a member list view / drop the link | A text line with the count |
| `tile-widget-without-tab` | `src/views/rooms/RoomOverview.tsx` | A widget that runs without a tab (always on screen, its panel was closed) in the widget list of the RoomOverview | treat as "open in another panel" / own state | Both buttons, labelled "running without a tab" |
| `panel-resize-intent-semantics` | `src/views/rooms/RoomsArea.tsx` | `panel/resize` carries one share | one share, the right neighbour gets the rest / an intent with both shares | One share (`resizePanel` in `src/app/layout.ts` gives the rest to the right neighbour). The double-click reset sends two intents, which is only exact for two panels |
| `add-widget-room-write-done` | `src/views/rooms/AddWidgetForm.tsx` | When does "Add widget" to the room close? `widgetWrite` disappears when the send succeeded, and also when the replace confirmation was cancelled before anything was sent | (a) once the room lists the sent event (b) a `sent` state of `widgetWrite` | (a). With a Matrix account the form shows its buttons again between the send and the sync that brings the event back; if the room changes the event, it stays open until Cancel |

### WidgetView and dev tools

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `capability-labels-in-view` | `src/views/widget/format.ts` | Where the human labels, sections and risk marks of capabilities ("Read the messages of this room") come from | (a) the SDK (b) the view model (c) a table in the view | (c), the only copy, webview capabilities by their feature or token (`test/capabilityFormat.test.ts` checks it against the test widget). Whether a capability is known at all comes from the driver (`capabilityIsKnown`, `CapabilityPromptViewModel.unknown`) |
| `message-log-order` | `src/views/widget/MessagesPanel.tsx` | The design listed messages oldest first, the view model says newest first | either | Newest first |
| `revoke-auto-approved` | `src/views/widget/DriverPanel.tsx` | Can an auto-approved capability be revoked? It is approved again on the next request | hide the button / revoke and also forget it | It has a revoke button, and "Revoke all" includes it |
| `compact-failed-state` | `WidgetView.tsx` | A failed widget and a prompt inside a 224×140 PiP box are not drawn (designFeedback.md, "Gaps") | design them | One line plus "Retry" / "Open to answer" |
| `devtools-default-size` | `src/views/widget/DevTools.tsx` | Double click on a separator resets the size; the default is not in the view model | constant in the view / in the view model | Constants 240 / 360 in the view |

### Matrix sessions (not run against a homeserver)

Login, sync, suspend/resume, device verification and the storage migration of both SDKs are only verified by the type checker and by tests with faked clients.

| Name | Where | Question | Options | Now |
| --- | --- | --- | --- | --- |
| `account-id-choice` | `src/matrix_session/js/session.ts`, `rust/session.ts` | What identifies a stored login | (a) random id (b) user id + device id | js: a UUID (`legacy` for the login migrated from the old layout, which keeps its crypto store and device); rust: the existing store id |
| `suspend-in-flight-requests` | `src/matrix_session/js/fetchGate.ts` | What happens to requests that are running when the DevBackend is activated | (a) abort all (b) abort only `/sync` (c) hold until resume | New requests are refused, `/sync` is aborted, sends in flight finish. `stopClient()` is not used because it shuts crypto down for good |
| `rust-suspend-explicit-requests` | `src/matrix_session/rust/session.ts` | Suspending the rust session stops sync and the send queues, but a backend can still make a request for a widget | (a) the controller detaches the backends (it already stops all widgets) (b) a gate in `RustSdkBackend` | Neither. `Client::pause()` is avoided because it closes the stores |
| `rust-export-state` | `src/matrix_session/rust/roomData.ts` (`roomState`) | The Dev tools and "Copy to DevBackend" need all state; the bindings read state by type only | (a) a direct `/state` request with the access token (no token refresh) (b) a fixed type list (c) a new `Room::state_raw` in the SDK patches | (a), falling back to (b) plus the state types of the event cache, which is incomplete. The Dev tools read it again on every new state event (`room-tools-state-refresh`) |
| `room-details-member-loading` | `js/roomData.ts`, `rust/roomData.ts` | Load all members for the RoomOverview? | always / never / up to a size | Loaded up to 500 joined members, else what is local |
| `export-decrypted-events` | `js/roomData.ts` | A copied room holds decrypted events or the events as sent | either | Decrypted |
| `concurrent-sessions` | both `session.ts` | Several accounts run at once, one client each; unverified with real SDK stores | restore all / only the active one | All are restored and kept syncing (suspended while the DevBackend is active) |
| `rust-resume-room-subscription` | `rust/session.ts` | Whether a room's full-state subscription survives stop/start of the sync service | verify on a homeserver | It is requested again on resume |
| `verification-incoming-requests` | `rust/verification.ts` (`didReceiveVerificationRequest`) | A verification request that another device of the account sends to this one | (a) ignore it (b) show it in the AccountView (design, view model, both SDKs) | (a): only this device starts a verification |
| `rust-one-room-subscription` | `rust/session.ts` (`open`) | The rust session subscribes to one room with its full state at a time: opening the widgets, the Timeline tab or the Dev tools of room B moves the subscription away from room A, whose widgets and timeline then only get what the room list syncs. Pre-existing for the widgets of two rooms side by side | (a) keep (b) subscribe to every room on screen, with an SDK addition next to `subscribeToRoomWithFullState` that takes the list | (a). A Timeline tab and the Dev tools subscribe when they show the room (its timeline), not again on each new event |
| `rust-late-decryption-not-reported` | `rust/roomData.ts` (`onTimelineChanged`) | A late decryption and a reset of the event cache are reported (`subscribeToTimelineChangesRaw`, sdk-addition `raw_timeline_changes.rs`; also behind `notify_timeline_update`), but not a redaction the event cache applies to a cached event in place: the RoomTimeline shows it as it was until the room's next event arrives | (a) report replaced events of every kind in the SDK addition (b) read again on a timer. Verify on a homeserver first | (a) for decryptions only |
| `verification-cancel-on-suspend` | `src/app/controller.ts` (`switchAccount`) | Activating the DevBackend cancels a running verification, but the sessions are suspended right after, so the cancel likely never reaches the other device | (a) wait for the cancel (with a time limit) before suspending (b) let the other device time out | (b) |

## Trivial

- `toast-text-markup`: toast text is a plain string; Esc/Alt/Shift/Ctrl are wrapped in `<kbd>` by the view.
- `confirm-modal-body-plain`: the confirm body is a string, so no bold as designed.
- `info-modal-version`: version and SDK name in the info modal are hard-coded; `info-modal-links`: the documentation and source links point to the git remote.
- `tooltip-component`: tooltips are `title` attributes; a keyboard user does not see them. Add a tooltip component.
- `pager-picker-label`: the narrow pager calls a picker panel "New panel".
- `escape-in-widget`: no Escape while an iframe has focus (the mouse at the left edge reveals the expand button instead).
- `alt-shift-n-without-room`: Alt+Shift+N on a picker panel opens another picker.
- `.btn.danger` has no fill; the scrim closes only the info modal.
- `devbackend-no-matrix-account`: a small text added to the AccountView for a state the design does not have.
- Device verification: "Verify" is disabled while the recovery key field is empty; the field gets the focus when the form appears and after a refused key; activating the DevBackend (or a seed) ends a running verification like a failure, with the reason in the box and a toast; a failed `needsVerification` read keeps the last answer; the dispatch log leaves out the recovery key and the password of an intent (`loggableIntent`).
- Avatars without an image derive their color from the id; the design used fixed hues.
- `devbackend-timeline-not-virtualized`: the event list shows the newest 100 plus "Show more".
- `room-timeline-not-virtualized`: the RoomTimeline renders the newest 200 events; "Load older events" first shows 200 more of the loaded ones, then asks the session for 50.
- `devbackend-media-uploader-name`: a media row shows the widget key, not its name; `devbackend-add-member-content`: "add member" sends only `{membership: "join"}`.
- The widget form's widget ID is the first free `widget-<n>` when the form is shown, so sending twice updates one widget. A legacy widget keeps the legacy test widget's `type`, `waitForIframeLoad` and `data` (`title`), whatever its name and URL.
- `pip-menu-placement`: the overflow menu always opens above the container; `pip-menu-roles`: its rows have two menu items each instead of nested buttons.
- `pip-overflow-no-swap`, `pip-dev-tools-close-only`: open points 11 and 12 of designFeedback.md are unchanged.
- Fonts are self-hosted (`@fontsource`) instead of loaded from Google Fonts: an adopted stylesheet cannot `@import`, and a dev tool should not call a third party.
- The stats graph samples also while its panel is hidden (cheap; appDesign.md asks to pause it).
- An always-on-screen widget without a tab that turns always-on-screen off is stopped: there is no place left to show it.
- A reload (or Retry) keeps the widget's always-on-screen flag until the restarted widget changes it, so a widget in the PiP panel stays there while it starts again.
- The DevBackend's workspace is not restored after a page reload, because its content only lives in memory.
- All stored Matrix logins are restored at start, not only the active one.
- `message-log-not-virtualized`: the message log is a plain list capped at 500; `message-log-cap-constant`: the cap is repeated in the view.
- `approve-nothing`: "Approve 0 selected" is disabled; "Deny all" is the way to deny.
- Capability prompt: in an area lower than 420px the overlay scrolls instead of the sections; the bar under the blocked "Approve" is a Web Animation (static with reduced motion); an approval that reaches the runtime after the driver asked about a capability the card did not show yet is refused (logged in the console panel); a capability that a revoke put back into the driver's open question does not count (the answer does not grant it).
- `covered-widget-not-inert`: the iframe under a prompt or error overlay stays focusable.
- `chart-hover-only`: the value of a stats bar too small for its number shows on pointer hover only; a visually hidden table is the alternative.
- Whether a bar's number fits is estimated at 6px per character (`src/views/widget/chart.ts`), not measured.
- Message rows also show the response time; the driver panel groups capabilities in three lists instead of one.
- `account-store-location`: the storage code shared by both SDK sessions lives under `matrix_session/js/`.
- `restore()` of an unknown account rejects with a plain `Error`.
- `AvatarCache` caches failures: an avatar requested while suspended stays missing after resume.
- rust: an abandoned pending login leaves IndexedDB stores behind unless `discard()` is called (pre-existing).
- js: `onRoomsChanged` does not fire on member-count changes; one `/sync` response in flight may still be processed after `suspend()`.
- `importRoom` drops timeline state events whose key is in the exported state. `toSeed()` does not keep event ids, timestamps, scheduled events, the to-device log or `copiedFrom`.
- A JS `TurnServerSink` cannot be passed to `subscribeTurnServers` of the in-memory backend ("Cannot lower this object to a pointer").
- The DevBackend's defaults changed from the old in-memory mode: user `@alice:dev.local`, device `DEVBACKEND`, base URL `https://matrix.dev.local`. The URL parameters of the README still give `!room:example.org` and `@alice:example.org`.
- `tab-overflow-threshold`: tabs shrink to 88px before the bar scrolls and shows "All tabs"; `all-tabs-button-name`: that button's name contains the tab count.
- In fullscreen the room name is the tab stop of the tab list (not the shown widget tab, which is hidden until the header has the focus).
- `tab-reorder-not-implemented`: `tab/move` exists but no view lets you drag a tab.
- `widget-avatar-initials`: a widget has no avatar source, so its icon is its initials.
- `room-view-without-room`, `overview-encryption-unknown`: texts for states the design does not have.
- `panel-focus-from-widget`: a press inside a widget iframe does not reach the host; the app root focuses the widget's panel when the iframe takes the focus (`src/app/AppRoot.tsx`).
- Room picker: once the search field had the focus, the "All rooms" group keeps the height of the scroll area (empty space under a short list), so a press on a row that takes the focus from the field does not move the row away. Without recents above it, the field is at the top already and nothing scrolls. A pick that only jumps to a widget's tab changes no recents.
- Alt+N inserts the new panel to the right of the focused panel, not at the far right (appDesign.md: "a new panel on the right").
- The timeline list of the Dev tools and its count include state events (the lab seed shows "12 events" for 3 messages), as the RoomTimeline does. Its rows show the generic content preview (`previewOf`), not the descriptions of the RoomTimeline (`describeEvent`: "joined", "👍") of the design (sketch `sketch-sidepanel-devbackendview--timeline-delayed`).
- `populate` does not reset view-local drafts (send forms, filters, the delayed toggle).
- Scheduled rows show "timeline" where the design shows a body preview (sketch `sketch-sidepanel-devbackendview--timeline-delayed`): `ScheduledEvent` has no content.
- The to-device list is headed "Messages" (design: "Sent by widgets"); rows sent by widgets show device `*`.
- The sender of the send forms (DevBackend) is a text input with suggestions; the design has a select with an avatar (sketch `sketch-sidepanel-devbackendview--timeline`).
- The selects of the forms (event type of the widget forms, msgtype, the Element Call intent) are native `<select class="input mono">` with the browser's arrow; the design draws a select as a field with a chevron icon (`.input.select` in `src/styles/atoms.css`, as the sender sketches show).
- The Dev tools of a Matrix account: the shortcut forms and the state editor close on Save, so a refusal (a toast) or a cancelled confirmation loses their text; the send forms keep their drafts. The dropdown's room starts on the focused room panel's when the Dev tools open, unless the room picked before is still open.
- A widget may send `notify_ready` before its capabilities are answered, so it counts as ready while the permission prompt is shown.
- In a narrow window the panel pager is partly hidden under the overlaying SidePanel.
- The toast's 4 s auto-dismiss has no test (the tests do not sleep).
- "Add widget": a draft the form refuses is shown in the same box as the room's refusal ("The widget cannot be added"); editing the draft takes it away. Opening the form forgets a refusal an earlier form of the room left. While the state event is sent the submit button says "Adding…".
- Editing a local widget always shows the widget form (name, URL, uses the widget API), whichever form added it; the rest of its content is kept. A changed name does not reload a running local widget; a changed `uses_widget_api` reloads it without forgetting its capabilities.
- Removing a local widget leaves its recents behind; the RoomPicker skips them like any widget that is gone.
- `HostSeed.notifyReadyTimeoutMs` shortens the 15 s `notify_ready` timeout, for the tests of the failed state only.
- The PiP surround listens to native pointer events: the slotted widget iframes are outside the React tree, so React's hover events never fired over a widget.
