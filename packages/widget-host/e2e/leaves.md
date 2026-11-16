# Design leaves and the tests that reach them

Every leaf of `design/index.html` (`design/src/leaves.mjs`), with the test in which `host.leaf("<id>")` marks the screen, or why the leaf cannot be reached in DevBackend mode. The screenshots of a run are in `leaf-screenshots/<id>.png`.

## App shell, LeftBar, SidePanel

| Leaf | Reached by |
| --- | --- |
| `app/login`, `app/devbackend-empty` | `shell.spec.ts` › a fresh browser without a stored login (a second browser context; "Skip login" leads into the DevBackend) |
| `app/devbackend`, `leftbar/devbackend` | `shell.spec.ts` › the DevBackend is signalled by the fence |
| `leftbar/devbackend-hover` | `shell.spec.ts` › the Dev tools button only opens and closes the Dev tools |
| `leftbar/collapsed-toast`, `leftbar/collapsed-expand`, `app/devbackend-collapsed` | `shell.spec.ts` › collapse → toast → Escape |
| `app/fullscreen`, `app/fullscreen-hover` | `shell.spec.ts` › with exactly one widget tab; also `rooms.spec.ts` |
| `app/info-modal` | `shell.spec.ts` › the app info modal closes |
| `app/confirm` | `shell.spec.ts` › stopping an always-on-screen widget is confirmed. The leaf's text (activating the DevBackend) needs a Matrix account |
| `app/narrow` | `shell.spec.ts` › narrow window (the AccountView is the DevBackend one) |
| `sidepanel/closed` | `sidepanel.spec.ts` › the LeftBar buttons show one view at a time |
| `roomsarea/shifted` | `sidepanel.spec.ts` › the open panel shifts the RoomsArea |
| `sidepanel/settings-on`, `sidepanel/settings-devbackend` | `sidepanel.spec.ts` › settings: two independent switches (`settings-on` with the lock of the active DevBackend; the unlocked switch needs a Matrix account: story `sidepanel-settingsview--both-on`) |
| `sidepanel/rooms`, `sidepanel/rooms-app` | `sidepanel.spec.ts` › Room list: a pick opens in the panel showing the room, else in the focused picker, else in a new panel |
| `sidepanel/account-dev` | `sidepanel.spec.ts` › account: the DevBackend is the account |
| `complete/workspace`, `complete/devbackend`, `complete/light` | `sidepanel.spec.ts` › complete views |
| `sidepanel/verify-start`, `sidepanel/verify-failed`, `sidepanel/verify-done`, `sidepanel/verify-waiting`, `sidepanel/verify-emoji`, `sidepanel/verify-confirming`, `sidepanel/verify-recovery-key`, `sidepanel/verify-recovery-checking`, `sidepanel/verify-recovery-wrong` | **not reachable**: they need a Matrix account whose device is not verified (the DevBackend's device is). The flows are tested on a faked session in `test/deviceVerification.test.ts`. Stories: `sidepanel-deviceverification--start`, `--failed`, `--done`, `sidepanel-emojiverification--waiting`, `--compare`, `--confirming`, `sidepanel-recoverykeyform--entering`, `--checking`, `--refused` |
| `app/default`, `leftbar/expanded`, `leftbar/devtools`, `sidepanel/settings-off`, `sidepanel/account-one`, `sidepanel/account-several` | **not reachable**: they need a Matrix account (DevBackend inactive). Stories: `app-appshell--default`, `app-leftbar--expanded`, `app-leftbar--dev-tools-enabled`, `sidepanel-settingsview--both-off`, `sidepanel-accountview--one-account`, `--several-accounts` |

## Rooms, tabs, overview

| Leaf | Reached by |
| --- | --- |
| `roomsarea/one` | `rooms.spec.ts` › Alt+Shift+N opens the same room in a second panel |
| `roomsarea/several`, `roomview2/different` | `rooms.spec.ts` › two panels with different rooms: the separator resizes them |
| `roomview2/same` | `widgetMove.spec.ts` › move widget here |
| `panel/no-recents`, `roomview/header` | `rooms.spec.ts` › a new panel shows the picker: no recents, all rooms with search, then the room overview |
| `panel/recents`, `panel/search` | `rooms.spec.ts` › Alt+N opens a panel with the recent widgets and rooms: the search scrolls past the tiles, … |
| `panel/no-rooms` | `devbackend.spec.ts` › no rooms yet: … a new room panel has no room to offer |
| `panel/loading` | **not reachable**: the DevBackend's room list is always ready (story `rooms-roompicker--loading`) |
| `panel/error` | **not reachable**: `DevBackend.rooms()` never fails (story `rooms-roompicker--load-error`) |
| `app/fullscreen`, `app/fullscreen-hover` | `rooms.spec.ts` › fullscreen: LeftBar collapsed and one shown widget tab |
| `tabs/widget-active`, `tabs/overview-active` | `tabs.spec.ts` › the room name is the first tab: it shows the overview |
| `tabs/pinned` | `widgetMove.spec.ts` › always on screen |
| `tabs/overflow` | `tabs.spec.ts` › more tabs than fit |
| `tabs/timeline-active`, `timeline/start` | `timeline.spec.ts` › “Open timeline” adds the Timeline tab at the end; its lines are the room's events, oldest first |
| `timeline/events` | `timeline.spec.ts` › 250 events: the newest 200 are shown, … (the mocked room's events are messages, not one of every kind: `test/eventText.test.ts` checks the words for those of the leaf, story `rooms-roomtimeline--events`) |
| `timeline/loading`, `timeline/error` | **not reachable**: the DevBackend's timeline is there at once and never fails (stories `rooms-roomtimeline--loading`, `--load-error`) |
| `overview/plain` | `overview.spec.ts` › a room opens on its overview |
| `overview/devtools` | **partly**: `overview.spec.ts` › with dev tools enabled: "Add widget" and the local widgets (a widget open in this panel offers "Jump to tab", a seeded local widget). The DevBackend card needs a Matrix room (story `rooms-roomoverview--dev-tools`) |
| `overview/add-widget` | `overview.spec.ts` › Add widget, only in this host |
| `overview/add-widget-json` | `overview.spec.ts` › Add widget, Paste JSON (a pasted state event as Element's room state explorer shows it) |
| `overview/add-widget-refused` | `overview.spec.ts` › Add widget, to the room ("fail sends" of the DevBackend stands for the room's refusal; a real `M_FORBIDDEN` needs a Matrix room) |

## Dev tools

The Dev tools of a Matrix account are **not reachable**: the tests run on the DevBackend only, without a Matrix account. They read a room the same way as the DevBackendView (`useRoomTimeline`, `useRoomState`), which `devbackendState.spec.ts` › the state is read like a real room's covers; the account's send path, the confirmation, "Scheduled", the selection and the footer links run on a faked session in `test/roomTools.test.ts`.

| Leaf | Reached by |
| --- | --- |
| `roomtools/none`, `roomtools/dropdown`, `roomtools/state`, `roomtools/timeline`, `roomtools/loading-failed` | **not reachable** (a Matrix account). Stories: `sidepanel-roomtoolsview--no-room-open`, `--room-dropdown`, `--state`, `--timeline`, `--loading-failed` |
| `roomtools/app` | **not reachable** (a Matrix account). Story: `app-appshell--room-tools` |
| `roomtools/confirm` | **not reachable** (a Matrix account). Story: `app-appshell--room-tools-confirm` |

While the DevBackend is active they are the DevBackendView. "Leave DevBackend" is in no screenshot: without a Matrix account there is nothing to go back to, so the button is not shown.

| Leaf | Reached by |
| --- | --- |
| `devbackend/none`, `app/devbackend-empty` | `devbackend.spec.ts` › no rooms yet: the RoomsArea is empty, a new room panel has no room to offer; "Create a room" adds and selects the first room |
| `devbackend/dropdown` | `devbackend.spec.ts` › room dropdown: select a room, add a room and open it in a new room panel |
| `devbackend/behavior` | `devbackend.spec.ts` › widget host behavior: the same for every room; without auto-approve the widget asks for permissions |
| `devbackend/todevice` | `devbackend.spec.ts` › to-device: a message sent from the view reaches the widget, one sent by the widget is listed |
| `devbackend/tools-collapsed`, `devbackend/media-open` | `devbackend.spec.ts` › media tool: open (closing the client tool), upload a file, copy its MXC URI, minimise |
| `devbackend/state`, `devbackend/state-raw` | `devbackendState.spec.ts` › send state and the state explorer (the widget form, then raw JSON); the state of a widget's write: › the state is read like a real room's |
| `devbackend/state-element-call` | `devbackendState.spec.ts` › the Element Call form writes the call widget as Element Web describes it, and the compat wrapper fills in its URL |
| `devbackend/state-edit` | `devbackendState.spec.ts` › edit state: saving the editor sends a new state event |
| `devbackend/timeline` | `devbackendTimeline.spec.ts` › message form: the event is added to the timeline and forwarded to the widget |
| `devbackend/timeline-raw` | `devbackendTimeline.spec.ts` › raw JSON form: invalid JSON shows an error and sends nothing |
| `devbackend/timeline-delayed` | `devbackendTimeline.spec.ts` › delayed event: listed under "Scheduled"; "Cancel" drops it and "Send now" sends it |

## WidgetView, dev tools, PictureInPicturePanel

| Leaf | Reached by |
| --- | --- |
| `widgetview/loading`, `widgetview/plain` | `widget.spec.ts` › a widget is loading until it sends notify_ready |
| `widgetview/failed` | `widget.spec.ts` › a widget that never answers fails: retry starts it again, close tab gives up |
| `widgetview/prompt` | `widget.spec.ts` › capability prompt: a section's checkbox checks its rows; approving nothing is not offered |
| `widgetview/prompt-long` | `widget.spec.ts` › capability prompt: deny all, then approve a subset (the test widget's 33 capabilities; it asks for none this app does not know) |
| `widgetview/prompt-merged` | `widget.spec.ts` › a request while the prompt is open joins it (one "New" row; the leaf's progress bar is drawn full, the screenshot ends animations) |
| `widgetview/prompt-openid` | `widget.spec.ts` › OpenID is a one-use capability (the prompt of the second token, "Once" by default; "Always" and the disabled choice: › OpenID "Always": every next token without the card) |
| `devtools/one-panel`, `devtools/bar-top`, `devtools/bar-bottom`, `devtools/bar-left`, `devtools/bar-right` | `devtools.spec.ts` › the ⋯ button of the tab opens the bar with the messages panel; the bar docks top, bottom, left and right |
| `devtools/bottom-panel` | `devtools.spec.ts` › the dev tools are resized with the separator: keyboard and drag |
| `devtools/two-panels`, `devtools/three-panels`, `devtools/fourth-panel`, `devtools/side-panels` | `devtools.spec.ts` › panels open next to each other; the fourth closes the oldest; docked to a side they stack |
| `devtools/messages` | `devtools.spec.ts` › messages panel |
| `devtools/stats`, `devtools/stats-direction` | `devtools.spec.ts` › stats panel |
| `devtools/driver` | `devtools.spec.ts` › driver panel: revoke one capability and all (confirm modal), add a capability (the OpenID grant of the start is marked "once"; "Always" under auto-approved: `widget.spec.ts` › OpenID "Always": every next token without the card) |
| `devtools/console` | `devtools.spec.ts` › console panel |
| `pip/idle-1`, `pip/hover` | `widgetMove.spec.ts` › always on screen |
| `pip/idle-4` | `pip.spec.ts` › four always-on-screen widgets |
| `pip/vertical`, `pip/hover-vertical` | `pip.spec.ts` › the stacking switch puts the boxes below each other |
| `pip/overflow`, `pip/overflow-menu` | `pip.spec.ts` › more widgets than boxes |
| `pip/enlarged-devtools` | `pip.spec.ts` › the dev tools of a widget stay open inside its PiP box |
