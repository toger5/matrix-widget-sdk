// Every state of "Required visualisations" in appDesign.md, as one leaf each, plus a few complete
// screens. A leaf: { id, section, group, title, w, h, note?, theme?, html }.

import {
  accountView,
  app,
  confirmModal,
  devBackendView,
  infoModal,
  leftBar,
  loginPage,
  overviewBody,
  pickerBody,
  pip,
  roomListView,
  roomPanel,
  roomToolsView,
  settingsView,
  tabMenu,
  timelineBody,
  widgetView,
} from "./components.mjs";

const stage = (html, cls = "", style = "") => `<div class="stage ${cls}" style="${style}">${html}</div>`;
const side = (html, fence = false) => stage(`<div class="sidecol">${html}</div>`, fence ? "fence" : "");
const TOAST = "Press <kbd>Esc</kbd> to show the expand button";
const VERIFY = "AccountView: device verification";

const wt = (widgetKey, o = {}) => ({ kind: "widget", widget: widgetKey, ...o });
const tl = (o = {}) => ({ kind: "timeline", ...o });

/** The "Design crit" room with the call widget open: the default content of most screens. */
const designCall = (o = {}) =>
  roomPanel({
    room: "design",
    devTools: o.devTools,
    overflow: o.overflow,
    tabs: o.tabs ?? [wt("call", { active: true, devOpen: !!o.dev, pinned: o.pinned }), wt("board")],
    body: o.body ?? widgetView({ kind: "call", dev: o.dev, state: o.state, prompt: o.prompt }),
  });
const platformPoll = (o = {}) =>
  roomPanel({ room: "platform", devTools: o.devTools, tabs: [wt("poll", { active: true })], body: widgetView({ kind: "poll" }) });
const labCall = (o = {}) =>
  roomPanel({ room: "lab", devTools: true, tabs: [wt("call", { active: true, devOpen: !!o.dev }), wt("notes", { pinned: o.pinNotes })], body: widgetView({ kind: "call", dev: o.dev }) });

/** A room panel on its own, for the component leaves. */
const solo = (panel) => app({ panels: [panel] });
/** Only the header of a room panel (the body is cut off). */
const headOnly = (o) => stage(roomPanel({ ...o, cls: "cut", body: "" }), "", "padding-bottom:0");
const devLeaf = (dev, o = {}) => solo(designCall({ devTools: true, dev, ...o }));
/** A PiP panel floating over a room. The whiteboard is in the PiP, so its tab carries the pin marker. */
const floating = (pipHtml, panel = designCall({ tabs: [wt("call", { active: true }), wt("board", { pinned: true })] })) => stage(`${panel}${pipHtml}`, "float");

const FULL = { w: 1280, h: 800 };
const BIG = { w: 1440, h: 900 };

export const SECTIONS = [
  ["Complete views", "Whole screens with several features at once, to judge how the leaves below work together."],
  ["App", "The app-level states."],
  ["LeftBar", "The slim bar on the left. It sits directly on the app background."],
  ["SidePanel", "One panel next to the LeftBar, hosting the AccountView, the Settings, the Room list or the Dev tools (the DevBackendView while the DevBackend is active)."],
  ["PictureInPicturePanel", "The floating container for the always-on-screen widgets whose tab is not shown at the moment."],
  ["RoomsArea", "Room panels next to each other. Each one is a tabbed RoomView."],
];

export const LEAVES = [
  // ---- Complete views ---------------------------------------------------------------------
  {
    id: "complete/workspace", section: "Complete views", group: "", title: "Workspace: two rooms, dev tools, AccountView, PiP", ...BIG,
    note: "SidePanel open (RoomsArea shifted), dev tools docked on top with two panels, the whiteboard is always on screen and its tab is not the active one, so it is in the floating panel.",
    html: app({
      leftBar: { devTools: true, active: "account" },
      side: accountView({ mode: "several" }),
      panels: [
        roomPanel({ room: "design", devTools: true, style: "flex:1.7 1 0", tabs: [wt("call", { active: true, devOpen: true }), wt("board", { pinned: true })], body: widgetView({ kind: "call", dev: { dock: "top", panels: ["messages", "stats"], size: 290, stats: { plot: [254, 56], hover: null } } }) }),
        platformPoll({ devTools: true }),
      ],
      pip: pip({ items: [{ room: "design", widget: "board" }, { room: "rtc", widget: "timer" }] }),
    }),
  },
  {
    id: "complete/devbackend", section: "Complete views", group: "", title: "DevBackend: mocked room, media tool, dev tools on the right", ...BIG,
    note: "Construction-fence background and DevBackend badge. The DevBackendView with the Media Backend Tool open; dev tools docked right.",
    html: app({
      fence: true,
      leftBar: { devActive: true, active: "devtools" },
      side: devBackendView({ state: "timeline", tool: "media" }),
      panels: [labCall({ pinNotes: true, dev: { dock: "right", panels: ["messages", "driver"], size: 400 } })],
      pip: pip({ items: [{ room: "lab", widget: "notes" }], style: "right:470px;top:70px;bottom:auto" }),
    }),
  },
  {
    id: "complete/light", section: "Complete views", group: "", title: "Light theme: the overall screen in the other theme", ...BIG, theme: "light",
    note: "Always rendered in the light theme, whatever the gallery's theme switch says.",
    html: app({
      leftBar: { devTools: true, active: "settings" },
      side: settingsView({ devTools: true }),
      panels: [
        roomPanel({ room: "design", devTools: true, style: "flex:1.5 1 0", tabs: [wt("call", { active: true, devOpen: true }), wt("board", { pinned: true })], body: widgetView({ kind: "call", dev: { dock: "top", panels: ["messages", "driver"], size: 250 } }) }),
        roomPanel({ room: "rtc", devTools: true, tabs: [wt("notes")], body: overviewBody({ room: "rtc", devTools: true, opened: { notes: "here" } }) }),
      ],
      pip: pip({ items: [{ room: "design", widget: "board" }], style: "right:auto;left:392px;bottom:96px" }),
    }),
  },

  // ---- App --------------------------------------------------------------------------------
  { id: "app/login", section: "App", group: "", title: "Login page (with the skip login option)", ...FULL, html: loginPage() },
  { id: "app/default", section: "App", group: "", title: "Default screen: LeftBar + one room panel", ...FULL, html: app({ leftBar: {}, panels: [designCall()] }) },
  {
    id: "app/devbackend", section: "App", group: "", title: "DevBackend active: construction fence + badge", ...FULL,
    note: "The badge sits in the LeftBar, so the mode is not signalled by the background alone.",
    html: app({ fence: true, leftBar: { devActive: true, active: "devtools" }, side: devBackendView({ state: "timeline" }), panels: [labCall({ dev: { dock: "top", panels: [] } })] }),
  },
  {
    id: "app/devbackend-collapsed", section: "App", group: "", title: "DevBackend active, LeftBar collapsed: floating badge (extra)", ...FULL,
    note: "Without the LeftBar its badge is gone, so a floating badge takes over. It stays in the fullscreen view, where no fence is visible at all.",
    html: app({ fence: true, panels: [labCall(), roomPanel({ room: "empty", devTools: true, tabs: [], body: overviewBody({ room: "empty" }) })] }),
  },
  {
    id: "app/devbackend-empty", section: "App", group: "", title: "DevBackend just activated: empty RoomsArea (extra)", ...FULL,
    note: "Activating the DevBackend removes all panels.",
    html: app({ fence: true, leftBar: { devActive: true, active: "devtools" }, side: devBackendView({ state: "none" }), panels: [] }),
  },
  { id: "app/confirm", section: "App", group: "", title: "Confirmation before an action that loses state (extra)", ...FULL, html: app({ leftBar: { devTools: true }, panels: [designCall(), platformPoll()], modal: confirmModal() }) },
  { id: "app/info-modal", section: "App", group: "", title: "App info modal", ...FULL, html: app({ leftBar: {}, panels: [designCall()], modal: infoModal() }) },
  {
    id: "app/fullscreen", section: "App", group: "", title: "Fullscreen: LeftBar collapsed, one widget", ...FULL,
    note: "No rounded containers. The room name stays. The tab of the only widget is not shown, and the + button is hidden by default. Selecting the room name ends the fullscreen view.",
    html: app({ cls: "fullscreen", panels: [roomPanel({ room: "design", fs: true, tabs: [wt("call", { active: true })], body: widgetView({ kind: "call" }) })] }),
  },
  {
    id: "app/fullscreen-hover", section: "App", group: "", title: "Fullscreen, header hovered or focused: the tab and the + button appear", ...FULL,
    html: app({ cls: "fullscreen", panels: [roomPanel({ room: "design", fs: true, hover: true, tabs: [wt("call", { active: true })], body: widgetView({ kind: "call" }) })] }),
  },
  {
    id: "app/narrow", section: "App", group: "", title: "Narrow window: SidePanel overlays, one room panel", w: 820, h: 800,
    html: app({ narrow: true, leftBar: { active: "account" }, side: accountView({ mode: "several" }), panels: [designCall()], pager: ["Design crit", "1 of 2"] }),
  },

  // ---- LeftBar ----------------------------------------------------------------------------
  { id: "leftbar/expanded", section: "LeftBar", group: "", title: "Expanded, dev tools disabled", w: 68, h: 620, html: stage(leftBar()) },
  { id: "leftbar/devtools", section: "LeftBar", group: "", title: "Dev tools enabled: the Dev tools button", w: 68, h: 620, note: "Whether the DevBackend is enabled makes no difference here: it is activated from the AccountView or the bottom of the Dev tools.", html: stage(leftBar({ devTools: true })) },
  { id: "leftbar/devbackend", section: "LeftBar", group: "", title: "DevBackend active: the Dev tools button highlighted", w: 68, h: 620, note: "Shown even with dev tools disabled. The account icon is the DevBackend icon.", html: stage(leftBar({ devActive: true, active: "devtools" }), "fence") },
  { id: "leftbar/devbackend-hover", section: "LeftBar", group: "", title: "DevBackend active, button hovered: it opens and closes the Dev tools, never switches accounts", w: 230, h: 620, html: stage(leftBar({ devActive: true, active: "devtools", tooltip: true }), "fence") },
  { id: "leftbar/collapsed-toast", section: "LeftBar", group: "", title: "Collapsed with toast", w: 900, h: 480, html: app({ panels: [designCall({ overflow: true }), platformPoll()], toast: TOAST }) },
  {
    id: "leftbar/collapsed-expand", section: "LeftBar", group: "", title: "Collapsed, expand icon revealed (after Esc)", w: 900, h: 480,
    note: "The icon appears where the collapse button was. It also appears when the mouse reaches the left screen edge.",
    html: app({ panels: [designCall({ overflow: true }), platformPoll()], expand: true }),
  },

  // ---- SidePanel --------------------------------------------------------------------------
  { id: "sidepanel/closed", section: "SidePanel", group: "", title: "Closed", w: 900, h: 480, html: app({ leftBar: {}, panels: [designCall()] }) },
  { id: "sidepanel/account-one", section: "SidePanel", group: "AccountView", title: "One account", w: 348, h: 620, html: side(accountView({ mode: "one" })) },
  { id: "sidepanel/account-several", section: "SidePanel", group: "AccountView", title: "Several accounts, DevBackend enabled (switch list at the bottom with the DevBackend, ending with “Add account”)", w: 348, h: 680, note: "Switching to the DevBackend activates it (confirmed if room panels are open).", html: side(accountView({ mode: "several", devBackend: true })) },
  { id: "sidepanel/account-dev", section: "SidePanel", group: "AccountView", title: "DevBackend mode (full account list)", w: 348, h: 620, html: side(accountView({ mode: "dev" }), true) },
  { id: "sidepanel/verify-start", section: "SidePanel", group: VERIFY, title: "Device not verified: the “Verify this device” box", w: 348, h: 700, note: "Taller than the other AccountView leaves to show the whole panel; in a shorter window its body scrolls.", html: side(accountView({ verify: "start" })) },
  { id: "sidepanel/verify-failed", section: "SidePanel", group: VERIFY, title: "After a failure: the box again, with the reason", w: 348, h: 700, note: "The reason is the session's error (cancelled, timed out) or, as here, that the emoji did not match. It takes the place of the explanation.", html: side(accountView({ verify: "failed" })) },
  { id: "sidepanel/verify-waiting", section: "SidePanel", group: VERIFY, title: "With another device: waiting for one to accept the request", w: 348, h: 620, note: "The request goes to every other device of the account. While a step runs, the box replaces the device details and the menu; × cancels the verification.", html: side(accountView({ verify: "waiting" })) },
  { id: "sidepanel/verify-emoji", section: "SidePanel", group: VERIFY, title: "With another device: comparing the 7 emoji", w: 348, h: 620, html: side(accountView({ verify: "emoji" })) },
  { id: "sidepanel/verify-confirming", section: "SidePanel", group: VERIFY, title: "With another device: “They match” pressed, waiting for it to confirm", w: 348, h: 620, html: side(accountView({ verify: "confirming" })) },
  { id: "sidepanel/verify-recovery-key", section: "SidePanel", group: VERIFY, title: "Recovery key: entering it", w: 348, h: 620, note: "A real text field in the app: no autocomplete, no spell check. The key is never kept in the view model.", html: side(accountView({ verify: "recovery-key" })) },
  { id: "sidepanel/verify-recovery-checking", section: "SidePanel", group: VERIFY, title: "Recovery key: checking it", w: 348, h: 620, html: side(accountView({ verify: "recovery-checking" })) },
  { id: "sidepanel/verify-recovery-wrong", section: "SidePanel", group: VERIFY, title: "Recovery key: refused", w: 348, h: 620, note: "The key stays in the field. The second line is the session's error.", html: side(accountView({ verify: "recovery-wrong" })) },
  { id: "sidepanel/verify-done", section: "SidePanel", group: VERIFY, title: "Verified, until “Done”", w: 348, h: 700, note: "The details below already say “This device is verified”.", html: side(accountView({ verify: "done" })) },
  { id: "sidepanel/settings-off", section: "SidePanel", group: "Settings", title: "Both switches off", w: 348, h: 420, html: side(settingsView({ devTools: false, devBackend: false })) },
  {
    id: "sidepanel/settings-on", section: "SidePanel", group: "Settings", title: "Both switches on", w: 348, h: 620,
    note: "The two switches are independent: each lists what it shows while it is on.",
    html: side(settingsView({ devTools: true, devBackend: true })),
  },
  {
    id: "sidepanel/settings-devbackend", section: "SidePanel", group: "Settings", title: "DevBackend active: its switch is locked, dev tools off", w: 348, h: 500,
    note: "Dev tools can be off while the DevBackend is active: no ⋯ button on the widget tabs, the fence and the badge stay.",
    html: side(settingsView({ devTools: false, devBackend: true, locked: true }), true),
  },
  { id: "sidepanel/rooms", section: "SidePanel", group: "Room list", title: "The room picker in the SidePanel", w: 348, h: 760, note: "The same content as an empty room panel; the tiles wrap to two columns. The body scrolls.", html: side(roomListView()) },
  {
    id: "sidepanel/rooms-app", section: "SidePanel", group: "Room list", title: "Next to the room panels: LeftBar button pressed, RoomsArea shifted", ...FULL,
    note: "A pick opens in the room panel that shows the room (Design crit, Platform team), else in the focused empty room panel, else in a new room panel next to the focused one. In a narrow window the SidePanel closes after a pick.",
    html: app({ leftBar: { active: "rooms" }, side: roomListView(), panels: [designCall({ overflow: true }), platformPoll()] }),
  },
  { id: "roomtools/none", section: "SidePanel", group: "Dev tools of a Matrix account", title: "No room open", w: 348, h: 520, note: "“New room panel” opens a room panel with the room picker; the Dev tools stay open and show the room picked there.", html: side(roomToolsView({ state: "none", devBackend: true })) },
  { id: "roomtools/dropdown", section: "SidePanel", group: "Dev tools of a Matrix account", title: "Room dropdown open: the rooms of the room panels, left to right", w: 348, h: 520, note: "No “Add room”. It starts on the room of the focused panel; a picked room stays while it is open.", html: side(roomToolsView({ state: "dropdown" })) },
  { id: "roomtools/state", section: "SidePanel", group: "Dev tools of a Matrix account", title: "State: “sent as you”, shortcuts without “Add member”, send state, state explorer", w: 348, h: 1040, html: side(roomToolsView({ state: "state" })) },
  { id: "roomtools/timeline", section: "SidePanel", group: "Dev tools of a Matrix account", title: "Timeline: the sender is the account, a delayed event scheduled here, “Load older events”", w: 348, h: 1000, note: "The events are the ones the session holds, newest first.", html: side(roomToolsView({ state: "timeline" })) },
  { id: "roomtools/loading-failed", section: "SidePanel", group: "Dev tools of a Matrix account", title: "Reading the room: the state is loading, the timeline failed", w: 348, h: 620, html: side(roomToolsView({ state: "loading" })) },
  {
    id: "roomtools/app", section: "SidePanel", group: "Dev tools of a Matrix account", title: "Next to the room panels (LeftBar button pressed), “Switch to the DevBackend” at the bottom", ...FULL,
    note: "A Matrix account: no fence. The dropdown offers Design crit and Platform team, the rooms of the two panels. The DevBackend is enabled, so its switch link is at the bottom.",
    html: app({ leftBar: { devTools: true, active: "devtools" }, side: roomToolsView({ state: "closed", devBackend: true }), panels: [designCall(), platformPoll()] }),
  },
  {
    id: "roomtools/confirm", section: "SidePanel", group: "Dev tools of a Matrix account", title: "Confirming a change of the room's configuration", ...FULL,
    note: "Asked for power levels, join rules, encryption, history visibility, guest access, server ACL, tombstone, create event, canonical alias, another user's membership and replacing a widget. Other events are sent at once.",
    html: app({
      leftBar: { devTools: true, active: "devtools" },
      side: roomToolsView({ state: "state" }),
      panels: [designCall(), platformPoll()],
      modal: confirmModal({
        title: "Change the power levels of Design crit?",
        body: "This <b>m.room.power_levels</b> event is sent to the room as <b>@ada:example.org</b> and changes who may do what in it, for everyone. Some changes cannot be undone, for example lowering your own level.",
        confirm: "Send the state event",
        danger: true,
      }),
    }),
  },
  { id: "devbackend/none", section: "SidePanel", group: "DevBackendView", title: "No rooms yet", w: 348, h: 520, html: side(devBackendView({ state: "none" }), true) },
  { id: "devbackend/dropdown", section: "SidePanel", group: "DevBackendView", title: "Room dropdown open (rooms + add room)", w: 348, h: 520, html: side(devBackendView({ state: "dropdown" }), true) },
  { id: "devbackend/state", section: "SidePanel", group: "DevBackendView › Room page", title: "State: shortcuts, send state with the widget form, state explorer", w: 348, h: 1150, html: side(devBackendView({ state: "state" }), true) },
  { id: "devbackend/state-element-call", section: "SidePanel", group: "DevBackendView › Room page", title: "State: send state with the Element Call form", w: 348, h: 1120, html: side(devBackendView({ state: "state-element-call" }), true) },
  { id: "devbackend/state-raw", section: "SidePanel", group: "DevBackendView › Room page", title: "State: send (delayed) state as raw JSON", w: 348, h: 1090, html: side(devBackendView({ state: "state-raw" }), true) },
  { id: "devbackend/state-edit", section: "SidePanel", group: "DevBackendView › Room page", title: "State: edit state", w: 348, h: 1240, html: side(devBackendView({ state: "state-edit" }), true) },
  { id: "devbackend/timeline", section: "SidePanel", group: "DevBackendView › Room page", title: "Timeline: send event with a predefined form, event list", w: 348, h: 840, html: side(devBackendView({ state: "timeline" }), true) },
  { id: "devbackend/timeline-raw", section: "SidePanel", group: "DevBackendView › Room page", title: "Timeline: send event as raw JSON", w: 348, h: 880, html: side(devBackendView({ state: "timeline-raw" }), true) },
  { id: "devbackend/timeline-delayed", section: "SidePanel", group: "DevBackendView › Room page", title: "Timeline: send delayed event", w: 348, h: 1050, html: side(devBackendView({ state: "timeline-delayed" }), true) },
  { id: "devbackend/tools-collapsed", section: "SidePanel", group: "DevBackendView › Tools", title: "Collapsed (the “Client Backend Tool” and “Media Backend Tool” buttons)", w: 348, h: 470, html: side(devBackendView({ state: "closed" }), true) },
  { id: "devbackend/behavior", section: "SidePanel", group: "DevBackendView › Tools", title: "Client Backend Tool open below the room box: WidgetHostBehavior (resize handle, minimise button)", w: 348, h: 850, html: side(devBackendView({ state: "closed", tool: "behavior" }), true) },
  { id: "devbackend/todevice", section: "SidePanel", group: "DevBackendView › Tools", title: "Client Backend Tool open below the room box: to-device messages (dragged higher)", w: 348, h: 900, html: side(devBackendView({ state: "closed", tool: "todevice", toolHeight: 640 }), true) },
  { id: "devbackend/media-open", section: "SidePanel", group: "DevBackendView › Tools", title: "Media Backend Tool open below the room box (media list)", w: 348, h: 850, html: side(devBackendView({ state: "closed", tool: "media" }), true) },

  // ---- PictureInPicturePanel --------------------------------------------------------------
  { id: "pip/idle-1", section: "PictureInPicturePanel", group: "", title: "Idle: borderless box, 1 widget", w: 560, h: 360, html: floating(pip({ items: [{ room: "design", widget: "board" }] })) },
  { id: "pip/idle-4", section: "PictureInPicturePanel", group: "", title: "Idle: borderless boxes, 4 widgets, stacked horizontal", w: 1040, h: 360, html: floating(pip({ items: [{ room: "design", widget: "board" }, { room: "rtc", widget: "timer" }, { room: "platform", widget: "poll" }, { room: "family", widget: "notes" }] })) },
  { id: "pip/vertical", section: "PictureInPicturePanel", group: "", title: "Stacked vertical", w: 480, h: 560, html: floating(pip({ dir: "v", items: [{ room: "design", widget: "board" }, { room: "rtc", widget: "timer" }, { room: "platform", widget: "poll" }] })) },
  { id: "pip/hover", section: "PictureInPicturePanel", group: "", title: "Hover: surrounding box with room name, widget name and buttons", w: 860, h: 360, html: floating(pip({ hover: true, items: [{ room: "design", widget: "board" }, { room: "rtc", widget: "timer" }, { room: "platform", widget: "poll" }] })) },
  { id: "pip/hover-vertical", section: "PictureInPicturePanel", group: "", title: "Hover, stacked vertical", w: 480, h: 500, html: floating(pip({ hover: true, dir: "v", items: [{ room: "design", widget: "board" }, { room: "rtc", widget: "timer" }] })) },
  {
    id: "pip/enlarged-devtools", section: "PictureInPicturePanel", group: "", title: "Enlarged, with the WidgetDevToolBar of one widget open", w: 1160, h: 660,
    note: "Hovered, so the extra “close dev tools” button of the first widget is visible. Behind it the whiteboard tab is active: the call is always on screen and was moved away from.",
    html: floating(
      pip({ hover: true, box: [520, 480], items: [{ room: "design", widget: "call", dev: { dock: "top", panels: ["messages"], size: 190 } }, { room: "platform", widget: "poll" }] }),
      designCall({ devTools: true, tabs: [wt("call", { pinned: true, devOpen: true }), wt("board", { active: true })], body: widgetView({ kind: "board" }) }),
    ),
  },
  (() => {
    const items = [{ room: "design", widget: "board" }, { room: "rtc", widget: "timer" }, { room: "platform", widget: "poll" }, { room: "family", widget: "notes" }];
    const more = [{ room: "platform", widget: "retro" }, { room: "lab", widget: "stream" }];
    return [
      { id: "pip/overflow", section: "PictureInPicturePanel", group: "", title: "More widgets than fit: “+2” at the end", w: 1100, h: 360, note: "There is no limit on always-on-screen widgets. The panel shows four boxes; the rest is one press away.", html: floating(pip({ items, more })) },
      { id: "pip/overflow-menu", section: "PictureInPicturePanel", group: "", title: "Overflow menu open", w: 1100, h: 420, html: floating(pip({ items, more, hover: true, menu: true })) },
    ];
  })(),

  // ---- RoomsArea --------------------------------------------------------------------------
  { id: "roomsarea/one", section: "RoomsArea", group: "Layout", title: "One room panel", ...FULL, html: app({ leftBar: {}, panels: [roomPanel({ room: "design", tabs: [wt("call"), wt("board", { active: true })], body: widgetView({ kind: "board" }) })] }) },
  { id: "roomsarea/several", section: "RoomsArea", group: "Layout", title: "Several room panels next to each other", ...FULL, html: app({ leftBar: {}, panels: [designCall({ overflow: true }), platformPoll(), roomPanel({ body: pickerBody() })] }) },
  { id: "roomsarea/shifted", section: "RoomsArea", group: "Layout", title: "Shifted by an open SidePanel", ...FULL, html: app({ leftBar: { active: "settings" }, side: settingsView({ devTools: false }), panels: [designCall({ overflow: true }), platformPoll()] }) },

  {
    id: "panel/recents", section: "RoomsArea", group: "Room panel (empty): the room picker", title: "Recent widgets (one open in a tab), recent rooms, all rooms", w: 760, h: 520,
    note: "Element Call has a tab in another room panel: it is marked “open”, and pressing it jumps to that tab. The body scrolls.",
    html: solo(roomPanel({ body: pickerBody() })),
  },
  { id: "panel/no-recents", section: "RoomsArea", group: "Room panel (empty): the room picker", title: "No recents yet: all rooms only", w: 760, h: 520, html: solo(roomPanel({ body: pickerBody({ state: "no-recents" }) })) },
  {
    id: "panel/search", section: "RoomsArea", group: "Room panel (empty): the room picker", title: "Searching: scrolled to the search field, the matches below", w: 760, h: 520,
    note: "The field scrolled to the top when it got the focus; the recent groups are above it, out of view. The first match (highlighted) is what Enter opens; Escape clears the search.",
    html: solo(roomPanel({ body: pickerBody({ state: "search" }) })),
  },
  { id: "panel/no-rooms", section: "RoomsArea", group: "Room panel (empty): the room picker", title: "No rooms (no search field)", w: 760, h: 520, html: solo(roomPanel({ body: pickerBody({ state: "no-rooms" }) })) },
  { id: "panel/loading", section: "RoomsArea", group: "Room panel (empty): the room picker", title: "Loading (extra: every list has a loading state)", w: 760, h: 520, html: solo(roomPanel({ body: pickerBody({ state: "loading" }) })) },
  { id: "panel/error", section: "RoomsArea", group: "Room panel (empty): the room picker", title: "Error (extra: every list has an error state)", w: 760, h: 520, html: solo(roomPanel({ body: pickerBody({ state: "error" }) })) },

  {
    id: "roomview/header", section: "RoomsArea", group: "RoomView (1) › Tab bar", title: "Room name selected, no widget tab (name, number of widgets and users)", w: 640, h: 72,
    note: "The room name is the first tab. With no widget tab shown it is selected, and the body is the RoomOverview. It has no close button.",
    html: headOnly({ room: "rtc", tabs: [] }),
  },
  { id: "tabs/widget-active", section: "RoomsArea", group: "RoomView (1) › Tab bar", title: "WidgetTab active, the other WidgetTab and the room name inactive", w: 860, h: 72, html: headOnly({ room: "design", tabs: [wt("call", { active: true }), wt("board")] }) },
  { id: "tabs/overview-active", section: "RoomsArea", group: "RoomView (1) › Tab bar", title: "Room name selected (dev tools enabled: ⋯ on widget tabs)", w: 860, h: 72, note: "The room name looks like the active tab; the body is the RoomOverview. The + button selects the room name too.", html: headOnly({ room: "design", devTools: true, tabs: [wt("call"), wt("board", { devOpen: true })] }) },
  { id: "tabs/pinned", section: "RoomsArea", group: "RoomView (1) › Tab bar", title: "Tabs marked as always on screen (pin icon)", w: 960, h: 72, note: "Element Call is pinned and active: it is shown in its tab. The whiteboard is pinned and not active: it is shown in the PictureInPicturePanel until its tab is pressed.", html: headOnly({ room: "design", tabs: [wt("call", { active: true, pinned: true }), wt("board", { pinned: true }), wt("poll")] }) },
  {
    id: "tabs/timeline-active", section: "RoomsArea", group: "RoomView (1) › Tab bar", title: "Timeline tab active (dev tools enabled)", w: 860, h: 72,
    note: "The timeline is a host tab: a message icon, “Timeline” and ×, but no ⋯ and no pin. A room view has at most one; it goes at the end when it is opened. Alt+W closes it like a widget tab.",
    html: headOnly({ room: "design", devTools: true, tabs: [wt("call"), wt("board"), tl({ active: true })] }),
  },
  (() => {
    const tabs = [wt("call", { pinned: true }), wt("board"), wt("poll", { active: true }), wt("notes"), wt("timer"), wt("retro"), wt("stream")];
    return { id: "tabs/overflow", section: "RoomsArea", group: "RoomView (1) › Tab bar", title: "More tabs than fit (scroll + menu of all tabs)", w: 860, h: 360, note: "Element Call is always on screen and not the active tab, so it is in the floating panel. Only the widget tabs scroll; the room name stays.", html: app({ panels: [roomPanel({ room: "design", tabs, overflow: true, body: widgetView({ kind: "poll" }), menu: tabMenu(tabs) })], pip: pip({ items: [{ room: "design", widget: "call" }], style: "right:auto;left:28px;bottom:24px" }) }) };
  })(),

  { id: "widgetview/loading", section: "RoomsArea", group: "RoomView (1) › WidgetTab", title: "Loading", w: 700, h: 440, html: solo(designCall({ state: "loading" })) },
  { id: "widgetview/failed", section: "RoomsArea", group: "RoomView (1) › WidgetTab", title: "Failed to load", w: 700, h: 440, html: solo(designCall({ state: "failed" })) },
  { id: "widgetview/prompt", section: "RoomsArea", group: "RoomView (1) › WidgetTab", title: "Capability prompt: summary and sections", w: 700, h: 640, note: "Everything is checked at first. The risky parts of the summary come first, in bold; a warning icon marks risky rows and their section.", html: solo(designCall({ state: "prompt" })) },
  {
    id: "widgetview/prompt-long",
    section: "RoomsArea",
    group: "RoomView (1) › WidgetTab",
    title: "Capability prompt: a long list",
    w: 700,
    h: 560,
    note: "The MSC4412 test widget's 33 capabilities plus one this app does not know, scrolled to the end of the list. Only the sections scroll; the header and the buttons stay, and the header of the section in view sticks to the top. One row of “This app” is unchecked, so its checkbox is mixed.",
    html: solo(designCall({ state: "prompt", prompt: { list: "long", atEnd: true, unchecked: ["widget:org.matrix.msc2931.navigate"] } })),
  },
  {
    id: "widgetview/prompt-merged",
    section: "RoomsArea",
    group: "RoomView (1) › WidgetTab",
    title: "Capability prompt: a second request joined, “Approve” blocked",
    w: 700,
    h: 840,
    note: "The widget asked again while the card was open: its two capabilities joined their sections, checked and marked “New”; the row the user had unchecked stays unchecked. “Approve” is blocked for 3 s after the card appeared or a request added to it; “Deny all” never is.",
    html: solo(designCall({ state: "prompt", prompt: { merged: true, unchecked: ["widget:org.matrix.mscXXXX.send_event.delayed"] } })),
  },
  {
    id: "widgetview/prompt-openid",
    section: "RoomsArea",
    group: "RoomView (1) › WidgetTab",
    title: "Capability prompt: one OpenID capability, “Once”, “Approve” blocked",
    w: 700,
    h: 440,
    note: "The host grants an OpenID token for one use. “Once” (the default): the widget asks again for the next token. “Always”: it gets every token without this card, remembered with the other approvals (else while the widget runs). The choice is disabled while its row is unchecked.",
    html: solo(designCall({ state: "prompt", prompt: { list: "openid", blocked: true } })),
  },
  { id: "widgetview/plain", section: "RoomsArea", group: "RoomView (1) › WidgetTab", title: "Dev tools: no (full widget)", w: 900, h: 560, html: solo(designCall()) },
  { id: "devtools/bar-top", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Bar only, docked top", w: 900, h: 560, html: devLeaf({ dock: "top" }) },
  { id: "devtools/bar-bottom", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Bar only, docked bottom", w: 900, h: 560, html: devLeaf({ dock: "bottom" }) },
  { id: "devtools/bar-left", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Bar only, docked left", w: 900, h: 680, note: "The vertical bar needs about 600px for its labels; a shorter one shows icons only (see “Docked right with two panels”).", html: devLeaf({ dock: "left" }) },
  { id: "devtools/bar-right", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Bar only, docked right", w: 900, h: 680, html: devLeaf({ dock: "right" }) },
  { id: "devtools/one-panel", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "One panel open (full width)", w: 1000, h: 640, html: devLeaf({ dock: "top", panels: ["messages"] }) },
  { id: "devtools/two-panels", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Two panels next to each other", w: 1000, h: 640, html: devLeaf({ dock: "top", panels: ["messages", "stats"], stats: { plot: [421, 65], hover: null } }) },
  { id: "devtools/three-panels", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Three panels next to each other", w: 1280, h: 680, html: devLeaf({ dock: "top", panels: ["messages", "stats", "driver"], size: 290, stats: { plot: [349, 105], hover: null } }) },
  { id: "devtools/fourth-panel", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Fourth panel opened: the oldest one closes", w: 1280, h: 680, note: "Messages, Stats and Driver were open. Pressing Console closed Messages, the oldest. Three panels are the maximum.", html: devLeaf({ dock: "top", panels: ["stats", "driver", "console"], size: 290, stats: { plot: [349, 105], hover: null } }) },
  { id: "devtools/side-panels", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Docked right with two panels (they stack)", w: 1000, h: 640, note: "Not a leaf of the list: shows what “next to each other” becomes when the bar is docked to a side. At this height the vertical bar shows icons only.", html: devLeaf({ dock: "right", panels: ["messages", "driver"], size: 400 }) },
  { id: "devtools/bottom-panel", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "Docked bottom with one panel (the bar stays at the edge)", w: 1000, h: 640, note: "Not a leaf of the list: shows where the panels go when the bar is docked to the bottom. They sit between the widget and the bar, the separator above them, as when docked right.", html: devLeaf({ dock: "bottom", panels: ["messages"] }) },
  { id: "devtools/messages", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "WidgetDevToolMessagesPanel: list, one message expanded", w: 1000, h: 720, html: devLeaf({ dock: "top", panels: ["messages"], expanded: true, size: 420 }) },
  { id: "devtools/stats", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "WidgetDevToolStatsPanel: total graph", w: 1000, h: 640, note: "The bar under the pointer is outlined and its tooltip shows both directions. A number goes above its bar if it fits, else inside it.", html: devLeaf({ dock: "top", panels: ["stats"] }) },
  { id: "devtools/stats-direction", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "WidgetDevToolStatsPanel: one direction in a narrow panel", w: 1000, h: 640, note: "“to widget” is selected. The header wraps; the panel shows as many 5 s bars as fit, numbers only where they fit.", html: devLeaf({ dock: "right", panels: ["stats"], size: 340, stats: { series: "toWidget", plot: [274, 174], hover: null } }) },
  { id: "devtools/driver", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "WidgetDevToolDriverPanel", w: 1000, h: 720, html: devLeaf({ dock: "top", panels: ["driver"], size: 356 }) },
  { id: "devtools/console", section: "RoomsArea", group: "RoomView (1) › WidgetTab › Dev tools", title: "WidgetDevToolConsolePanel", w: 1000, h: 640, html: devLeaf({ dock: "top", panels: ["console"] }) },

  {
    id: "overview/plain", section: "RoomsArea", group: "RoomView (1) › RoomOverview", title: "No widget open, dev tools disabled", w: 900, h: 800,
    note: "A room opens here, and comes back here when its last tab is closed. Pressing a widget, or “Open timeline”, opens it as a new tab at the end.",
    html: solo(roomPanel({ room: "design", tabs: [], body: overviewBody() })),
  },
  {
    id: "overview/devtools", section: "RoomsArea", group: "RoomView (1) › RoomOverview", title: "A widget open in this panel (“jump to tab”), a local widget, dev tools and DevBackend enabled (“Add widget”, copy to DevBackend)", w: 900, h: 1000,
    note: "Element Call has a tab in this panel: it is grayed out and only offers “jump to tab”. The panel has its timeline tab, so the header offers “Show timeline”. The local widget comes after the room's widgets and counts in the room name tab; without dev tools it has no edit button. A DevBackend room has no DevBackend card: it is already in the DevBackend.",
    html: solo(roomPanel({ room: "design", devTools: true, local: 1, tabs: [wt("call"), tl()], body: overviewBody({ devTools: true, opened: { call: "here" }, timeline: true, local: ["proto"] }) })),
  },
  {
    id: "overview/add-widget", section: "RoomsArea", group: "RoomView (1) › RoomOverview", title: "Add widget: the widget form, only in this host", w: 900, h: 900,
    note: "The form replaces the “Add widget” button, at the top of the list. Prefilled with the test widget and the first free ID. Adding does not open the widget; it appears in the list, marked “Local”.",
    html: solo(roomPanel({ room: "design", devTools: true, tabs: [], body: overviewBody({ devTools: true, devBackend: false, addWidget: { form: "Widget" } }) })),
  },
  {
    id: "overview/add-widget-json", section: "RoomsArea", group: "RoomView (1) › RoomOverview", title: "Add widget: a pasted state event", w: 900, h: 900,
    note: "Pasted from Element's room state explorer: sender, event ID and timestamp are ignored. A type that is not a widget type, or a URL that is not http: or https:, is refused in the form.",
    html: solo(roomPanel({ room: "design", devTools: true, tabs: [], body: overviewBody({ devTools: true, devBackend: false, addWidget: { form: "Paste JSON" } }) })),
  },
  {
    id: "overview/add-widget-refused", section: "RoomsArea", group: "RoomView (1) › RoomOverview", title: "Add widget: to the room, refused (the reason)", w: 900, h: 940,
    note: "The account may not change the room's widgets. The draft stays, so it can be added only in this host instead. Replacing a widget of the room asks first (confirmation modal).",
    html: solo(roomPanel({ room: "design", devTools: true, tabs: [], body: overviewBody({ devTools: true, devBackend: false, addWidget: { form: "Widget", target: "room", refused: true } }) })),
  },

  {
    id: "timeline/events", section: "RoomsArea", group: "RoomView (1) › RoomTimeline", title: "Events of every kind, one showing its JSON, “Load older events”", w: 900, h: 800,
    note: "Oldest at the top, newest at the bottom; scrolled to the bottom, it stays there while new events arrive. One line per event: time, sender, what happened, event type. State events are muted; undecryptable and deleted events, reactions, edits and unknown types (a content preview) get a line too. Pressing a line shows the event's JSON. “Load older events” first shows loaded events that are not rendered (the newest 200 are), then asks the session for 50 more; while it loads it reads “Loading older events…” and is disabled.",
    html: solo(roomPanel({ room: "design", tabs: [wt("call"), tl({ active: true })], body: timelineBody() })),
  },
  {
    id: "timeline/start", section: "RoomsArea", group: "RoomView (1) › RoomTimeline", title: "Start of the room reached", w: 900, h: 640,
    note: "A mocked room: the DevBackend holds every event, so the start is always reached there. The last events were sent by a widget (the RTC member event and a custom type).",
    html: solo(roomPanel({ room: "lab", tabs: [tl({ active: true })], body: timelineBody({ state: "start" }) })),
  },
  { id: "timeline/loading", section: "RoomsArea", group: "RoomView (1) › RoomTimeline", title: "Loading", w: 700, h: 440, html: solo(roomPanel({ room: "design", tabs: [tl({ active: true })], body: timelineBody({ state: "loading" }) })) },
  { id: "timeline/error", section: "RoomsArea", group: "RoomView (1) › RoomTimeline", title: "Failed to load", w: 700, h: 440, note: "“Try again” loads the timeline again.", html: solo(roomPanel({ room: "design", tabs: [tl({ active: true })], body: timelineBody({ state: "error" }) })) },

  { id: "roomview2/different", section: "RoomsArea", group: "RoomView (2)", title: "A different room next to RoomView (1)", ...FULL, html: app({ leftBar: {}, panels: [designCall(), roomPanel({ room: "rtc", tabs: [wt("notes", { active: true }), wt("call")], body: widgetView({ kind: "notes" }) })] }) },
  {
    id: "roomview2/same", section: "RoomsArea", group: "RoomView (2)", title: "The same room as RoomView (1) (Ctrl+Shift+N, in a browser tab: Alt+Shift+N)", ...FULL,
    note: "Both panels show “Design crit”; the right one shows its RoomOverview. A widget runs once. The call and the whiteboard are open on the left, so on the right they offer “jump to tab” and “move widget here” (closes the tab on the left and opens the widget on the right; it keeps running). The poll is open in the right panel itself: only “jump to tab”.",
    html: app({ leftBar: {}, panels: [designCall(), roomPanel({ room: "design", tabs: [wt("poll")], body: overviewBody({ opened: { call: "other", board: "other", poll: "here" } }) })] }),
  },
].flat(); // an entry may be a group of leaves that share their fixtures
