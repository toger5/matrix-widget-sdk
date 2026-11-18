# Stories and the tests that reach them

Every story of Storybook (`src/**/*.stories.tsx`), one row each, with what reaches its state in DevBackend mode:

- the tests in which `host.story("<id>")` marks the screen (`<file>.spec.ts` › the test). A run saves the screenshot to `story-screenshots/<id>.png`; compare it with the story's (`node e2e/tools/shot.mjs story <id> <out.png>`);
- **not reachable**: why the state cannot be reached in DevBackend mode;
- **sketch**: a design that is not built yet (`.claude/skills/sketch-stories/SKILL.md`); "redraw" when it redraws an existing story (its id without `sketch-`), with the finding that keeps it a sketch;
- **catalogue**: a component or variant on its own, which no test marks.

`node e2e/tools/stories.mjs` checks this file against the stories and the tests.

## App

| Story | Reached by |
| --- | --- |
| `app-appshell--default` | **not reachable**: a Matrix account (DevBackend inactive) |
| `app-appshell--dev-backend-active` | `shell.spec.ts` › the DevBackend is signalled by the fence, the badge and the account icon |
| `app-appshell--dev-backend-collapsed` | `shell.spec.ts` › collapse → toast → Escape reveals the expand button → the bar is back |
| `app-appshell--dev-backend-empty` | `shell.spec.ts` › a fresh browser without a stored login shows the login page; skipping it leads into the empty DevBackend (a second browser context); `devbackend.spec.ts` › no rooms yet: the RoomsArea is empty, a new room panel has no room to offer; “Create a room” adds and selects the first room |
| `app-appshell--confirm` | `shell.spec.ts` › stopping an always-on-screen widget is confirmed (the story's text, activating the DevBackend, needs a Matrix account) |
| `app-appshell--info-modal` | `shell.spec.ts` › the app info modal closes with Escape, with its button and with a press next to it |
| `app-appshell--fullscreen` | `shell.spec.ts` › with exactly one widget tab the widget is fullscreen; the header shows the tab while hovered; `rooms.spec.ts` › fullscreen: LeftBar collapsed and one shown widget tab hide the tab and the + until the header is hovered or focused |
| `app-appshell--fullscreen-header-focused` | `shell.spec.ts` › with exactly one widget tab the widget is fullscreen; the header shows the tab while hovered; `rooms.spec.ts` › fullscreen: LeftBar collapsed and one shown widget tab hide the tab and the + until the header is hovered or focused |
| `app-appshell--narrow` | `shell.spec.ts` › narrow window: the SidePanel overlays the RoomsArea, one room panel is shown and the pager steps through them (the AccountView is the DevBackend one) |
| `app-appshell--collapsed-toast` | `shell.spec.ts` › collapse → toast → Escape reveals the expand button → the bar is back |
| `app-appshell--collapsed-expand` | `shell.spec.ts` › collapse → toast → Escape reveals the expand button → the bar is back |
| `app-appshell--side-panel-closed` | `sidepanel.spec.ts` › the LeftBar buttons show one view at a time; pressing a button again or the close button closes the panel |
| `app-appshell--shifted-by-side-panel` | `sidepanel.spec.ts` › the open panel shifts the RoomsArea and is resized with its handle |
| `app-appshell--room-list` | `sidepanel.spec.ts` › Room list: a pick opens in the panel showing the room, else in the focused picker, else in a new panel; an open widget is jumped to; a narrow window closes the list |
| `app-appshell--room-tools` | **not reachable**: the Dev tools of a Matrix account (see SidePanel) |
| `app-appshell--room-tools-confirm` | **not reachable**: the Dev tools of a Matrix account (see SidePanel) |
| `app-appshell--one-panel` | `rooms.spec.ts` › Alt+Shift+N opens the same room in a second panel, where the running widget is grayed out; Alt+W closes it again |
| `app-appshell--several-panels` | `rooms.spec.ts` › two panels with different rooms: the separator resizes them, double click resets, a panel closes with its widgets |
| `app-appshell--different-rooms` | `rooms.spec.ts` › two panels with different rooms: the separator resizes them, double click resets, a panel closes with its widgets |
| `app-appshell--same-room-twice` | `widgetMove.spec.ts` › move widget here: the widget changes the room panel without a reload |
| `app-appshell--pip-enlarged-dev-tools` | `pip.spec.ts` › the dev tools of a widget stay open inside its PiP box, which can be enlarged for them |
| `app-complete--workspace` | `sidepanel.spec.ts` › workspace: two rooms, the AccountView, dev tools with two panels and a widget in the PiP panel |
| `app-complete--dev-backend` | `sidepanel.spec.ts` › DevBackend: the DevBackendView with the media tool, dev tools docked to the right |
| `app-complete--light` | `sidepanel.spec.ts` › light theme: the same screen in the other theme |
| `app-leftbar--expanded` | **not reachable**: a Matrix account (DevBackend inactive) |
| `app-leftbar--dev-tools-enabled` | **not reachable**: a Matrix account (DevBackend inactive) |
| `app-leftbar--dev-backend-active` | `shell.spec.ts` › the DevBackend is signalled by the fence, the badge and the account icon |
| `app-leftbar--dev-backend-hover` | `shell.spec.ts` › the Dev tools button only opens and closes the Dev tools: it never leaves the DevBackend |
| `app-loginview--login` | `shell.spec.ts` › a fresh browser without a stored login shows the login page; skipping it leads into the empty DevBackend |
| `app-loginview--password-with-error` | **catalogue**: a homeserver that offers only a password |
| `app-loginview--adding-busy` | **catalogue**: "Add account" while the homeserver is looked up |
| `app-modal--info` | **catalogue**: the modal alone; on the screen: `app-appshell--info-modal` |
| `app-modal--confirm` | **catalogue**: the modal alone; on the screen: `app-appshell--confirm` |
| `app-modal--confirm-danger` | **catalogue**: the modal alone; on the screen: `app-appshell--room-tools-confirm` |
| `app-pippanel--idle` | `widgetMove.spec.ts` › always on screen: the tab gets a pin, moving away shows the widget in the PiP panel, without a reload |
| `app-pippanel--idle-four` | `pip.spec.ts` › four always-on-screen widgets: four boxes; hover and focus show the surround without moving the boxes |
| `app-pippanel--vertical-idle` | `pip.spec.ts` › the stacking switch puts the boxes below each other |
| `app-pippanel--hover` | `widgetMove.spec.ts` › always on screen: the tab gets a pin, moving away shows the widget in the PiP panel, without a reload |
| `app-pippanel--vertical` | `pip.spec.ts` › the stacking switch puts the boxes below each other |
| `app-pippanel--overflow` | `pip.spec.ts` › more widgets than boxes: the overflow button and its menu go to or stop the others |
| `app-pippanel--overflow-menu` | `pip.spec.ts` › more widgets than boxes: the overflow button and its menu go to or stop the others |

## SidePanel

The Dev tools of a Matrix account (`sidepanel-roomtoolsview--*`) are **not reachable**: the tests run on the DevBackend only, without a Matrix account. They read a room the same way as the DevBackendView (`useRoomTimeline`, `useRoomState`), which `devbackendState.spec.ts` › the state is read like a real room's covers; the account's send path, the confirmation, "Scheduled", the selection and the footer links run on a faked session in `test/roomTools.test.ts`. While the DevBackend is active they are the DevBackendView. "Leave DevBackend" is in no screenshot: without a Matrix account there is nothing to go back to, so the button is not shown.

| Story | Reached by |
| --- | --- |
| `sidepanel-accountview--one-account` | **not reachable**: a Matrix account (DevBackend inactive) |
| `sidepanel-accountview--several-accounts` | **not reachable**: Matrix accounts (DevBackend inactive) |
| `sidepanel-accountview--dev-backend-mode` | `sidepanel.spec.ts` › account: the DevBackend is the account; adding a Matrix account shows the login form, which can be cancelled |
| `sidepanel-accountview--restore-failed` | **catalogue**: a Matrix account whose session could not be restored |
| `sidepanel-deviceverification--start` | **not reachable**: a Matrix account whose device is not verified (the DevBackend's device is); the flows run on a faked session in `test/deviceVerification.test.ts` |
| `sidepanel-deviceverification--failed` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-deviceverification--done` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-emojiverification--waiting` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-emojiverification--compare` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-emojiverification--confirming` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-recoverykeyform--entering` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-recoverykeyform--checking` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-recoverykeyform--refused` | **not reachable**: as `sidepanel-deviceverification--start` |
| `sidepanel-settingsview--both-off` | **not reachable**: a Matrix account (DevBackend inactive) |
| `sidepanel-settingsview--both-on` | `sidepanel.spec.ts` › settings: two independent switches; the DevBackend's is locked while it is active, dev tools can be turned off there and the Dev tools stay (with the lock of the active DevBackend; the unlocked switch needs a Matrix account) |
| `sidepanel-settingsview--dev-backend-active` | `sidepanel.spec.ts` › settings: two independent switches; the DevBackend's is locked while it is active, dev tools can be turned off there and the Dev tools stay |
| `sidepanel-sidepanel--account-open` | **catalogue**: the SidePanel with several accounts (a Matrix account) |
| `sidepanel-sidepanel--room-list` | `sidepanel.spec.ts` › Room list: a pick opens in the panel showing the room, else in the focused picker, else in a new panel; an open widget is jumped to; a narrow window closes the list |
| `sidepanel-sidepanel--narrow-overlay` | **catalogue**: the SidePanel alone; on the screen: `app-appshell--narrow` |
| `sidepanel-devbackendview--no-rooms` | `devbackend.spec.ts` › no rooms yet: the RoomsArea is empty, a new room panel has no room to offer; “Create a room” adds and selects the first room |
| `sidepanel-devbackendview--room-dropdown` | `devbackend.spec.ts` › room dropdown: select a room, add a room and open it in a new room panel |
| `sidepanel-devbackendview--state` | `devbackendState.spec.ts` › send state and the state explorer: the sent event is listed by type and key (the state of a widget's write: › the state is read like a real room's) |
| `sidepanel-devbackendview--timeline` | `devbackendTimeline.spec.ts` › message form: the event is added to the timeline and forwarded to the widget |
| `sidepanel-devbackendview--timeline-raw-json` | `devbackendTimeline.spec.ts` › raw JSON form: invalid JSON shows an error and sends nothing, a valid event is sent |
| `sidepanel-devbackendview--timeline-delayed` | `devbackendTimeline.spec.ts` › delayed event: it is listed under “Scheduled”; “Cancel” drops it and “Send now” sends it |
| `sidepanel-devbackendview--timeline-pagination-requested` | `devbackendTimeline.spec.ts` › a widget's pagination waits for “Resolve pagination”: the generated messages reach the widget, then the start of the room |
| `sidepanel-devbackendview--tools-collapsed` | `devbackend.spec.ts` › media tool: open (closing the client tool), upload a file, copy its MXC URI, minimise |
| `sidepanel-devbackendview-state--widget` | `devbackendState.spec.ts` › the widget form sends any custom widget: it starts empty, only http(s) URLs; a legacy one gets the legacy fields |
| `sidepanel-devbackendview-state--update-widget` | `devbackendState.spec.ts` › the test widget form sends the three test widgets, its URL read-only; “Update widget” for a widget the room has |
| `sidepanel-devbackendview-state--element-call` | `devbackendState.spec.ts` › the Element Call form writes the call widget as Element Web describes it, and the compat wrapper fills in its URL |
| `sidepanel-devbackendview-state--raw-json` | `devbackendState.spec.ts` › send state and the state explorer: the sent event is listed by type and key |
| `sidepanel-devbackendview-state--edit` | `devbackendState.spec.ts` › edit state: saving the editor sends a new state event |
| `sidepanel-devbackendview-tools--behavior` | `devbackend.spec.ts` › widget host behavior: the same for every room; without auto-approve the widget asks for permissions |
| `sidepanel-devbackendview-tools--to-device` | `devbackend.spec.ts` › to-device: a message sent from the view reaches the widget, one sent by the widget is listed |
| `sidepanel-devbackendview-tools--media` | `devbackend.spec.ts` › media tool: open (closing the client tool), upload a file, copy its MXC URI, minimise |
| `sidepanel-roomtoolsview--no-room-open` | **not reachable**: the Dev tools of a Matrix account |
| `sidepanel-roomtoolsview--room-dropdown` | **not reachable**: the Dev tools of a Matrix account |
| `sidepanel-roomtoolsview--state` | **not reachable**: the Dev tools of a Matrix account |
| `sidepanel-roomtoolsview--timeline` | **not reachable**: the Dev tools of a Matrix account |
| `sidepanel-roomtoolsview--loading-failed` | **not reachable**: the Dev tools of a Matrix account |

## Rooms

| Story | Reached by |
| --- | --- |
| `rooms-roompicker--recents` | `rooms.spec.ts` › Alt+N opens a panel with the recent widgets and rooms: the search scrolls past the tiles, an open widget is jumped to, a recent opens its room and the widget, a room tile its overview |
| `rooms-roompicker--no-recents` | `rooms.spec.ts` › a new panel shows the picker: no recents, all rooms with search, then the room overview |
| `rooms-roompicker--search` | `rooms.spec.ts` › Alt+N opens a panel with the recent widgets and rooms: the search scrolls past the tiles, an open widget is jumped to, a recent opens its room and the widget, a room tile its overview |
| `rooms-roompicker--no-rooms` | `devbackend.spec.ts` › no rooms yet: the RoomsArea is empty, a new room panel has no room to offer; “Create a room” adds and selects the first room |
| `rooms-roompicker--loading` | **not reachable**: the DevBackend's room list is always ready |
| `rooms-roompicker--load-error` | **not reachable**: `DevBackend.rooms()` never fails |
| `rooms-roomview--overview` | `rooms.spec.ts` › a new panel shows the picker: no recents, all rooms with search, then the room overview |
| `rooms-roomview--widget-open` | **catalogue**: a room panel with a widget tab active; on the screen in most tests |
| `rooms-tabbar--widget-active` | `tabs.spec.ts` › the room name is the first tab: it shows the overview, where running widgets offer “Jump to tab”; the + selects it too |
| `rooms-tabbar--overview-active` | `tabs.spec.ts` › the room name is the first tab: it shows the overview, where running widgets offer “Jump to tab”; the + selects it too |
| `rooms-tabbar--pinned` | `widgetMove.spec.ts` › always on screen: the tab gets a pin, moving away shows the widget in the PiP panel, without a reload |
| `rooms-tabbar--timeline-active` | `timeline.spec.ts` › “Open timeline” adds the Timeline tab at the end; its lines are the room's events, oldest first; pressing one shows its JSON |
| `rooms-tabbar--overflow` | `tabs.spec.ts` › more tabs than fit: the widget tabs scroll behind the room name and the “All tabs” menu lists and activates them |
| `rooms-roomoverview--plain` | `overview.spec.ts` › a room opens on its overview: the room name is selected; topic, members and widgets |
| `rooms-roomoverview--dev-tools` | `overview.spec.ts` › with dev tools enabled: “Add widget” and the local widgets after the room's; a DevBackend room has no “Copy to DevBackend” card (partly: the DevBackend card needs a Matrix room) |
| `rooms-roomoverview--add-widget` | `overview.spec.ts` › Add widget, only in this host: listed as “Local”, nothing is sent; it asks for its capabilities, remembered apart from the room widget's |
| `rooms-roomoverview--add-widget-custom` | `overview.spec.ts` › Add widget, only in this host: listed as “Local”, nothing is sent; it asks for its capabilities, remembered apart from the room widget's |
| `rooms-roomoverview--add-widget-json` | `overview.spec.ts` › Add widget, Paste JSON: a whole state event, other fields ignored; not a widget type or not an http(s) URL is refused in the form (a pasted state event as Element's room state explorer shows it) |
| `rooms-roomoverview--add-widget-refused` | `overview.spec.ts` › Add widget, to the room: the state event is sent as you; replacing a widget of the room asks first; a refusal stays in the form with the draft ("fail sends" of the DevBackend stands for the room's refusal; a real `M_FORBIDDEN` needs a Matrix room) |
| `rooms-addwidgetform--edit` | `overview.spec.ts` › a local widget: editing its URL forgets its capabilities and reloads it; removing it closes its tab |
| `rooms-addwidgetform--sending` | **catalogue**: "Add to the room" while the state event is being sent |
| `rooms-roomtimeline--events` | `timeline.spec.ts` › 250 events: virtualised, it starts at the bottom and stays there while events arrive; the top is the start of the room (the mocked room's events are messages, not one of every kind: `test/eventText.test.ts` checks the words for those of the story) |
| `rooms-roomtimeline--start` | `timeline.spec.ts` › “Open timeline” adds the Timeline tab at the end; its tiles are the room's events, oldest first; pressing one shows its JSON |
| `rooms-roomtimeline--loading` | **not reachable**: the DevBackend's timeline is there at once |

## Widget

| Story | Reached by |
| --- | --- |
| `widget-widgetview--ready` | `widget.spec.ts` › a widget is loading until it sends notify_ready |
| `widget-widgetview--loading` | `widget.spec.ts` › a widget is loading until it sends notify_ready |
| `widget-widgetview--failed` | `widget.spec.ts` › a widget that never answers fails: retry starts it again, close tab gives up |
| `widget-widgetview--same-origin` | `overview.spec.ts` › a widget on this host's own origin: added in the form, listed like any widget; opening it asks first: without dev tools "Close tab" only |
| `widget-widgetview--same-origin-dev-tools` | `overview.spec.ts` › a widget on this host's own origin: added in the form, listed like any widget; opening it asks first: without dev tools "Close tab" only |
| `widget-widgetview--capability-prompt` | `widget.spec.ts` › capability prompt: a section's checkbox checks its rows; approving nothing is not offered |
| `widget-widgetview--capability-prompt-long` | `widget.spec.ts` › capability prompt: deny all, then approve a subset; the widget's actions succeed or fail accordingly (the test widget's 33 capabilities; it asks for none this app does not know) |
| `widget-widgetview--capability-prompt-merged` | `widget.spec.ts` › a request while the prompt is open joins it: the choices stay, the new one is marked, Approve is blocked again, one answer for both (the story's progress bar is drawn full, the screenshot ends animations) |
| `widget-widgetview--capability-prompt-open-id` | `widget.spec.ts` › OpenID is a one-use capability: every token is a grant of its own, asked in the capability prompt (the prompt of the second token, "Once" by default; "Always" and the disabled choice: › OpenID "Always": every next token without the card) |
| `widget-widgetview--capability-prompt-webview` | `webview.spec.ts` › an approved webview capability restarts the widget with it; asking again needs no prompt and no restart (the test widget asks for the camera and the microphone only) |
| `widget-widgetview--compact-prompt` | **catalogue**: the prompt of a widget in a PiP box |
| `widget-devtools--bar-top` | `devtools.spec.ts` › the ⋯ button of the tab opens the bar with the messages panel; the bar docks top, bottom, left and right |
| `widget-devtools--bar-bottom` | `devtools.spec.ts` › the ⋯ button of the tab opens the bar with the messages panel; the bar docks top, bottom, left and right |
| `widget-devtools--bar-left` | `devtools.spec.ts` › the ⋯ button of the tab opens the bar with the messages panel; the bar docks top, bottom, left and right |
| `widget-devtools--bar-right` | `devtools.spec.ts` › the ⋯ button of the tab opens the bar with the messages panel; the bar docks top, bottom, left and right |
| `widget-devtools--one-panel` | `devtools.spec.ts` › the ⋯ button of the tab opens the bar with the messages panel; the bar docks top, bottom, left and right |
| `widget-devtools--two-panels` | `devtools.spec.ts` › panels open next to each other; the fourth closes the oldest; docked to a side they stack |
| `widget-devtools--three-panels` | `devtools.spec.ts` › panels open next to each other; the fourth closes the oldest; docked to a side they stack |
| `widget-devtools--fourth-panel` | `devtools.spec.ts` › panels open next to each other; the fourth closes the oldest; docked to a side they stack |
| `widget-devtools--side-panels` | `devtools.spec.ts` › panels open next to each other; the fourth closes the oldest; docked to a side they stack |
| `widget-devtools--docked-bottom` | `devtools.spec.ts` › the dev tools are resized with the separator: keyboard and drag |
| `widget-devtools--messages-expanded` | `devtools.spec.ts` › messages panel: lists the actions, a row expands to its JSON, the filter filters, Clear empties |
| `widget-devtools--driver` | `devtools.spec.ts` › driver panel: revoke one capability and all (confirm modal), add a capability (the OpenID grant of the start is marked "once"; "Always" under auto-approved: `widget.spec.ts` › OpenID "Always": every next token without the card) |
| `widget-devtools--driver-webview` | `webview.spec.ts` › the driver panel shows the webview of this load; adding a webview capability restarts the widget with it |
| `widget-devtools--console` | `devtools.spec.ts` › console panel: lists what the host logs about the widget; filter and Clear |
| `widget-devtools-stats--total` | `devtools.spec.ts` › stats panel: the tiles count actions and events; the totals of characters switch the bar graph |
| `widget-devtools-stats--to-widget-docked-right` | `devtools.spec.ts` › stats panel: the tiles count actions and events; the totals of characters switch the bar graph |

## UI

| Story | Reached by |
| --- | --- |
| `ui-atoms--atoms` | **catalogue**: the atoms of `src/views/ui/atoms.tsx` and every icon |

## Sketch

| Story | Reached by |
| --- | --- |
| `sketch-rooms-roomoverview--plain` | **sketch**, redraw of `rooms-roomoverview--plain`: the "Show all 12 members" link (finding `overview-show-all-members`) |
| `sketch-sidepanel-devbackendview--timeline` | **sketch**, redraw of `sidepanel-devbackendview--timeline`: the Sender of the send forms as a select with avatars (`implementation_findings.md`, Trivial) |
| `sketch-sidepanel-devbackendview--timeline-delayed` | **sketch**, redraw of `sidepanel-devbackendview--timeline-delayed`: what a scheduled row sends, event rows in words (`implementation_findings.md`, Trivial) |
| `sketch-sidepanel-devbackendview-tools--to-device` | **sketch**, redraw of `sidepanel-devbackendview-tools--to-device`: one Sender select (finding `devbackend-todevice-sender`) |
