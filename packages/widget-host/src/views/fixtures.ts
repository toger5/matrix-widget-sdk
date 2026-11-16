/**
 * Sample view models for the stories (and for unit tests of the reducer). The names follow the
 * mockups (`design/src/lib.mjs`), so a story can be compared with its leaf in `design/index.html`.
 */
import {
  STATS_BUCKET_MS,
  widgetInstanceId,
  type AccountViewModel,
  type AppViewModel,
  type MainViewModel,
  type MockedRoomData,
  type RoomPanelViewModel,
  type TabViewModel,
  type VerificationViewModel,
  type WidgetDevToolsData,
  type WidgetDevToolsLayout,
  type WidgetInstanceViewModel,
  type WorkspaceLayout,
} from "../appViewModel";
import type { RoomDetails, RoomSummary, VerificationEmoji } from "../session";
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
};
/** `widgetKey()` of a fixture widget. */
export const wk = (key: keyof typeof WIDGET_EVENTS) => `m.widget/${key}`;

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

/** The 7 emoji of an emoji verification, as in the mockups (`SAS_EMOJI`). */
export const SAS_EMOJI: VerificationEmoji[] = [
  { symbol: "🐶", name: "Dog" },
  { symbol: "🔑", name: "Key" },
  { symbol: "🍓", name: "Strawberry" },
  { symbol: "🎧", name: "Headphones" },
  { symbol: "🎸", name: "Guitar" },
  { symbol: "🚀", name: "Rocket" },
  { symbol: "☂️", name: "Umbrella" },
];

/** The recovery key of the mockups. */
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
    widget: { url: String(event.content.url), name: String(event.content.name), legacy: false, usesWidgetApi: true },
    load: { state: "ready" },
    alwaysOnScreen: false,
    prompts: {},
    ...o,
  };
}

export const widgetTab = (room: RoomKey, widget: WidgetName): TabViewModel => ({ kind: "widget", id: `tab-${room}-${widget}`, widgetId: widgetInstanceId(ROOMS[room].id, wk(widget)) });
export const overviewTab = (room: RoomKey): TabViewModel => ({ kind: "native", id: `tab-${room}-overview`, view: "roomOverview" });
export const newTab = (room: RoomKey): TabViewModel => ({ kind: "new", id: `tab-${room}-new` });

export function roomPanel(room: RoomKey, tabs: TabViewModel[], activeTabId = tabs[0]?.id, id = `panel-${room}`): RoomPanelViewModel {
  return { id, widthShare: 1, content: { kind: "room", roomId: ROOMS[room].id, tabs, activeTabId } };
}
export const pickerPanel = (mode: "recents" | "allRooms" = "recents", id = "panel-picker"): RoomPanelViewModel => ({ id, widthShare: 1, content: { kind: "picker", mode } });

export const devToolsLayout = (o: Partial<WidgetDevToolsLayout> = {}): WidgetDevToolsLayout => ({
  open: true,
  dock: "top",
  panels: [{ panel: "messages", share: 1 }],
  size: { top: 240, side: 360 },
  ...o,
});

export function workspace(panels: RoomPanelViewModel[], o: Partial<WorkspaceLayout> = {}): WorkspaceLayout {
  return {
    roomsArea: { panels, focusedPanelId: panels[0]?.id },
    pip: { stacking: "horizontal", position: { x: 24, y: 24 }, boxSize: { width: 224, height: 140 } },
    devTools: {},
    ...o,
  };
}

/** The default screen (leaf app/default): one account, "Design crit" with the call widget open. */
export function mainVm(o: Partial<MainViewModel> = {}): MainViewModel {
  const widgets = [widgetVm("design", "call"), widgetVm("design", "board")];
  return {
    accounts: [ACCOUNTS.ada],
    activeAccountId: "ada",
    leftBar: { collapsed: false, expandButtonVisible: false },
    sidePanel: { width: 324 },
    workspaces: { ada: workspace([roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), overviewTab("design")])]) },
    data: {
      rooms: { status: "ready", value: [ROOMS.design, ROOMS.platform, ROOMS.family, ROOMS.rtc] },
      recents: [
        { roomId: ROOMS.design.id, widgetKey: wk("call"), lastOpened: 1_763_300_000_000 },
        { roomId: ROOMS.platform.id, widgetKey: wk("poll"), lastOpened: 1_763_200_000_000 },
        { roomId: ROOMS.design.id, widgetKey: wk("board"), lastOpened: 1_763_100_000_000 },
        { roomId: ROOMS.family.id, widgetKey: wk("notes"), lastOpened: 1_763_000_000_000 },
      ],
    },
    widgets: Object.fromEntries(widgets.map((w) => [w.id, w])),
    toasts: [],
    ...o,
  };
}

/** The DevBackend active (leaf app/devbackend): mocked rooms, the DevBackendView open. */
export function devMainVm(o: Partial<MainViewModel> = {}): MainViewModel {
  const widgets = [widgetVm("lab", "call"), widgetVm("lab", "notes")];
  return mainVm({
    accounts: [ACCOUNTS.ada, ACCOUNTS.dev],
    activeAccountId: ACCOUNTS.dev.id,
    returnAccountId: "ada",
    sidePanel: { view: "devBackend", width: 324 },
    devBackend: {
      selectedRoomId: ROOMS.lab.id,
      openSections: ["state"],
      sendForm: "message",
      stateForm: "widget",
      tools: { open: null, heightShare: 0.5 },
      behavior: { autoApproveCapabilities: true, autoApproveOpenId: false, rememberCapabilities: false },
    },
    workspaces: { ada: workspace([]), [ACCOUNTS.dev.id]: workspace([roomPanel("lab", [widgetTab("lab", "call"), widgetTab("lab", "notes")])]) },
    data: { rooms: { status: "ready", value: [ROOMS.lab, ROOMS.empty] }, recents: [{ roomId: ROOMS.lab.id, widgetKey: wk("call"), lastOpened: 1_763_300_000_000 }] },
    widgets: Object.fromEntries(widgets.map((w) => [w.id, w])),
    ...o,
  });
}

export const appVm = (main: MainViewModel = mainVm(), devTools = false): AppViewModel => ({ settings: { devTools, theme: "system" }, screen: { kind: "main", main } });

const X = "org.matrix.mscXXXX.";
/**
 * The characters of the stats graph, as in the mockup (`statsPanel` in design/src/components.mjs): 60 buckets of
 * which the newest is the current one when the stories load, so the graph (which ends now) shows them. Empty
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
    approved: [`widget:${X}get_matrix_context`, `widget:${X}send_event.timeline:m.room.message`, `host:${X}forward_event.timeline:m.room.message`],
    autoApproved: [`widget:${X}get_client_context`],
    denied: [`widget:${X}send_to_device:org.example.ping`],
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
  state: [
    { type: "m.room.name", stateKey: "", content: { name: "Widget lab" } },
    { type: "m.room.topic", stateKey: "", content: { topic: "Mocked room for the call widget." } },
    { type: "m.room.member", stateKey: "@alice:dev.local", content: { membership: "join", displayname: "Alice" } },
    { type: "m.room.member", stateKey: "@bob:dev.local", content: { membership: "join", displayname: "Bob" } },
    { type: "m.widget", stateKey: "call", content: WIDGET_EVENTS.call.content },
  ],
  timeline: [
    { eventId: "$e3", type: "m.room.message", sender: "@bob:dev.local", timestamp: 1_763_300_003_000, content: { msgtype: "m.text", body: "Can you hear me?" } },
    { eventId: "$e2", type: "m.sticker", sender: "@alice:dev.local", timestamp: 1_763_300_002_000, content: { body: "wave", url: "mxc://dev.local/wave" } },
    { eventId: "$e1", type: "m.room.message", sender: "@alice:dev.local", timestamp: 1_763_300_001_000, content: { msgtype: "m.text", body: "Starting the call" } },
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
