/**
 * Sample view models and data for the stories (and for unit tests of the reducer): the accounts,
 * rooms, widgets and members every story shows, so the states of different views fit together.
 */
import {
  STATS_BUCKET_MS,
  widgetInstanceId,
  type AccountViewModel,
  type AppViewModel,
  type MainViewModel,
  type MockedRoomData,
  type ModalViewModel,
  type RecentRoom,
  type RecentWidget,
  type RoomDevToolPanel,
  type RoomDevToolsLayout,
  type RoomPanelViewModel,
  type RoomToolsViewModel,
  type TabId,
  type TabViewModel,
  type VerificationViewModel,
  type WidgetDevToolsData,
  type WidgetDevToolsLayout,
  type WidgetInstanceViewModel,
  type WorkspaceLayout,
} from "../appViewModel";
import type { DockItem, DockLayout } from "../dock/dockLayout";
import type { RawEvent, RoomDetails, RoomSummary, RoomTimeline, VerificationEmoji } from "../session";
import type { StateEvent } from "../widgetStateEvent";

const widgetEvent = (key: string, name: string, host: string): StateEvent => ({
  type: "m.widget",
  state_key: key,
  content: { name, url: `https://${host}/room`, uses_widget_api: true },
});

export const WIDGET_EVENTS = {
  call: widgetEvent("call", "Element Call", "call.example.org"),
  board: widgetEvent("board", "Whiteboard", "board.example.org"),
  poll: widgetEvent("poll", "Standup poll", "polls.example.org"),
  notes: widgetEvent("notes", "Meeting notes", "pad.example.org"),
  timer: widgetEvent("timer", "Timer", "timer.example.org"),
  retro: widgetEvent("retro", "Retro board", "retro.example.org"),
  stream: widgetEvent("stream", "Livestream", "stream.example.org"),
};
/** `widgetKey()` of a fixture widget. */
export const wk = (key: keyof typeof WIDGET_EVENTS) => `m.widget/${key}`;

/** A local widget ("Add widget", only in this host): a widget in development. Its key is `LOCAL_WIDGET_KEY`. */
export const LOCAL_WIDGET: StateEvent = { type: "m.widget", state_key: "proto", content: { name: "Poll prototype", url: "http://localhost:5180/", uses_widget_api: true } };
export const LOCAL_WIDGET_KEY = "local:m.widget/proto";

export const ROOMS = {
  design: { id: "!hGtVzqNmPa:example.org", name: "Design crit", memberCount: 12, widgetEvents: [WIDGET_EVENTS.call, WIDGET_EVENTS.board, WIDGET_EVENTS.poll, WIDGET_EVENTS.notes] },
  platform: { id: "!kLpQwErTyU:example.org", name: "Platform team", memberCount: 31, widgetEvents: [WIDGET_EVENTS.poll, WIDGET_EVENTS.timer] },
  family: { id: "!aBcDeFgHiJ:example.org", name: "Family", memberCount: 5, widgetEvents: [WIDGET_EVENTS.notes] },
  rtc: { id: "!rTcWgXyZaB:example.org", name: "MatrixRTC working group", memberCount: 148, widgetEvents: [WIDGET_EVENTS.call, WIDGET_EVENTS.board, WIDGET_EVENTS.notes] },
  lab: { id: "!lab:dev.local", name: "Widget lab", memberCount: 3, widgetEvents: [WIDGET_EVENTS.call, WIDGET_EVENTS.notes, WIDGET_EVENTS.timer] },
  empty: { id: "!empty:dev.local", name: "Empty room", memberCount: 1, widgetEvents: [] },
} satisfies Record<string, RoomSummary>;

export const ROOM_DETAILS: RoomDetails = {
  topic: "Weekly critique of everything visual. Bring screenshots, leave opinions at the door.",
  encrypted: true,
  memberCount: 12,
  members: [
    { userId: "@ada:example.org", displayName: "Ada Okafor", role: "Admin" },
    { userId: "@mira:example.org", displayName: "Mira Köhler", role: "Moderator" },
    { userId: "@jonas:example.org", displayName: "Jonas Weiß" },
    { userId: "@sam:matrix.example", displayName: "Sam Rivera" },
    { userId: "@priya:example.org", displayName: "Priya Nair" },
    { userId: "@tomas:corp.example", displayName: "Tomás Ortega" },
  ],
};

export const ACCOUNTS = {
  ada: { id: "ada", kind: "matrix", status: "live", userId: "@ada:example.org", displayName: "Ada Okafor", homeserver: "example.org", deviceId: "KJQWPLXBTA", verified: true, manageUrl: "https://account.example.org/" },
  work: { id: "work", kind: "matrix", status: "live", userId: "@ada.okafor:corp.example", displayName: "Ada (work)", homeserver: "corp.example", deviceId: "ZMNHGTYRED", verified: true },
  bot: { id: "bot", kind: "matrix", status: "restoreFailed", error: "The crypto store could not be opened.", userId: "@qa-bot:staging.example", displayName: "QA bot", homeserver: "staging.example", deviceId: "BOTDEVICE01" },
  dev: { id: "devBackend", kind: "devBackend", status: "live", userId: "@alice:dev.local", displayName: "DevBackend", homeserver: "in-memory", deviceId: "DEVBACKEND" },
} satisfies Record<string, AccountViewModel>;

/** The 7 emoji of an emoji verification. */
export const SAS_EMOJI: VerificationEmoji[] = [
  { symbol: "🐶", name: "Dog" },
  { symbol: "🔑", name: "Key" },
  { symbol: "🍓", name: "Strawberry" },
  { symbol: "🎧", name: "Headphones" },
  { symbol: "🎸", name: "Guitar" },
  { symbol: "🚀", name: "Rocket" },
  { symbol: "☂️", name: "Umbrella" },
];

/** A recovery key. */
export const RECOVERY_KEY = "EsTc LW2K PGiF wKEA 3As5 g5c4 BXwk qeeJ ZJV8 Q9fu gUMN UE4d";

/** The AccountView props of Ada's account while this device is verified (`done`) or not, with `verification` running. */
export const verifyingAccount = (verification?: VerificationViewModel) => ({
  accounts: [{ ...ACCOUNTS.ada, verified: verification?.step === "done", verification }],
  activeAccountId: ACCOUNTS.ada.id,
});

type RoomKey = keyof typeof ROOMS;
type WidgetName = keyof typeof WIDGET_EVENTS;

/** A running widget of a fixture room. */
export function widgetVm(room: RoomKey, widget: WidgetName, o: Partial<WidgetInstanceViewModel> = {}): WidgetInstanceViewModel {
  const event = WIDGET_EVENTS[widget];
  return {
    id: widgetInstanceId(ROOMS[room].id, wk(widget)),
    roomId: ROOMS[room].id,
    widgetKey: wk(widget),
    widget: { eventType: event.type, widgetId: event.state_key, name: String(event.content.name), url: String(event.content.url), avatarUrl: undefined, usesWidgetApi: true, legacy: undefined },
    load: { state: "ready" },
    alwaysOnScreen: false,
    prompts: {},
    ...o,
  };
}

export const widgetTab = (room: RoomKey, widget: WidgetName): TabViewModel => ({ kind: "widget", id: `tab-${room}-${widget}`, widgetId: widgetInstanceId(ROOMS[room].id, wk(widget)) });
/** The Timeline tab of a fixture room's panel. */
export const timelineTab = (room: RoomKey): TabViewModel => ({ kind: "timeline", id: `tab-${room}-timeline` });
/** The room dev tools with `panels` open (default both), the bar at `dock`: a room tab's start "top", the SidePanel's "left". */
export const roomDevTools = (dock: RoomDevToolsLayout["dock"], panels: RoomDevToolPanel[] = ["state", "timeline"]): RoomDevToolsLayout => ({ dock, panels: panels.map((panel) => ({ panel, share: 1 })) });
/** The room dev tools tab of a fixture room's panel (bar on top, both panels by default). */
export const roomToolsTab = (room: RoomKey, layout: RoomDevToolsLayout = roomDevTools("top")): TabViewModel => ({ kind: "roomTools", id: `tab-${room}-tools`, layout });
/** A room panel showing the tab `activeTabId` (default: the first tab); `null`: the room name is selected, the body is the RoomOverview. */
export function roomPanel(room: RoomKey, tabs: TabViewModel[], activeTabId: TabId | null = tabs[0]?.id ?? null, id = `panel-${room}`): RoomPanelViewModel {
  return { id, content: { kind: "room", roomId: ROOMS[room].id, tabs, activeTabId: activeTabId ?? undefined } };
}
export const pickerPanel = (id = "panel-picker"): RoomPanelViewModel => ({ id, content: { kind: "picker" } });

export const devToolsLayout = (o: Partial<WidgetDevToolsLayout> = {}): WidgetDevToolsLayout => ({
  open: true,
  dock: "top",
  panels: [{ panel: "messages", share: 1 }],
  size: { top: 240, side: 360 },
  ...o,
});

/** The dock item of a panel: its room is its group. */
const dockItem = (panel: RoomPanelViewModel, share?: number): DockItem => ({
  id: panel.id,
  ...(panel.content.kind === "room" ? { group: panel.content.roomId } : {}),
  ...(share === undefined ? {} : { share }),
});

/** `panels` in rows: `rows` the number of panels per row (default: all in one), `shares` per panel (only with siblings), `right` the last panels as right side columns. */
export function panelDock(panels: RoomPanelViewModel[], { rows = [panels.length], shares, right = 0 }: { rows?: number[]; shares?: number[]; right?: number } = {}): DockLayout {
  let i = 0;
  const take = (n: number) => panels.slice(i, (i += n)).map((p, j) => dockItem(p, shares?.[i - n + j]));
  const center = { rows: rows.flatMap((n) => (n > 0 ? [{ items: take(n) }] : [])) };
  const sides = take(right);
  return sides.length ? { center: { ...center, share: 1 }, right: sides.map((s) => ({ ...s, share: s.share ?? 0.4 })) } : { center };
}

export function workspace(panels: RoomPanelViewModel[], o: Partial<WorkspaceLayout> & { dock?: DockLayout } = {}): WorkspaceLayout {
  const { dock = panelDock(panels), ...rest } = o;
  return {
    roomsArea: { dock, panels, focusedPanelId: panels[0]?.id },
    pip: { stacking: "horizontal", position: { x: 24, y: 24 }, boxSize: { width: 224, height: 140 } },
    devTools: {},
    ...rest,
  };
}

/** The running widgets of a view model, by id. */
export const byId = (widgets: WidgetInstanceViewModel[]): Record<string, WidgetInstanceViewModel> => Object.fromEntries(widgets.map((w) => [w.id, w]));

/**
 * `mainVm` with Ada's workspace showing `panels` (laid out with `layout`: dev tools, PiP) and
 * `widgets` running: the screens of the `App/AppShell` and `App/Complete` stories.
 */
export const panelsVm = (panels: RoomPanelViewModel[], widgets: WidgetInstanceViewModel[], o: Partial<MainViewModel> = {}, layout: Parameters<typeof workspace>[1] = {}): MainViewModel =>
  mainVm({ workspaces: { ada: workspace(panels, layout) }, widgets: byId(widgets), ...o });

/** Recent widgets (`[room, widget]`) and rooms, newest first, as in the room picker of the stories. */
export const recentWidgets = (...widgets: [RoomKey, WidgetName][]): RecentWidget[] =>
  widgets.map(([room, widget], i) => ({ roomId: ROOMS[room].id, widgetKey: wk(widget), lastOpened: 1_763_300_000_000 - i * 3_600_000 }));
export const recentRooms = (...rooms: RoomKey[]): RecentRoom[] => rooms.map((room, i) => ({ roomId: ROOMS[room].id, lastOpened: 1_763_300_000_000 - i * 3_600_000 }));

/** The default screen (story `app-appshell--default`): one account, "Design crit" with the call widget open. */
export function mainVm(o: Partial<MainViewModel> = {}): MainViewModel {
  const widgets = [widgetVm("design", "call"), widgetVm("design", "board")];
  return {
    accounts: [ACCOUNTS.ada],
    activeAccountId: "ada",
    leftBar: { collapsed: false, expandButtonVisible: false },
    sidePanel: { width: 324 },
    workspaces: { ada: workspace([roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")])]) },
    data: {
      rooms: { status: "ready", value: [ROOMS.design, ROOMS.platform, ROOMS.family, ROOMS.rtc] },
      recentWidgets: recentWidgets(["design", "call"], ["design", "board"], ["platform", "poll"], ["family", "notes"]),
      recentRooms: recentRooms("design", "platform", "rtc", "family"),
      localWidgets: {},
    },
    widgets: Object.fromEntries(widgets.map((w) => [w.id, w])),
    toasts: [],
    ...o,
  };
}

/** The UI state of the Dev tools: "Widget lab" picked in the DevBackend, "Design crit" by Ada; the room dev tools of the SidePanel with the bar on the left, both panels. */
export const roomToolsVm = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => ({
  selectedRoomIds: { [ACCOUNTS.dev.id]: ROOMS.lab.id, [ACCOUNTS.ada.id]: ROOMS.design.id },
  layout: roomDevTools("left"),
  openSections: [],
  sendForm: "message",
  stateForm: "testWidget",
  tools: { open: null, heightShare: 0.5 },
  behavior: { autoApproveCapabilities: true, rememberCapabilities: false },
  scheduled: {},
  ...o,
});

/** The DevBackend active (story `app-appshell--dev-backend-active`): mocked rooms, the DevBackendView open. */
export function devMainVm(o: Partial<MainViewModel> = {}): MainViewModel {
  const widgets = [widgetVm("lab", "call"), widgetVm("lab", "notes")];
  return mainVm({
    accounts: [ACCOUNTS.ada, ACCOUNTS.dev],
    activeAccountId: ACCOUNTS.dev.id,
    returnAccountId: "ada",
    sidePanel: { view: "roomTools", width: 324 },
    roomTools: roomToolsVm(),
    workspaces: { ada: workspace([]), [ACCOUNTS.dev.id]: workspace([roomPanel("lab", [widgetTab("lab", "call"), widgetTab("lab", "notes")])]) },
    data: { rooms: { status: "ready", value: [ROOMS.lab, ROOMS.empty] }, recentWidgets: recentWidgets(["lab", "call"]), recentRooms: recentRooms("lab"), localWidgets: {} },
    widgets: Object.fromEntries(widgets.map((w) => [w.id, w])),
    ...o,
  });
}

/** The confirmation of activating the DevBackend (story `app-appshell--confirm`). */
export const SWITCH_TO_DEV_BACKEND: ModalViewModel = {
  kind: "confirm",
  title: "Switch to the DevBackend?",
  body: "Your 2 room panels are closed and their widgets stop. They are opened again when you switch back to Ada Okafor.",
  confirmLabel: "Switch to the DevBackend",
  danger: false,
  intent: { type: "account/switch", accountId: ACCOUNTS.dev.id, confirmed: true },
};

/** The confirmation of a change of a real room's configuration from the Dev tools (story `app-appshell--room-tools-confirm`). */
export const CHANGE_POWER_LEVELS: ModalViewModel = {
  kind: "confirm",
  title: "Change the power levels of Design crit?",
  body: "This m.room.power_levels event is sent to the room as @ada:example.org and changes who may do what in it, for everyone. Some changes cannot be undone, for example lowering your own level.",
  confirmLabel: "Send the state event",
  danger: true,
  intent: { type: "roomTools/sendState", roomId: ROOMS.design.id, event: { type: "m.room.power_levels", stateKey: "", content: {} }, confirmed: true },
};

/** `devTools` and `devBackend`: the two developer switches of the Settings. */
export const appVm = (main: MainViewModel = mainVm(), devTools = false, devBackend = devTools): AppViewModel => ({ settings: { devTools, devBackend, theme: "system" }, screen: { kind: "main", main } });

const X = "org.matrix.mscXXXX.";
/**
 * The characters of the stats graph: 60 buckets of which the newest is the current one when the stories load, so the graph (which ends now) shows them. Empty
 * buckets are left out, as the runtime does.
 */
const NOW_BUCKET = Math.floor(Date.now() / STATS_BUCKET_MS) * STATS_BUCKET_MS;
const statsTo = (i: number) => (i === 57 ? 3600 : i % 11 === 4 || i % 13 === 7 ? 0 : 140 + ((i * 397) % 1500));
const statsFrom = (i: number) => (i % 11 === 4 ? 0 : 60 + ((i * 211) % 620));
const CHARACTERS = Array.from({ length: 60 }, (_, i) => ({ timestamp: NOW_BUCKET - (59 - i) * STATS_BUCKET_MS, toWidget: statsTo(i), fromWidget: statsFrom(i) })).filter((b) => b.toWidget + b.fromWidget > 0);

export const DEV_TOOLS_DATA: WidgetDevToolsData = {
  messages: [
    { id: "m5", direction: "toWidget", action: `${X}forward_event`, timestamp: 1_763_300_004_200, request: { event: { type: "m.room.message", content: { msgtype: "m.text", body: "hello" } } }, response: { state: "pending" } },
    { id: "m4", direction: "fromWidget", action: `${X}send_event`, timestamp: 1_763_300_003_100, request: { type: "m.room.message", content: { msgtype: "m.text", body: "hi" } }, response: { state: "ok", afterMs: 12, data: { event_id: "$abc" } } },
    { id: "m3", direction: "fromWidget", action: `${X}send_to_device`, timestamp: 1_763_300_002_500, request: { type: "org.example.ping" }, response: { state: "error", afterMs: 3, data: { error: { code: "missing_capability", message: "Missing capability" } } } },
    { id: "m2", direction: "fromWidget", action: "org.matrix.msc4412.request_capabilities", timestamp: 1_763_300_001_000, request: { capabilities: [`widget:${X}get_matrix_context`] }, response: { state: "ok", afterMs: 1, data: {} } },
    { id: "m1", direction: "fromWidget", action: "org.matrix.msc4412.notify_ready", timestamp: 1_763_300_000_500, request: {}, response: { state: "ok", afterMs: 1, data: {} } },
  ],
  stats: {
    actionsFromWidget: 42,
    actionsToWidget: 17,
    runningSince: 1_763_300_000_500,
    eventsSharedWithWidget: 128,
    eventsSentFromWidget: 9,
    charactersTotal: { toWidget: 31_870, fromWidget: 16_343 },
    characters: CHARACTERS,
  },
  capabilities: {
    approved: [`widget:${X}get_matrix_context`, `widget:${X}get_openid`, `widget:${X}send_event.timeline:m.room.message`, `host:${X}forward_event.timeline:m.room.message`],
    autoApproved: [`widget:${X}get_client_context`],
    denied: [`widget:${X}send_to_device:org.example.ping`],
    singleUse: [`widget:${X}get_openid`],
    webview: { applied: [], sandbox: "allow-scripts allow-same-origin", allow: "" },
  },
  console: [
    { level: "log", timestamp: 1_763_300_000_600, text: "widget api ready" },
    { level: "warn", timestamp: 1_763_300_002_500, text: "send_to_device failed: missing capability" },
    { level: "error", timestamp: 1_763_300_003_900, text: "TypeError: Cannot read properties of undefined (reading 'tracks')" },
  ],
};

export const MOCKED_ROOM_DATA: MockedRoomData = {
  userId: "@alice:dev.local",
  rooms: [
    { id: ROOMS.lab.id, name: "Widget lab" },
    { id: ROOMS.empty.id, name: "Empty room" },
    { id: "!copy:dev.local", name: "Design crit (copy)", copiedFrom: { accountId: "ada", roomId: ROOMS.design.id } },
  ],
  scheduled: [{ delayId: "delay-1", type: "org.matrix.msc3401.call.member", stateKey: "@alice:dev.local", delayMs: 8000, restarts: 2, scheduledAt: 1_763_300_000_000 }],
  toDevice: [
    { direction: "fromWidget", type: "org.example.ping", userId: "@bob:dev.local", deviceId: "BOBDEVICE", encrypted: false, content: { n: 1 }, timestamp: 1_763_300_002_000 },
    { direction: "toWidget", type: "org.example.pong", userId: "@bob:dev.local", deviceId: "BOBDEVICE", encrypted: true, content: { n: 1 }, timestamp: 1_763_300_002_400 },
  ],
  failSends: false,
  media: [
    { mxcUri: "mxc://example.org/demo-landscape", mimetype: "image/png", bytes: 48_211, name: "landscape.png" },
    { mxcUri: "mxc://example.org/demo-notes", mimetype: "text/plain", bytes: 312, name: "notes.txt" },
    { mxcUri: "mxc://dev.local/upload-1", mimetype: "image/jpeg", bytes: 120_944 },
  ],
};

/** A time today (or yesterday, `daysAgo` 1) at the local time `hh:mm:ss`, as `origin_server_ts`. */
export function localTime(time: string, daysAgo = 0): number {
  const [h, m, sec] = time.split(":").map(Number);
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysAgo, h, m, sec).getTime();
}

let eventCounter = 0;
/** A raw event of a fixture timeline, at the local `time` (`hh:mm:ss`) `daysAgo` days ago; `more` adds a `state_key`, `unsigned` or a fixed `event_id`. */
export function rawEvent(time: string, daysAgo: number, sender: string, type: string, content: Record<string, unknown>, more: Partial<RawEvent> = {}): RawEvent {
  return { event_id: `$fixture${(eventCounter++).toString(36)}`, type, sender, origin_server_ts: localTime(time, daysAgo), content, ...more };
}

/**
 * The RoomTimeline of "Design crit" (story `rooms-roomtimeline--events`): an event of every kind the timeline
 * describes, yesterday and today. The fourth event of today is the one the story shows open.
 */
export const ROOM_TIMELINE: RoomTimeline = {
  atStart: false,
  loadingOlder: false,
  events: [
    rawEvent("17:40:02", 1, "@mira:example.org", "m.room.member", { membership: "join", displayname: "Mira Köhler" }, { state_key: "@mira:example.org" }),
    rawEvent("17:41:15", 1, "@ada:example.org", "m.room.topic", { topic: ROOM_DETAILS.topic }, { state_key: "" }),
    rawEvent("17:43:50", 1, "@ada:example.org", "im.vector.modular.widgets", { type: "m.custom", name: "Element Call", url: "https://call.example.org/room" }, { state_key: "call" }),
    rawEvent("12:01:08", 0, "@jonas:example.org", "m.room.message", { msgtype: "m.text", body: "Morning! The screenshots are on the whiteboard." }, { event_id: "$Mk2pXr8sLw0bQe4tNa1cVu" }),
    rawEvent("12:01:31", 0, "@mira:example.org", "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: "$Mk2pXr8sLw0bQe4tNa1cVu", key: "👍" } }),
    rawEvent("12:01:40", 0, "@ada:example.org", "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: "$Mk2pXr8sLw0bQe4tNa1cVu", key: "👍" } }),
    rawEvent("12:01:52", 0, "@priya:example.org", "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: "$Mk2pXr8sLw0bQe4tNa1cVu", key: "🎉" } }),
    rawEvent("12:02:10", 0, "@jonas:example.org", "m.room.message", { msgtype: "m.image", body: "whiteboard-page-2.png", url: "mxc://example.org/whiteboard", info: { mimetype: "image/png", w: 640, h: 400 } }),
    rawEvent("12:02:47", 0, "@ada:example.org", "m.room.message", { msgtype: "m.text", body: "Starting the call now" }, { event_id: "$Wq3bH0kTzNcEw7aLrY2mPq" }),
    rawEvent(
      "12:02:49",
      0,
      "@ada:example.org",
      "org.matrix.msc3401.call.member",
      { application: "m.call", call_id: "", scope: "m.room", device_id: "KJQWPLXBTA", focus_active: { type: "livekit", focus_selection: "oldest_membership" }, foci_preferred: [] },
      { state_key: "_@ada:example.org_KJQWPLXBTA" },
    ),
    rawEvent("12:03:02", 0, "@sam:matrix.example", "m.room.encrypted", { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "AwgAEoAB…", device_id: "SAMPHONE", sender_key: "Fw2l…", session_id: "Xb7o…" }),
    rawEvent("12:03:40", 0, "@jonas:example.org", "m.room.message", {
      msgtype: "m.text",
      body: "* The screenshots are on the whiteboard, page 2.",
      "m.new_content": { msgtype: "m.text", body: "The screenshots are on the whiteboard, page 2." },
      "m.relates_to": { rel_type: "m.replace", event_id: "$Mk2pXr8sLw0bQe4tNa1cVu" },
    }),
    rawEvent("12:04:05", 0, "@priya:example.org", "m.room.message", {}, { unsigned: { redacted_because: { type: "m.room.redaction", sender: "@priya:example.org", content: {} } } }),
    rawEvent("12:04:12", 0, "@tomas:corp.example", "m.sticker", { body: "party parrot", url: "mxc://corp.example/parrot", info: { mimetype: "image/gif", w: 128, h: 128 } }),
    rawEvent("12:04:20", 0, "@mira:example.org", "m.room.message", {
      msgtype: "m.text",
      body: "Agenda: 1. Tab bar (new) 2. Icons",
      format: "org.matrix.custom.html",
      formatted_body: "<h3>Agenda</h3><ol><li><b>Tab bar</b> – <i>new</i></li><li><code>Icons</code>, see <a href=\"https://example.org/icons\">the board</a></li></ol>",
    }),
    rawEvent("12:04:33", 0, "@ada:example.org", "org.matrix.msc3381.poll.start", {
      "org.matrix.msc3381.poll.start": { question: { body: "Ship the new tab bar?" }, kind: "org.matrix.msc3381.poll.disclosed", max_selections: 1, answers: [{ id: "yes", "org.matrix.msc1767.text": "Yes" }] },
    }),
  ],
};

/** The media of the fixtures (`ViewEnv.avatar` in the stories): the whiteboard image of `ROOM_TIMELINE`, an avatar. */
export const FIXTURE_MEDIA: Record<string, string> = {
  "mxc://example.org/whiteboard": `data:image/svg+xml,${encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400"><rect width="640" height="400" fill="#fbfaf6"/><rect x="60" y="60" width="200" height="140" rx="8" fill="#ffe07a"/><rect x="300" y="40" width="200" height="140" rx="8" fill="#ffb3c7"/><rect x="380" y="220" width="200" height="140" rx="8" fill="#a9d8ff"/><path d="M120 300c60-40 120 30 200-10" fill="none" stroke="#333" stroke-width="5" stroke-linecap="round"/></svg>',
  )}`,
};

const state = (type: string, stateKey: string, content: Record<string, unknown>, sender = "@alice:dev.local"): RawEvent => ({ type, state_key: stateKey, sender, content });

/** The state of "Widget lab", the mocked room of the DevBackendView stories (`useRoomState`). */
export const MOCKED_ROOM_STATE: RawEvent[] = [
  state("m.room.name", "", { name: "Widget lab" }),
  state("m.room.topic", "", { topic: "Mocked room for the call widget." }),
  state("m.room.member", "@alice:dev.local", { membership: "join", displayname: "Alice" }),
  state("m.room.member", "@bob:dev.local", { membership: "join", displayname: "Bob" }, "@bob:dev.local"),
  state("m.widget", "call", WIDGET_EVENTS.call.content),
];

/** The timeline of "Widget lab" (`useRoomTimeline`), oldest first: every event of a mocked room is there. */
export const MOCKED_ROOM_TIMELINE: RoomTimeline = {
  atStart: true,
  loadingOlder: false,
  events: [
    { event_id: "$e1", type: "m.room.message", sender: "@alice:dev.local", origin_server_ts: 1_763_300_001_000, content: { msgtype: "m.text", body: "Starting the call" } },
    { event_id: "$e2", type: "m.sticker", sender: "@alice:dev.local", origin_server_ts: 1_763_300_002_000, content: { body: "wave", url: "mxc://dev.local/wave" } },
    { event_id: "$e3", type: "m.room.message", sender: "@bob:dev.local", origin_server_ts: 1_763_300_003_000, content: { msgtype: "m.text", body: "Can you hear me?" } },
  ],
};

/** The state of "Design crit" as the Dev tools of Ada's account read it (story `sidepanel-roomtoolsview--state`). */
export const ROOM_STATE: RawEvent[] = [
  state("m.room.create", "", { room_version: "11" }, "@ada:example.org"),
  state("m.room.name", "", { name: "Design crit" }, "@ada:example.org"),
  state("m.room.topic", "", { topic: ROOM_DETAILS.topic }, "@ada:example.org"),
  state("m.room.member", "@ada:example.org", { membership: "join", displayname: "Ada Okafor" }, "@ada:example.org"),
  state("m.room.member", "@bob:example.org", { membership: "join", displayname: "Bob" }, "@bob:example.org"),
  state("m.room.member", "@carol:example.org", { membership: "join", displayname: "Carol" }, "@carol:example.org"),
  state("org.matrix.msc4411.widget", "call", WIDGET_EVENTS.call.content, "@ada:example.org"),
  state("org.matrix.msc4411.widget", "board", WIDGET_EVENTS.board.content, "@ada:example.org"),
  state("org.matrix.msc4411.widget", "notes", WIDGET_EVENTS.notes.content, "@ada:example.org"),
  state("m.room.power_levels", "", { users: { "@ada:example.org": 100 } }, "@ada:example.org"),
];

/** The newest events of "Design crit" in the Dev tools of Ada's account (story `sidepanel-roomtoolsview--timeline`); older ones can be loaded. */
export const ROOM_TOOLS_TIMELINE: RoomTimeline = {
  atStart: false,
  loadingOlder: false,
  events: [
    rawEvent("12:01:10", 0, "@carol:example.org", "m.room.member", { membership: "join", displayname: "Carol" }, { state_key: "@carol:example.org" }),
    rawEvent("12:03:40", 0, "@bob:example.org", "im.vector.modular.widgets", { type: "m.custom", name: "Whiteboard", url: "https://board.example.org/room" }, { state_key: "board" }),
    rawEvent("12:04:02", 0, "@carol:example.org", "m.reaction", { "m.relates_to": { rel_type: "m.annotation", event_id: "$Mk2pXr8sLw0bQe4tNa1cVu", key: "👍" } }),
    rawEvent("12:04:33", 0, "@bob:example.org", "m.room.message", { msgtype: "m.text", body: "Can you see the board?" }),
    rawEvent("12:06:12", 0, "@ada:example.org", "com.example.board.stroke", { color: "#e5484d", points: 14 }),
  ],
};
