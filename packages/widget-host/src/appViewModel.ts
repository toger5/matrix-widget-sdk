/**
 * The view model of the whole host app, as described in `appDesign.md`: one serialisable value
 * that the views render from, plus the list of intents that change it. It is the high-level shape
 * only. Three kinds of state are deliberately NOT in it:
 *
 * - **View state** that nobody else needs (the draft of a form, a hover, a filter text, which log
 *   row is expanded) stays in the component.
 * - **Runtime objects** (sessions, backends, drivers, iframes) live in a registry next to the
 *   model, keyed by the same ids. Nothing here holds an SDK object.
 * - **High-frequency data** (a widget's message log, console and stats, the state and timeline of a
 *   room, the content of the DevBackend) lives in per-widget / per-room stores that a view subscribes to with
 *   `useSyncExternalStore`. One postMessage must not produce a new `AppViewModel`. Their shapes
 *   are at the bottom of this file (`WidgetDevToolsData`, `MockedRoomData`).
 *
 * ```
 * AppViewModel
 * ├─ settings                      Settings (dev tools, DevBackend, theme), per browser
 * └─ screen
 *    ├─ restoring | login
 *    └─ main                       MainViewModel
 *       ├─ accounts, activeAccountId   multi-account; the DevBackend is one of the accounts;
 *       │                              each Matrix account with its device verification
 *       ├─ addAccount?                 the login form while a second account is added
 *       ├─ leftBar                     LeftBar
 *       ├─ sidePanel                   SidePanel: AccountView | Settings | Room list (RoomPicker) | Dev tools
 *       │                              (of the open rooms; the DevBackendView while the DevBackend is active)
 *       ├─ roomTools?                  UI state of the Dev tools: picked room per account, sections, forms,
 *       │                              what an account scheduled; the DevBackend's tool boxes and behavior
 *       ├─ workspaces[accountId]       WorkspaceLayout: persisted, one per account
 *       │  ├─ roomsArea                RoomsArea → RoomPanel → RoomPicker | RoomView → room name
 *       │  │                           (RoomOverview) + Tabs (widgets, the RoomTimeline)
 *       │  ├─ pip                      PictureInPicturePanel: stacking, position, box size
 *       │  └─ devTools[widgetId]       dock and panels of each widget's WidgetDevToolBar
 *       ├─ data                        what the active account knows: rooms, local widgets, recent widgets and rooms
 *       ├─ widgetWrite?                "Add widget" to the room: being sent, or why the room refused it
 *       ├─ widgets[widgetId]           runtime state of every running widget (one iframe each):
 *       │                              load state, always on screen, the capability / OpenID prompts
 *       └─ modal, toasts
 * ```
 *
 * Three rules that the structure encodes:
 *
 * - **A widget is not owned by its tab.** Moving an iframe in the DOM reloads it, so all iframes
 *   are rendered as one flat list in a persistent layer (keyed by `WidgetInstanceId`, never
 *   reordered) and displayed through a `<slot>` where the view shows the widget. Tabs only hold
 *   the id; `widgetSlot` says where each widget is shown.
 * - **The PiP panel is derived.** A widget that is always on screen only gets a pin icon on its
 *   tab. It is shown in the PictureInPicturePanel exactly while its tab is not shown (`pipWidgetIds`),
 *   so pressing the tab takes it out of the panel again. Nothing stores "is in PiP".
 * - **The DevBackend is an account.** Activating it switches `activeAccountId`. Every account has
 *   its own `WorkspaceLayout`, so switching back restores the panels that were open (the widgets
 *   themselves are started again: the iframes of an inactive account are not kept).
 *
 * The mockups in `design/` show every state of this model (`design/index.html`); the leaf ids in
 * the comments refer to them. `designFeedback.md` lists what the current `LiveSession`,
 * `SessionProvider` and `InMemoryBackend` cannot provide yet.
 */
import type { RoomSummary, RoomTimeline, VerificationEmoji } from "./session";
import type { ResolvedWidget, StateEvent } from "./widgetStateEvent";

export type AccountId = string;
export type RoomId = string;
export type PanelId = string;
export type TabId = string;
/**
 * Identifies a widget within a room: `widgetKey()` of its state event, `localWidgetKey()` (`local:`
 * before it) for a local widget, so a local widget never shares a key with a room widget.
 */
export type WidgetKey = string;
/**
 * One running widget (one iframe + one `WidgetHostDriver`). A widget runs at most once per
 * account, so the id is derived (`widgetInstanceId`) and survives a reload of the app.
 */
export type WidgetInstanceId = string;
export const widgetInstanceId = (roomId: RoomId, widgetKey: WidgetKey): WidgetInstanceId => `${roomId}|${widgetKey}`;

/** Every list has an empty, a loading and an error state. leaves panel/loading, panel/error */
export type Loadable<T> = { status: "loading" } | { status: "error"; error: string } | { status: "ready"; value: T };

// ---------------------------------------------------------------------------------------------
// App

export interface AppViewModel {
  settings: SettingsViewModel;
  screen: ScreenViewModel;
}

export type ScreenViewModel =
  /** Looking for stored logins. */
  | { kind: "restoring" }
  /** No account at all. leaf app/login. Skipping the login activates the DevBackend and enables dev tools and the DevBackend. */
  | { kind: "login"; login: LoginViewModel }
  | { kind: "main"; main: MainViewModel };

/** The login form: used fullscreen without an account, and in `MainViewModel.addAccount` with one. */
export interface LoginViewModel {
  homeserver: string;
  /** Known once the homeserver was looked up (`PendingLogin.options`). */
  options?: { oauth: boolean; password: boolean };
  busy: boolean;
  error?: string;
}

/**
 * Settings are per browser, not per account: they decide which tools exist at all. The two
 * developer switches are independent. leaves sidepanel/settings-off, settings-on, settings-devbackend
 */
export interface SettingsViewModel {
  /**
   * Off: no dev tool is visible (the Dev tools button of the LeftBar unless the DevBackend is active,
   * ⋯ button of widget tabs, WidgetDevToolBar, "Add widget" and editing local widgets in the
   * RoomOverview). Local widgets are still listed and run.
   */
  devTools: boolean;
  /**
   * Off: the DevBackend cannot be reached (the DevBackend account in the AccountView, "Switch to the
   * DevBackend" at the bottom of the Dev tools, "Copy to DevBackend"). It cannot be turned off while
   * the DevBackend is active. Stored settings without it take the value of `devTools`.
   */
  devBackend: boolean;
  /** "system" follows `prefers-color-scheme`. */
  theme: "system" | "light" | "dark";
}

export interface MainViewModel {
  /** All logged-in accounts, plus the DevBackend account while the DevBackend is enabled. */
  accounts: AccountViewModel[];
  activeAccountId: AccountId;
  /** Set while "Add account" is in progress. */
  addAccount?: LoginViewModel;
  leftBar: LeftBarViewModel;
  sidePanel: SidePanelViewModel;
  /**
   * The Matrix account that was active before the DevBackend. "Leave DevBackend" at the bottom of
   * the Dev tools switches back to it. `undefined` if the login was skipped: then there is
   * nothing to go back to and the leave button is not shown (`canLeaveDevBackend`).
   */
  returnAccountId?: AccountId;
  /** UI state of the Dev tools. Created when they first open; kept while the SidePanel shows something else and across account switches. */
  roomTools?: RoomToolsViewModel;
  /** Persisted. Only the active account's workspace is rendered; `account/switch` swaps it. */
  workspaces: Record<AccountId, WorkspaceLayout>;
  /** What the active account's session reports. */
  data: AccountDataViewModel;
  /** Runtime state of the active account's running widgets. Not persisted. */
  widgets: Record<WidgetInstanceId, WidgetInstanceViewModel>;
  /**
   * The last "Add widget" that writes to a room (`room/addWidget` with target "room"), while it is
   * sent and once the room refused it. Removed when the room took it, by the next `room/addWidget`
   * and by `room/dismissWidgetWrite`. The "Add widget" form of that room shows it. Not persisted.
   * leaf overview/add-widget-refused
   */
  widgetWrite?: WidgetWriteViewModel;
  modal?: ModalViewModel;
  toasts: ToastViewModel[];
}

export interface AccountViewModel {
  id: AccountId;
  /** "devBackend": the in-memory account. No Matrix request is made while it is active. */
  kind: "matrix" | "devBackend";
  /**
   * "restoreFailed": the stored login could not be started; it may still be alive, so the
   * AccountView offers "try again" and "log out", not a new login.
   * "suspended": logged in but not syncing, because the DevBackend is active.
   */
  status: "restoring" | "live" | "suspended" | "restoreFailed";
  error?: string;
  userId: string;
  displayName?: string;
  /** An `mxc://` URI; views resolve it with `LiveSession.avatar`. */
  avatarUrl?: string;
  homeserver?: string;
  deviceId?: string;
  /**
   * Whether this device is verified (`LiveSession.needsVerification`), following the session.
   * `false`: the AccountView shows the "Verify this device" box. leaf sidepanel/verify-start
   */
  verified?: boolean;
  /** The verification of this device that is running, or how the last one ended. Not set: none. */
  verification?: VerificationViewModel;
  /** The MAS account page ("Manage account & devices"), if the homeserver has one. */
  manageUrl?: string;
}

/**
 * The steps of verifying this device in the AccountView. While one of the first three runs, the
 * box replaces the device details and the menu. The recovery key itself is never in the view model.
 */
export type VerificationViewModel =
  /** The request went to the account's other devices; none has accepted yet. leaf sidepanel/verify-waiting */
  | { step: "waiting" }
  /** Both devices show `emoji`. `confirming`: "They match" was pressed, the other device has not confirmed yet. leaves sidepanel/verify-emoji, verify-confirming */
  | { step: "emoji"; emoji: VerificationEmoji[]; confirming: boolean }
  /** The recovery key form. `checking`: submitted. `error`: the key was refused. leaves sidepanel/verify-recovery-key, verify-recovery-checking, verify-recovery-wrong */
  | { step: "recoveryKey"; checking: boolean; error?: string }
  /** It ended without success (cancelled, timed out, the emoji differ, an error): the "Verify this device" box again, with the reason. leaf sidepanel/verify-failed */
  | { step: "failed"; error: string }
  /** This device was verified; shown until "Done". leaf sidepanel/verify-done */
  | { step: "done" };

/** What the session of the active account knows. Views derive room lists, the RoomPicker and the widget lists of the RoomOverview from it. */
export interface AccountDataViewModel {
  /** `LiveSession.rooms()`. The widgets of a room are its `widgetEvents`, then its `localWidgets`. */
  rooms: Loadable<RoomSummary[]>;
  /**
   * Widgets that exist only in this host, per room, as their state event would describe them
   * ("Add widget", only in this host); never sent. Keyed by `localWidgetKey()`. Persisted per
   * Matrix account and deleted on logout; the DevBackend's are kept in memory only. leaf overview/devtools
   */
  localWidgets: Record<RoomId, StateEvent[]>;
  /** The last opened widgets, newest first. Persisted per Matrix account; the DevBackend's are kept in memory only. */
  recentWidgets: RecentWidget[];
  /** The last rooms opened in a room panel (by a pick, or by opening one of its widgets), newest first. Kept like `recentWidgets`. */
  recentRooms: RecentRoom[];
}

/** "Add widget" to the room: the state event is being sent, or the room refused it (`error`, e.g. no permission). The form keeps its draft. */
export type WidgetWriteViewModel = { roomId: RoomId; widgetKey: WidgetKey; state: "sending" } | { roomId: RoomId; widgetKey: WidgetKey; state: "failed"; error: string };

export interface RecentWidget {
  roomId: RoomId;
  widgetKey: WidgetKey;
  lastOpened: number;
}

export interface RecentRoom {
  roomId: RoomId;
  lastOpened: number;
}

/** Tiles per group ("Recent widgets", "Recent rooms") of the RoomPicker. More recents are stored. leaves panel/recents, sidepanel/rooms */
export const RECENT_TILES = 4;

export type ModalViewModel =
  /** leaf app/info-modal */
  | { kind: "appInfo" }
  /** Actions that lose state are confirmed: activating the DevBackend, logging out, revoking capabilities, changing a real room's configuration. `danger`: the alert icon and a danger button. leaves app/confirm, roomtools/confirm */
  | { kind: "confirm"; title: string; body: string; confirmLabel: string; danger: boolean; intent: AppIntent };

export interface ToastViewModel {
  id: string;
  /** e.g. "Press Esc to show the expand button" (leaf leftbar/collapsed-toast) */
  text: string;
}

// ---------------------------------------------------------------------------------------------
// LeftBar and SidePanel

export interface LeftBarViewModel {
  /** leaves leftbar/collapsed-* */
  collapsed: boolean;
  /** While collapsed: revealed by Escape or by the mouse reaching the left screen edge. */
  expandButtonVisible: boolean;
}

/** leaves sidepanel/*, roomtools/*, devbackend/* */
export interface SidePanelViewModel {
  /**
   * `undefined`: closed. "rooms": the Room list, the RoomPicker of the SidePanel (leaves
   * sidepanel/rooms, sidepanel/rooms-app). "roomTools": the Dev tools, only while `devToolsAvailable`;
   * of the open rooms of a Matrix account (leaves roomtools/*), or the DevBackendView while the
   * DevBackend is active (leaves devbackend/*). Switching accounts keeps it.
   */
  view?: "account" | "settings" | "rooms" | "roomTools";
  /** Persisted. In a narrow window the panel overlays the RoomsArea instead of shifting it. */
  width: number;
}

/**
 * UI state of the Dev tools, of a Matrix account and of the DevBackend (the DevBackendView). The
 * state and timeline of the shown room are read with `useRoomState` / `useRoomTimeline` in both
 * cases; the DevBackend's other content (its rooms, scheduled events, to-device messages, "fail
 * sends", media) is `MockedRoomData`.
 */
export interface RoomToolsViewModel {
  /**
   * The room picked in the dropdown, per account. The DevBackend's is set when a mocked room is
   * added or seeded; none: no mocked room yet (leaf devbackend/none). A Matrix account's counts only
   * while the room is open in a room panel: `roomToolsRoomId`.
   */
  selectedRoomIds: Record<AccountId, RoomId>;
  /** Of the room box, and of the Client Backend Tool (DevBackend). */
  openSections: RoomToolsSection[];
  /** Which predefined form "send event" shows. "raw" is the JSON editor. */
  sendForm: "message" | "sticker" | "rtcMember" | "media" | "raw";
  /** Which predefined form "send state" shows. "raw" is type, state key and a JSON editor. leaves devbackend/state, devbackend/state-element-call, devbackend/state-raw */
  stateForm: "widget" | "elementCall" | "raw";
  /** DevBackend: the tool boxes below the room box. leaves devbackend/tools-collapsed, devbackend/behavior, devbackend/todevice, devbackend/media-open */
  tools: {
    /** The one open tool box; the other tools are buttons. `null`: only the buttons. */
    open: DevBackendTool | null;
    /** Share of the SidePanel height the open box takes (0..1). */
    heightShare: number;
  };
  /** DevBackend: for all mocked rooms. */
  behavior: WidgetHostBehavior;
  /**
   * The delayed events (MSC4140) a Matrix account scheduled from the Dev tools, per account and
   * room, until they are sent or cancelled from here or their delay has passed. The homeserver
   * cannot be asked for them, so the ones of widgets are not listed. Not persisted. leaf roomtools/timeline
   */
  scheduled: Record<AccountId, Record<RoomId, ScheduledEvent[]>>;
}

/** The sections of the room box ("state", "timeline") and of the Client Backend Tool. */
export type RoomToolsSection = "state" | "timeline" | "widgetHostBehavior" | "toDevice";

/** A delayed event that is scheduled but not sent yet. */
export interface ScheduledEvent {
  delayId: string;
  type: string;
  /** Set: a state event. */
  stateKey?: string;
  delayMs: number;
  restarts: number;
  /** When it was scheduled or last restarted (`Date.now()`), so the view can count down. */
  scheduledAt?: number;
}

/**
 * State event types that change how the room works for everyone: writing one to a real room from
 * the Dev tools asks first (`roomTools/sendState` with `confirmed`), as does another user's
 * `m.room.member` and replacing a widget of the room. leaf roomtools/confirm
 */
export const ROOM_CONFIGURATION_TYPES = [
  "m.room.power_levels",
  "m.room.join_rules",
  "m.room.encryption",
  "m.room.history_visibility",
  "m.room.guest_access",
  "m.room.server_acl",
  "m.room.tombstone",
  "m.room.create",
  "m.room.canonical_alias",
];
/** "client": the Client Backend Tool (behavior, to-device messages). "media": the Media Backend Tool. */
export type DevBackendTool = "client" | "media";

/**
 * How the host answers widgets while the DevBackend is active, without a user in the loop.
 * "Fail sends" is not part of it: the DevBackend does that (`MockedRoomData.failSends`).
 * leaf devbackend/behavior
 */
export interface WidgetHostBehavior {
  autoApproveCapabilities: boolean;
  autoApproveOpenId: boolean;
  /** `false`: every start of a widget asks again (what the in-memory mode does today). */
  rememberCapabilities: boolean;
}

// ---------------------------------------------------------------------------------------------
// Workspace layout: persisted per account

/** Everything an account has open, and how it is arranged. Serialisable; holds no runtime state. */
export interface WorkspaceLayout {
  roomsArea: RoomsAreaViewModel;
  pip: PipViewModel;
  /** Dock and open panels of each widget's dev tools. Moving a widget to the PiP panel does not change them. */
  devTools: Record<WidgetInstanceId, WidgetDevToolsLayout>;
}

/** leaves roomsarea/*, app/devbackend-empty */
export interface RoomsAreaViewModel {
  /** Left to right. Empty right after the DevBackend was activated. */
  panels: RoomPanelViewModel[];
  /** Target of the keyboard shortcuts, and the only panel shown in a narrow window. */
  focusedPanelId?: PanelId;
}

export interface RoomPanelViewModel {
  id: PanelId;
  /** Share of the RoomsArea width (flex-grow), changed by dragging between panels. */
  widthShare: number;
  content: RoomPickerViewModel | RoomViewModel;
}

/**
 * A panel without a room: the RoomPicker (recent widgets, recent rooms, all rooms with search; the
 * search text is view state). leaves panel/recents, panel/no-recents, panel/search, panel/no-rooms, panel/loading, panel/error
 */
export interface RoomPickerViewModel {
  kind: "picker";
}

/**
 * A tabbed room. Its first tab is the room name, which shows the RoomOverview; the others are
 * `tabs`. Two panels may show the same room (Alt+Shift+N). leaves roomview/*, tabs/*, overview/*, timeline/*, roomview2/*
 */
export interface RoomViewModel {
  kind: "room";
  /** The room name tab (name, number of widgets and members) is read from `data.rooms`. */
  roomId: RoomId;
  /** The tabs after the room name, in tab-bar order. A new one goes at the end. */
  tabs: TabViewModel[];
  /**
   * The shown tab. `undefined`: the room name is selected and the body is the RoomOverview
   * (leaves roomview/header, tabs/overview-active, overview/*). A room opens there, and returns
   * there when its last tab is closed; closing another active tab shows its neighbour.
   */
  activeTabId?: TabId;
}

/**
 * A tab after the room name.
 *
 * - `widget` shows a widget. Label, icon, load state and pin marker come from the widget (`widgets`).
 * - `timeline` shows the RoomTimeline of the panel's room, at most one per room panel. Its events
 *   are not in the view model: `useViewEnv().useRoomTimeline(roomId)`. leaves tabs/timeline-active, timeline/*
 *
 * Stored layouts can hold the removed kinds "native" (the overview) and "new": they are dropped on load.
 */
export type TabViewModel = { kind: "widget"; id: TabId; widgetId: WidgetInstanceId } | { kind: "timeline"; id: TabId };

/**
 * The floating container of the always-on-screen widgets whose tab is not shown. Which widgets
 * those are is derived (`pipWidgetIds`); this is only how the container looks. leaves pip/*
 */
export interface PipViewModel {
  stacking: "horizontal" | "vertical";
  position: { x: number; y: number };
  /** All boxes have the same size. Up to almost the window, so the dev tools fit. */
  boxSize: { width: number; height: number };
}

/** There is no limit on always-on-screen widgets: the first ones get a box, the others are in the overflow menu. leaves pip/overflow* */
export const PIP_VISIBLE_BOXES = 4;

export type DevToolPanel = "messages" | "stats" | "driver" | "console";
/** Opening one more panel closes the oldest one. leaf devtools/fourth-panel */
export const MAX_DEV_TOOL_PANELS = 3;

/** leaves devtools/* */
export interface WidgetDevToolsLayout {
  /** Toggled by the ⋯ button of the tab. */
  open: boolean;
  /** The bar is at the outer edge, the panels between it and the widget. leaves devtools/bar-*, devtools/bottom-panel, devtools/side-panels */
  dock: "top" | "bottom" | "left" | "right";
  /** The panels shown next to each other, oldest first, at most `MAX_DEV_TOOL_PANELS` (they stack when docked to a side). */
  panels: { panel: DevToolPanel; share: number }[];
  /** Size of the panel area in px, per orientation (`sideDock`): `top` is the height when docked top or bottom, `side` the width when docked left or right. */
  size: { top: number; side: number };
}

// ---------------------------------------------------------------------------------------------
// Running widgets: runtime, not persisted

/** One running widget. leaves widgetview/* */
export interface WidgetInstanceViewModel {
  id: WidgetInstanceId;
  roomId: RoomId;
  widgetKey: WidgetKey;
  /** URL, name, legacy (compat wrapper) or not. */
  widget: ResolvedWidget;
  load: { state: "loading" } | { state: "ready" } | { state: "failed"; error: string };
  /**
   * Counts the starts of this widget (`widget/reload` starts it again). `undefined` until its driver
   * exists: only then is the iframe rendered, so no message of the widget is lost.
   */
  generation?: number;
  /**
   * Set and cleared by the widget. Its tab gets the pin icon; the widget keeps running, and is
   * shown in the PictureInPicturePanel, whenever its tab is not shown. leaf tabs/pinned
   */
  alwaysOnScreen: boolean;
  /** Questions of the widget that wait for the user. Both can be pending at once. leaves widgetview/prompt* */
  prompts: { capabilities?: CapabilityPromptViewModel; openId?: true };
}

/**
 * The open capability question of a widget: one card, however many requests it answers. The view
 * sorts the capabilities into sections and writes the summary from them.
 * leaves widgetview/prompt, widgetview/prompt-long, widgetview/prompt-merged
 */
export interface CapabilityPromptViewModel {
  /**
   * Every capability of the requests that wait for the answer, in the order they were requested,
   * without those the widget holds already or gets without asking. A request that arrives while the
   * card is open adds to it.
   */
  requested: string[];
  /** Of `requested`, those that a later request added while the card was open: marked "New". */
  added: string[];
  /**
   * Of `requested`, those that are no capability of the widget API (the driver tells; a known
   * action name under a foreign namespace is one of them): they allow nothing. Listed under
   * "Unknown to this app".
   */
  unknown: string[];
  /**
   * When the card appeared or a request last added to it (`Date.now()`; a request that adds nothing
   * to decide does not count). "Approve" is blocked until `approveBlockedUntil`.
   */
  lastRequestAt: number;
}

/**
 * "Approve" of the capability prompt is blocked this long after the card appeared or a request added
 * to it, so a widget cannot change what the user approves just before the click, or make the card
 * appear under the pointer. "Deny all" is never blocked.
 */
export const CAPABILITY_APPROVE_DELAY_MS = 3000;

/** How many older events "Load older events" of the RoomTimeline asks the session for (`room/loadOlderEvents`). */
export const OLDER_EVENTS_PER_LOAD = 50;

// ---------------------------------------------------------------------------------------------
// Derived values: computed from the model, never stored in it.

const mainOf = (vm: AppViewModel) => (vm.screen.kind === "main" ? vm.screen.main : undefined);

/** Until when (ms since epoch) "Approve" of a capability prompt is blocked. leaf widgetview/prompt-merged */
export const approveBlockedUntil = (prompt: CapabilityPromptViewModel): number => prompt.lastRequestAt + CAPABILITY_APPROVE_DELAY_MS;

export const activeAccount = (m: MainViewModel) => m.accounts.find((a) => a.id === m.activeAccountId);
export const activeWorkspace = (m: MainViewModel): WorkspaceLayout | undefined => m.workspaces[m.activeAccountId];

/** "Leave DevBackend" is only offered when there is an account to go back to (not after "skip login"). */
export const canLeaveDevBackend = (m: MainViewModel) => m.accounts.some((a) => a.kind === "matrix");

/** Construction-fence background + DevBackend badge. leaves app/devbackend* */
export const devBackendActive = (vm: AppViewModel) => {
  const m = mainOf(vm);
  return !!m && activeAccount(m)?.kind === "devBackend";
};

/** The Dev tools button of the LeftBar and the Dev tools exist. leaves leftbar/devtools, leftbar/devbackend */
export const devToolsAvailable = (vm: AppViewModel) => vm.settings.devTools || devBackendActive(vm);

/** "Switch to the DevBackend" at the bottom of the Dev tools. leaf roomtools/app */
export const canSwitchToDevBackend = (vm: AppViewModel) => vm.settings.devBackend && !devBackendActive(vm);

/** The rooms the Dev tools of a Matrix account offer: those open in a room panel, left to right, each once. leaf roomtools/dropdown */
export function roomToolsRooms(m: MainViewModel): RoomId[] {
  const ids: RoomId[] = [];
  for (const panel of activeWorkspace(m)?.roomsArea.panels ?? []) {
    if (panel.content.kind === "room" && !ids.includes(panel.content.roomId)) ids.push(panel.content.roomId);
  }
  return ids;
}

/**
 * The room the Dev tools of a Matrix account show: the picked one while it is open, else the room
 * of the focused panel, else the first open room. `undefined`: no room open (leaf roomtools/none).
 * The DevBackend's is `selectedRoomIds` (its rooms are in `MockedRoomData`).
 */
export function roomToolsRoomId(m: MainViewModel): RoomId | undefined {
  const open = roomToolsRooms(m);
  const picked = m.roomTools?.selectedRoomIds[m.activeAccountId];
  if (picked !== undefined && open.includes(picked)) return picked;
  const roomsArea = activeWorkspace(m)?.roomsArea;
  const focused = roomsArea?.panels.find((p) => p.id === roomsArea.focusedPanelId)?.content;
  return focused?.kind === "room" ? focused.roomId : open[0];
}

/**
 * What `useRoomState(roomId, version)` reads the room state again on: the newest state event of the
 * room's timeline, where every change of the state arrives. `undefined` while the timeline loads
 * (the state is read once it is known); `""` when it failed or holds no state event.
 */
export function roomStateVersion(timeline: Loadable<RoomTimeline>): string | undefined {
  if (timeline.status === "loading") return undefined;
  if (timeline.status === "error") return "";
  const { events } = timeline.value;
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (typeof event.state_key !== "string") continue;
    return typeof event.event_id === "string" ? event.event_id : `#${i} ${event.type} ${event.state_key}`;
  }
  return "";
}

/**
 * The tab of a running widget, if a panel has one. `shown`: it is the active tab of a visible
 * panel (in a narrow window only the focused panel is visible).
 */
export function widgetTab(m: MainViewModel, id: WidgetInstanceId, narrow = false): { panelId: PanelId; tabId: TabId; shown: boolean } | undefined {
  const roomsArea = activeWorkspace(m)?.roomsArea;
  for (const panel of roomsArea?.panels ?? []) {
    if (panel.content.kind !== "room") continue;
    const tab = panel.content.tabs.find((t) => t.kind === "widget" && t.widgetId === id);
    if (!tab) continue;
    const visible = !narrow || roomsArea?.focusedPanelId === panel.id;
    return { panelId: panel.id, tabId: tab.id, shown: visible && panel.content.activeTabId === tab.id };
  }
  return undefined;
}

/**
 * The content of the PictureInPicturePanel: the always-on-screen widgets whose tab is not shown,
 * in the order they were started. The first `PIP_VISIBLE_BOXES` get a box, the others are listed
 * in the overflow menu of the container.
 */
export function pipWidgetIds(m: MainViewModel, narrow = false): WidgetInstanceId[] {
  return Object.values(m.widgets)
    .filter((w) => w.alwaysOnScreen && !widgetTab(m, w.id, narrow)?.shown)
    .map((w) => w.id);
}

/**
 * Where the persistent iframe layer puts a widget: over the body of its tab, in a PiP box, or
 * nowhere (its tab is not the active one, or it is in the PiP overflow). It keeps running either way.
 */
export function widgetSlot(m: MainViewModel, id: WidgetInstanceId, narrow = false): { in: "tab"; panelId: PanelId; tabId: TabId } | { in: "pip"; index: number } | { in: "hidden" } {
  const tab = widgetTab(m, id, narrow);
  if (tab?.shown) return { in: "tab", panelId: tab.panelId, tabId: tab.tabId };
  const index = pipWidgetIds(m, narrow).indexOf(id);
  return index >= 0 && index < PIP_VISIBLE_BOXES ? { in: "pip", index } : { in: "hidden" };
}

/**
 * "Collapsing the LeftBar while the only tab open is a widget, and shown, renders the widget
 * fullscreen": no rounded containers. The header keeps the room name, without the tab and without
 * the + button of the tab bar (both appear while the header is hovered or focused). Selecting the
 * room name ends it. leaves app/fullscreen*
 */
export function fullscreenWidget(vm: AppViewModel): WidgetInstanceId | undefined {
  const m = mainOf(vm);
  const workspace = m && activeWorkspace(m);
  if (!m || !workspace || !m.leftBar.collapsed || m.sidePanel.view) return undefined;
  const { panels } = workspace.roomsArea;
  const only = panels.length === 1 ? panels[0].content : undefined;
  if (only?.kind !== "room" || only.tabs.length !== 1) return undefined;
  const tab = only.tabs[0];
  return tab.kind === "widget" && only.activeTabId === tab.id ? tab.widgetId : undefined;
}

/** Docked left or right: the bar is a vertical strip, the panels stack and the size is `size.side`. */
export const sideDock = (dock: WidgetDevToolsLayout["dock"]): boolean => dock === "left" || dock === "right";

/**
 * Alt+W closes the shown tab of a panel that has a tab besides the room name (a widget or the
 * timeline), and else the panel itself. While the room name is selected in a panel with tabs it
 * does nothing.
 */
export const hasTab = (panel: RoomPanelViewModel): boolean => panel.content.kind === "room" && panel.content.tabs.length > 0;

// ---------------------------------------------------------------------------------------------
// Intents: what a user can ask for. A controller turns an intent into model changes and effects
// (open a URL, copy to the clipboard, call the session or the driver). What comes back from the
// outside (a widget became ready, asked for capabilities, rooms changed, a restore finished) are
// the controller's own events, not intents.

export type AppIntent =
  // app
  | { type: "login/continue"; homeserver: string } // looks the homeserver up, then OAuth or password
  | { type: "login/withPassword"; username: string; password: string }
  | { type: "login/skip" } // straight into the DevBackend, enables dev tools and the DevBackend
  | { type: "login/cancel" } // only while adding a second account
  | { type: "settings/set"; settings: Partial<SettingsViewModel> } // `devBackend` stays on while the DevBackend is active
  | { type: "modal/open"; modal: ModalViewModel }
  | { type: "modal/close" }
  | { type: "toast/dismiss"; id: string }
  // accounts
  | { type: "account/switch"; accountId: AccountId; confirmed?: boolean } // to the DevBackend account: confirmed first (the modal sends it again with `confirmed`)
  | { type: "devBackend/activate" } // "Switch to the DevBackend" at the bottom of the Dev tools: like account/switch to the DevBackend account (confirmed if panels are open); the Dev tools stay open
  | { type: "devBackend/leave" } // "Leave DevBackend": back to `returnAccountId`; the Dev tools stay open while dev tools are enabled. The DevBackend's workspace is kept, so activating it again shows the same rooms and widgets (the widgets start again)
  | { type: "account/add" }
  | { type: "account/retryRestore"; accountId: AccountId }
  | { type: "account/manage"; accountId: AccountId } // opens the MAS account page
  | { type: "account/copyMatrixUri"; accountId: AccountId }
  | { type: "account/logout"; accountId: AccountId; confirmed?: boolean } // confirmed; also forgets the remembered capabilities
  | { type: "verification/startEmoji"; accountId: AccountId } // "Verify with another device": asks the account's other devices (step waiting)
  | { type: "verification/startRecoveryKey"; accountId: AccountId } // "Use recovery key": shows the form
  | { type: "verification/submitRecoveryKey"; accountId: AccountId; recoveryKey: string } // checks the key; it goes into no state and no log
  | { type: "verification/answerEmoji"; accountId: AccountId; match: boolean } // "They match" (wait for the other device) / "They don't match" (ends it as a mismatch)
  | { type: "verification/cancel"; accountId: AccountId } // ends the running step (back to the box); "Done" closes the success box
  // left bar and side panel
  | { type: "leftBar/collapse" }
  | { type: "leftBar/revealExpandButton" } // Escape, or the mouse at the left edge
  | { type: "leftBar/expand" }
  | { type: "sidePanel/toggle"; view: NonNullable<SidePanelViewModel["view"]> } // "roomTools": the Dev tools button of the LeftBar, only while `devToolsAvailable`; never switches accounts
  | { type: "sidePanel/close" }
  | { type: "sidePanel/resize"; width: number }
  // rooms area
  | { type: "panel/new"; sameRoomAs?: PanelId } // Alt+N / Alt+Shift+N
  | { type: "panel/close"; panelId: PanelId } // its ×, and Alt+W in a panel without a tab; closes its tabs (see tab/close: always-on-screen widgets keep running in the PiP panel)
  | { type: "panel/focus"; panelId: PanelId }
  | { type: "panel/resize"; panelId: PanelId; widthShare: number }
  | { type: "panel/openRoom"; panelId: PanelId; roomId: RoomId; widgetKey?: WidgetKey } // a pick in the RoomPicker of that panel: the panel becomes the room, on its RoomOverview or with the widget as a new tab. A widget that has a tab already: jumps to it, the panel stays the picker
  | { type: "room/open"; roomId: RoomId; widgetKey?: WidgetKey } // a pick in the Room list of the SidePanel: like panel/openRoom, in the panel that shows the room (focused; a room selects its room name), else the focused picker panel, else a new panel right of the focused one
  | { type: "picker/reloadRooms" } // "Try again" of the RoomPicker's error state (`data.rooms.status === "error"`, leaf panel/error): asks the session for the rooms again
  // tabs
  | { type: "tab/showOverview"; panelId: PanelId } // the room name tab and the + button of the tab bar: selects the room name, the body shows the RoomOverview; the tab left behind may enter the PiP panel
  | { type: "tab/openWidget"; panelId: PanelId; widgetKey: WidgetKey } // a widget of the RoomOverview: a new tab at the end; already running: jumps to its tab
  | { type: "tab/moveWidgetHere"; panelId: PanelId; widgetId: WidgetInstanceId } // "move widget here" of the RoomOverview: closes its tab in the other room panel and opens it in this one; the widget keeps running
  | { type: "tab/openTimeline"; panelId: PanelId } // "Open timeline" / "Show timeline" of the RoomOverview: activates the panel's timeline tab, a new one at the end if it has none; the tab left behind may enter the PiP panel
  | { type: "tab/activate"; panelId: PanelId; tabId: TabId } // the tab of an always-on-screen widget: takes it out of the PiP panel; the tab left behind may enter it
  | { type: "tab/move"; panelId: PanelId; tabId: TabId; toIndex: number }
  | { type: "tab/close"; panelId: PanelId; tabId: TabId } // Alt+W while a tab is shown; a widget tab stops its widget, unless it is always on screen: then it keeps running in the PiP panel (assumption, see designFeedback.md). The last tab returns the room view to its RoomOverview
  // widgets
  | { type: "widget/reload"; widgetId: WidgetInstanceId } // "Retry" of a failed widget and the reload button of its dev tool bar: stops it and starts it again (new iframe and driver, the current URL of its state event); its dev tools data starts empty
  | { type: "widget/answerCapabilities"; widgetId: WidgetInstanceId; approved: string[] } // "Approve N selected" / "Deny all" (`approved: []`) of the capability prompt: answers every request it holds; an approval before `approveBlockedUntil` is ignored
  | { type: "widget/answerOpenId"; widgetId: WidgetInstanceId; allow: boolean }
  | { type: "widget/jumpToTab"; widgetId: WidgetInstanceId } // activates its tab, which takes it out of the PiP panel; opens the room panel again if it was closed
  | { type: "widget/close"; widgetId: WidgetInstanceId; confirmed?: boolean } // the close button in the PiP panel: stops (kills) the widget and closes its tab. The way to stop an always-on-screen widget. Asks first (confirm modal), because the widget still wants to stay on screen; the modal sends it again with `confirmed`
  // widget dev tools
  | { type: "devTools/toggle"; widgetId: WidgetInstanceId }
  | { type: "devTools/dock"; widgetId: WidgetInstanceId; dock: WidgetDevToolsLayout["dock"] }
  | { type: "devTools/togglePanel"; widgetId: WidgetInstanceId; panel: DevToolPanel } // opening a fourth panel closes the oldest
  | { type: "devTools/resize"; widgetId: WidgetInstanceId; size?: number; shares?: number[] }
  | { type: "devTools/clear"; widgetId: WidgetInstanceId; what: "messages" | "console" }
  | { type: "devTools/revokeCapabilities"; widgetId: WidgetInstanceId; capabilities: string[] | "all"; confirmed?: boolean } // confirmed
  | { type: "devTools/grantCapability"; widgetId: WidgetInstanceId; capability: string } // needs a new driver method
  | { type: "devTools/mockHostAction"; widgetId: WidgetInstanceId; action: "updateTheme" | "updateLanguage" | "updateVisibility"; value: string } // TODO: more actions
  | { type: "devTools/copyMessage"; widgetId: WidgetInstanceId; messageId: string } // "Copy as JSON" of an expanded message of the MessagesPanel: request and response to the clipboard (added by the widget views)
  // picture in picture
  | { type: "pip/move"; position: PipViewModel["position"] }
  | { type: "pip/resize"; boxSize: PipViewModel["boxSize"] }
  | { type: "pip/setStacking"; stacking: PipViewModel["stacking"] }
  // RoomOverview, RoomTimeline and Dev tools
  | { type: "room/addWidget"; roomId: RoomId; event: StateEvent; target: "local" | "room"; confirmed?: boolean } // "Add widget" of the RoomOverview; does not open it. "local": a local widget; one with the same key is replaced (editing): a changed URL (of a legacy widget also its `data`) forgets its remembered capabilities and reloads it if it runs. "room": sends the state event (`widgetWrite`), only once the room's widgets are known; confirmed if it replaces a widget of the room
  | { type: "room/removeLocalWidget"; roomId: RoomId; widgetKey: WidgetKey; confirmed?: boolean } // confirmed; stops the widget, closes its tab and forgets its remembered capabilities
  | { type: "room/dismissWidgetWrite" } // the "Add widget" form was closed: forgets a refusal (`widgetWrite`)
  | { type: "room/copyToDevBackend"; roomId: RoomId; lastEvents: number } // only while the DevBackend is enabled; local widgets are not copied
  | { type: "room/loadOlderEvents"; roomId: RoomId } // "Load older events" of the RoomTimeline, once it shows every loaded event: the session loads up to OLDER_EVENTS_PER_LOAD older ones (from its store or the homeserver); a failure is a toast
  // Dev tools: the DevBackend while it is active, else the room as the active Matrix account (through the room's backend)
  | { type: "roomTools/selectRoom"; roomId: RoomId } // the dropdown, for the active account
  | { type: "roomTools/toggleSection"; section: RoomToolsSection }
  | { type: "roomTools/setSendForm"; form: RoomToolsViewModel["sendForm"] }
  | { type: "roomTools/setStateForm"; form: RoomToolsViewModel["stateForm"] } // which form "send state" shows
  | { type: "roomTools/sendState"; roomId: RoomId; event: MockedStateEvent; delayMs?: number; confirmed?: boolean } // also "edit state" and the shortcuts. A real room: confirmed if it changes the room's configuration (`ROOM_CONFIGURATION_TYPES`, another user's membership, replacing a widget); a refusal is a toast
  | { type: "roomTools/sendEvent"; roomId: RoomId; event: Pick<MockedTimelineEvent, "type" | "sender" | "content">; delayMs?: number } // the DevBackend sends as `sender`; a real room only as the account (another sender is refused); a refusal is a toast
  | { type: "roomTools/updateScheduled"; roomId: RoomId; delayId: string; update: "send" | "restart" | "cancel" } // "Send now", "Restart", "Cancel" of a scheduled event (a real room: one scheduled from here)
  // DevBackendView only
  | { type: "mock/addRoom" }
  | { type: "mock/removeRoom"; roomId: RoomId }
  | { type: "mock/sendToDevice"; message: Omit<ToDeviceMessage, "direction"> }
  | { type: "mock/setBehavior"; behavior: Partial<WidgetHostBehavior> } // for all mocked rooms
  | { type: "mock/setFailSends"; on: boolean } // every send of a widget in every mocked room fails (or succeeds again)
  | { type: "mock/clearRoom"; roomId: RoomId } // drops all events of the mocked room
  | { type: "mock/toggleTool"; tool: DevBackendTool } // opens the tool box (closing the open one) or minimises it
  | { type: "mock/resizeTool"; heightShare: number } // the share of the open tool box
  | { type: "media/upload"; files: File[] }
  | { type: "media/copyMxcUri"; mxcUri: string };

/** An intent as it may be logged: the secrets (the recovery key, a password) are left out. */
export function loggableIntent(intent: AppIntent): Partial<AppIntent> {
  if (intent.type === "verification/submitRecoveryKey") return { type: intent.type };
  if (intent.type === "login/withPassword") return { type: intent.type, username: intent.username };
  return intent;
}

// ---------------------------------------------------------------------------------------------
// Data that is NOT part of AppViewModel (see the top of the file): one store per widget / per
// mocked room, subscribed to by the view that shows it.

/** What the dev tool panels of one widget show. Recorded from the start of the widget, also while the dev tools are closed; a reload starts it empty. */
export interface WidgetDevToolsData {
  /** Capped (500); the log offers "clear". leaf devtools/messages */
  messages: WidgetMessage[];
  /** leaves devtools/stats, devtools/stats-direction */
  stats: WidgetStats;
  /** leaf devtools/driver. From `DriverSnapshot`; "denied" needs the driver to report it. */
  capabilities: { approved: string[]; autoApproved: string[]; denied: string[] };
  /** The widget's own console, forwarded by the widget SDK / compat wrapper. leaf devtools/console */
  console: { level: "log" | "info" | "warn" | "error"; timestamp: number; text: string }[];
}

/** One message of the widget API. Collapsed, the log shows direction, action and response state. */
export interface WidgetMessage {
  id: string;
  direction: "fromWidget" | "toWidget";
  action: string;
  timestamp: number;
  request: unknown;
  response: { state: "pending" } | { state: "ok"; afterMs: number; data: unknown } | { state: "error"; afterMs: number; data: unknown };
}

export interface WidgetStats {
  actionsFromWidget: number;
  actionsToWidget: number;
  /** When the widget reported that it is ready; the run duration counts from here. */
  runningSince?: number;
  eventsSharedWithWidget: number;
  eventsSentFromWidget: number;
  /** Characters (of the JSON envelopes) sent over the widget API since the widget started, per direction. The selector of the graph shows them and their sum. */
  charactersTotal: { toWidget: number; fromWidget: number };
  /**
   * Characters per bucket of `STATS_BUCKET_MS` (`timestamp` is the bucket start), oldest first, the
   * newest `MAX_STATS_BUCKETS`. Only buckets with traffic are listed; the graph shows the others as 0.
   */
  characters: { timestamp: number; toWidget: number; fromWidget: number }[];
}

/** The time bucket of `WidgetStats.characters`: one bar of the stats graph. */
export const STATS_BUCKET_MS = 5_000;
/** Buckets kept per widget (5 minutes); the graph shows as many of the newest as fit. */
export const MAX_STATS_BUCKETS = 60;

/**
 * The content of the DevBackend, read from its store. The state and timeline of a mocked room are
 * read like those of a real room (`useRoomState`, `useRoomTimeline`). leaves devbackend/*
 */
export interface MockedRoomData {
  rooms: { id: RoomId; name: string; avatarUrl?: string; copiedFrom?: { accountId: AccountId; roomId: RoomId } }[];
  /** The user the DevBackend acts as: the default sender of the send forms. */
  userId?: string;
  /** Of the selected room: its delayed events (state and timeline), whoever scheduled them, that are not sent yet. */
  scheduled: ScheduledEvent[];
  /** Account-scoped, not per room. */
  toDevice: ToDeviceMessage[];
  /** Account-scoped: every send of a widget is answered with an error. */
  failSends: boolean;
  /** Not per room. `name` and `uploadedBy` need the store to record them. */
  media: { mxcUri: string; mimetype?: string; bytes: number; name?: string; uploadedBy?: WidgetInstanceId; /** An object URL for a preview or a download. */ url?: string }[];
}

/** A state event as the Dev tools show and send it (of a mocked or a real room). */
export interface MockedStateEvent {
  type: string;
  stateKey: string;
  content: Record<string, unknown>;
}
/** A timeline event as the Dev tools show and send it (of a mocked or a real room). */
export interface MockedTimelineEvent {
  eventId: string;
  type: string;
  sender: string;
  timestamp: number;
  content: Record<string, unknown>;
}
export interface ToDeviceMessage {
  direction: "toWidget" | "fromWidget";
  /** When the DevBackend first saw the message. */
  timestamp?: number;
  type: string;
  userId: string;
  deviceId: string;
  encrypted: boolean;
  content: Record<string, unknown>;
}
