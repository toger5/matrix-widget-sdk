/**
 * The view model of the whole host app, as described in `appDesign.md`: one serialisable value
 * that the views render from, plus the list of intents that change it. It is the high-level shape
 * only. Three kinds of state are deliberately NOT in it:
 *
 * - **View state** that nobody else needs (the draft of a form, a hover, a filter text, which log
 *   row is expanded) stays in the component.
 * - **Runtime objects** (sessions, backends, drivers, iframes) live in a registry next to the
 *   model, keyed by the same ids. Nothing here holds an SDK object.
 * - **High-frequency data** (a widget's message log, console and stats, the content of a mocked
 *   room) lives in per-widget / per-room stores that a view subscribes to with
 *   `useSyncExternalStore`. One postMessage must not produce a new `AppViewModel`. Their shapes
 *   are at the bottom of this file (`WidgetDevToolsData`, `MockedRoomData`).
 *
 * ```
 * AppViewModel
 * ├─ settings                      Settings (dev tools, theme), per browser
 * └─ screen
 *    ├─ restoring | login
 *    └─ main                       MainViewModel
 *       ├─ accounts, activeAccountId   multi-account; the DevBackend is one of the accounts
 *       ├─ addAccount?                 the login form while a second account is added
 *       ├─ leftBar                     LeftBar
 *       ├─ sidePanel                   SidePanel: AccountView | Settings | DevBackendView
 *       ├─ devBackend?                 UI state of the DevBackendView
 *       ├─ workspaces[accountId]       WorkspaceLayout: persisted, one per account
 *       │  ├─ roomsArea                RoomsArea → RoomPanel → RoomPicker | RoomView → Tabs
 *       │  ├─ pip                      PictureInPicturePanel: stacking, position, box size
 *       │  └─ devTools[widgetId]       dock and panels of each widget's WidgetDevToolBar
 *       ├─ data                        what the active account knows: rooms, recents
 *       ├─ widgets[widgetId]           runtime state of every running widget (one iframe each)
 *       └─ modal, toasts
 * ```
 *
 * Three rules that the structure encodes:
 *
 * - **A widget is not owned by its tab.** Moving an iframe in the DOM reloads it, so all iframes
 *   are rendered as one flat list in a persistent layer (keyed by `WidgetInstanceId`, never
 *   reordered) and positioned over a slot. Tabs only hold the id; `widgetSlot` says where each
 *   widget is shown.
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
import type { RoomSummary } from "./session";
import type { ResolvedWidget } from "./widgetStateEvent";

export type AccountId = string;
export type RoomId = string;
export type PanelId = string;
export type TabId = string;
/** `widgetKey()` of the widget's state event: identifies a widget within a room. */
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
  /** No account at all. leaf app/login. Skipping the login activates the DevBackend and enables the dev tools. */
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

/** Settings are per browser, not per account: they decide which tools exist at all. leaves sidepanel/settings-* */
export interface SettingsViewModel {
  /**
   * Off: no dev tool is visible anywhere (DevBackend button, ⋯ button of widget tabs,
   * WidgetDevToolBar, "copy to DevBackend"). It cannot be turned off while the DevBackend is active.
   */
  devTools: boolean;
  /** "system" follows `prefers-color-scheme`. */
  theme: "system" | "light" | "dark";
}

export interface MainViewModel {
  /** All logged-in accounts, plus the DevBackend account while dev tools are enabled. */
  accounts: AccountViewModel[];
  activeAccountId: AccountId;
  /** Set while "Add account" is in progress. */
  addAccount?: LoginViewModel;
  leftBar: LeftBarViewModel;
  sidePanel: SidePanelViewModel;
  /**
   * The Matrix account that was active before the DevBackend. "Leave DevBackend" at the bottom of
   * the DevBackendView switches back to it. `undefined` if the login was skipped: then there is
   * nothing to go back to and the leave button is not shown (`canLeaveDevBackend`).
   */
  returnAccountId?: AccountId;
  /** UI state of the DevBackendView. Kept while the SidePanel shows something else. */
  devBackend?: DevBackendViewModel;
  /** Persisted. Only the active account's workspace is rendered; `account/switch` swaps it. */
  workspaces: Record<AccountId, WorkspaceLayout>;
  /** What the active account's session reports. */
  data: AccountDataViewModel;
  /** Runtime state of the active account's running widgets. Not persisted. */
  widgets: Record<WidgetInstanceId, WidgetInstanceViewModel>;
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
  /** `false`: the AccountView shows the verification flow (emoji or recovery key), a self-contained view on the account's session. */
  verified?: boolean;
  /** The MAS account page ("Manage account & devices"), if the homeserver has one. */
  manageUrl?: string;
}

/** What the session of the active account knows. Views derive room lists and widget tiles from it. */
export interface AccountDataViewModel {
  /** `LiveSession.rooms()`. The widgets of a room are its `widgetEvents`. */
  rooms: Loadable<RoomSummary[]>;
  /** The last opened widgets, newest first (persisted per account). */
  recents: RecentWidget[];
}

export interface RecentWidget {
  roomId: RoomId;
  widgetKey: WidgetKey;
  lastOpened: number;
}

export type ModalViewModel =
  /** leaf app/info-modal */
  | { kind: "appInfo" }
  /** Actions that lose state are confirmed: activating the DevBackend, logging out, revoking capabilities. leaf app/confirm */
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

/** leaves sidepanel/*, devbackend/* */
export interface SidePanelViewModel {
  /** `undefined`: closed. "devBackend" is only possible while the DevBackend account is active. */
  view?: "account" | "settings" | "devBackend";
  /** Persisted. In a narrow window the panel overlays the RoomsArea instead of shifting it. */
  width: number;
}

/**
 * UI state of the DevBackendView. The content of the mocked rooms (state, timeline, scheduled
 * events, to-device messages, media) is `MockedRoomData`, read from the DevBackend's store.
 */
export interface DevBackendViewModel {
  /** `undefined`: no rooms yet (leaf devbackend/none). */
  selectedRoomId?: RoomId;
  openSections: DevBackendSection[];
  /** Which predefined form "send event" shows. "raw" is the JSON editor. */
  sendForm: "message" | "sticker" | "rtcMember" | "media" | "raw";
  media: {
    /** Closed: only the "Media Backend Tool" button below the room box. leaves devbackend/media-* */
    open: boolean;
    /** Share of the SidePanel height the box takes while open (0..1). */
    heightShare: number;
  };
  /** Per mocked room. */
  behavior: Record<RoomId, WidgetHostBehavior>;
}

export type DevBackendSection = "state" | "timeline" | "widgetHostBehavior" | "toDevice";

/** How the host answers widgets in a mocked room, without a user in the loop. leaf devbackend/behavior */
export interface WidgetHostBehavior {
  autoApproveCapabilities: boolean;
  autoApproveOpenId: boolean;
  /** `false`: every start of a widget asks again (what the in-memory mode does today). */
  rememberCapabilities: boolean;
  /** Answer every send with an error, to test a widget's error handling. */
  failSends: boolean;
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

/** A panel without a room: tiles of the recent widgets, or the room list. leaves panel/* */
export interface RoomPickerViewModel {
  kind: "picker";
  mode: "recents" | "allRooms";
}

/** A tabbed room. Two panels may show the same room (Alt+Shift+N). leaves roomview/*, tabs/*, roomview2/* */
export interface RoomViewModel {
  kind: "room";
  /** The header (name, number of widgets and members) is read from `data.rooms`. */
  roomId: RoomId;
  /** In tab-bar order. Empty: the body shows the widget tiles (leaf roomview/tiles). */
  tabs: TabViewModel[];
  activeTabId?: TabId;
}

export type TabViewModel =
  /** Shows a widget. Label, icon, load state and pin marker come from the widget (`widgets`). */
  | { kind: "widget"; id: TabId; widgetId: WidgetInstanceId }
  /** A view of the host itself. More kinds (timeline, room dev tools) may follow. leaves overview/* */
  | { kind: "native"; id: TabId; view: "roomOverview" }
  /** Opened by the + button: the widget tiles. Picking one turns it into a widget tab. leaf roomview/new-tab */
  | { kind: "new"; id: TabId };

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
  dock: "top" | "left" | "right";
  /** The panels shown next to each other, oldest first, at most `MAX_DEV_TOOL_PANELS` (they stack when docked to a side). */
  panels: { panel: DevToolPanel; share: number }[];
  /** Size of the panel area in px, per dock orientation. */
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
   * Counts the starts of this widget ("retry" starts it again). `undefined` until its driver
   * exists: only then is the iframe rendered, so no message of the widget is lost.
   */
  generation?: number;
  /**
   * Set and cleared by the widget. Its tab gets the pin icon; the widget keeps running, and is
   * shown in the PictureInPicturePanel, whenever its tab is not shown. leaf tabs/pinned
   */
  alwaysOnScreen: boolean;
  /** Questions of the widget that wait for the user. Both can be pending at once. leaf widgetview/prompt */
  prompts: { capabilities?: { requested: string[] }; openId?: true };
}

// ---------------------------------------------------------------------------------------------
// Derived values: computed from the model, never stored in it.

const mainOf = (vm: AppViewModel) => (vm.screen.kind === "main" ? vm.screen.main : undefined);

export const activeAccount = (m: MainViewModel) => m.accounts.find((a) => a.id === m.activeAccountId);
export const activeWorkspace = (m: MainViewModel): WorkspaceLayout | undefined => m.workspaces[m.activeAccountId];

/** "Leave DevBackend" is only offered when there is an account to go back to (not after "skip login"). */
export const canLeaveDevBackend = (m: MainViewModel) => m.accounts.some((a) => a.kind === "matrix");

/** Construction-fence background + DevBackend badge. leaves app/devbackend* */
export const devBackendActive = (vm: AppViewModel) => {
  const m = mainOf(vm);
  return !!m && activeAccount(m)?.kind === "devBackend";
};

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
 * "Collapsing the LeftBar while only one widget is open renders the widget fullscreen": no rounded
 * containers. The room header stays, without the tab and without the + button of the tab bar
 * (both appear while the header is hovered or focused). leaves app/fullscreen*
 */
export function fullscreenWidget(vm: AppViewModel): WidgetInstanceId | undefined {
  const m = mainOf(vm);
  const workspace = m && activeWorkspace(m);
  if (!m || !workspace || !m.leftBar.collapsed || m.sidePanel.view) return undefined;
  const { panels } = workspace.roomsArea;
  const only = panels.length === 1 ? panels[0].content : undefined;
  if (only?.kind !== "room" || only.tabs.length !== 1) return undefined;
  const tab = only.tabs[0];
  return tab.kind === "widget" ? tab.widgetId : undefined;
}

// ---------------------------------------------------------------------------------------------
// Intents: what a user can ask for. A controller turns an intent into model changes and effects
// (open a URL, copy to the clipboard, call the session or the driver). What comes back from the
// outside (a widget became ready, asked for capabilities, rooms changed, a restore finished) are
// the controller's own events, not intents.

export type AppIntent =
  // app
  | { type: "login/continue"; homeserver: string } // looks the homeserver up, then OAuth or password
  | { type: "login/withPassword"; username: string; password: string }
  | { type: "login/skip" } // straight into the DevBackend, enables dev tools
  | { type: "login/cancel" } // only while adding a second account
  | { type: "settings/set"; settings: Partial<SettingsViewModel> }
  | { type: "modal/open"; modal: ModalViewModel }
  | { type: "modal/close" }
  | { type: "toast/dismiss"; id: string }
  // accounts
  | { type: "account/switch"; accountId: AccountId; confirmed?: boolean } // to the DevBackend account: confirmed first (the modal sends it again with `confirmed`)
  | { type: "devBackend/toggle" } // the LeftBar button: activates the DevBackend (confirmed if panels are open); while it is active it only opens and closes the DevBackendView
  | { type: "devBackend/leave" } // "Leave DevBackend": back to `returnAccountId`. The DevBackend's workspace is kept, so activating it again shows the same rooms and widgets (the widgets start again)
  | { type: "account/add" }
  | { type: "account/retryRestore"; accountId: AccountId }
  | { type: "account/manage"; accountId: AccountId } // opens the MAS account page
  | { type: "account/copyMatrixUri"; accountId: AccountId }
  | { type: "account/logout"; accountId: AccountId; confirmed?: boolean } // confirmed; also forgets the remembered capabilities
  // left bar and side panel
  | { type: "leftBar/collapse" }
  | { type: "leftBar/revealExpandButton" } // Escape, or the mouse at the left edge
  | { type: "leftBar/expand" }
  | { type: "sidePanel/toggle"; view: NonNullable<SidePanelViewModel["view"]> }
  | { type: "sidePanel/close" }
  | { type: "sidePanel/resize"; width: number }
  // rooms area
  | { type: "panel/new"; sameRoomAs?: PanelId } // Alt+N / Alt+Shift+N
  | { type: "panel/close"; panelId: PanelId } // closes its tabs (see tab/close: always-on-screen widgets keep running in the PiP panel)
  | { type: "panel/focus"; panelId: PanelId }
  | { type: "panel/resize"; panelId: PanelId; widthShare: number }
  | { type: "picker/setMode"; panelId: PanelId; mode: RoomPickerViewModel["mode"] }
  | { type: "panel/openRoom"; panelId: PanelId; roomId: RoomId; widgetKey?: WidgetKey }
  | { type: "picker/reloadRooms" } // "Try again" of the room picker's error state (`data.rooms.status === "error"`, leaf panel/error): asks the session for the rooms again
  // tabs
  | { type: "tab/new"; panelId: PanelId }
  | { type: "tab/openWidget"; panelId: PanelId; tabId?: TabId; widgetKey: WidgetKey } // already running: jumps to its tab
  | { type: "tab/moveWidgetHere"; panelId: PanelId; tabId?: TabId; widgetId: WidgetInstanceId } // "move widget here": closes its tab in the other room panel and opens it in this one; the widget keeps running
  | { type: "tab/openRoomOverview"; panelId: PanelId } // or switch to it if it is open
  | { type: "tab/activate"; panelId: PanelId; tabId: TabId } // the tab of an always-on-screen widget: takes it out of the PiP panel; the tab left behind may enter it
  | { type: "tab/move"; panelId: PanelId; tabId: TabId; toIndex: number }
  | { type: "tab/close"; panelId: PanelId; tabId: TabId } // Alt+W; stops the widget, unless it is always on screen: then it keeps running in the PiP panel (assumption, see designFeedback.md)
  // widgets
  | { type: "widget/retry"; widgetId: WidgetInstanceId }
  | { type: "widget/answerCapabilities"; widgetId: WidgetInstanceId; approved: string[] }
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
  // room overview and DevBackendView
  | { type: "room/copyToDevBackend"; roomId: RoomId; lastEvents: number }
  | { type: "mock/selectRoom"; roomId: RoomId }
  | { type: "mock/addRoom" }
  | { type: "mock/removeRoom"; roomId: RoomId }
  | { type: "mock/toggleSection"; section: DevBackendSection }
  | { type: "mock/setSendForm"; form: DevBackendViewModel["sendForm"] }
  | { type: "mock/sendState"; roomId: RoomId; event: MockedStateEvent; delayMs?: number } // also "edit state" and the shortcuts
  | { type: "mock/sendEvent"; roomId: RoomId; event: Pick<MockedTimelineEvent, "type" | "sender" | "content">; delayMs?: number }
  | { type: "mock/updateScheduled"; roomId: RoomId; delayId: string; update: "send" | "restart" | "cancel" }
  | { type: "mock/sendToDevice"; message: Omit<ToDeviceMessage, "direction"> }
  | { type: "mock/setBehavior"; roomId: RoomId; behavior: Partial<WidgetHostBehavior> }
  | { type: "mock/clearRoom"; roomId: RoomId } // drops all events of the mocked room
  | { type: "media/toggleBox" }
  | { type: "media/resizeBox"; heightShare: number }
  | { type: "media/upload"; files: File[] }
  | { type: "media/copyMxcUri"; mxcUri: string };

// ---------------------------------------------------------------------------------------------
// Data that is NOT part of AppViewModel (see the top of the file): one store per widget / per
// mocked room, subscribed to by the view that shows it.

/** What the dev tool panels of one widget show. Recorded from the start of the widget, also while the dev tools are closed. */
export interface WidgetDevToolsData {
  /** Capped (500); the log offers "clear". leaf devtools/messages */
  messages: WidgetMessage[];
  /** leaf devtools/stats */
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
  /** Characters sent over the widget API per time bucket, for the two-line graph. Not sampled while the panel is hidden. */
  characters: { timestamp: number; toWidget: number; fromWidget: number }[];
}

/** The content of the DevBackend, read from its store. leaves devbackend/* */
export interface MockedRoomData {
  rooms: { id: RoomId; name: string; avatarUrl?: string; copiedFrom?: { accountId: AccountId; roomId: RoomId } }[];
  /** The user the DevBackend acts as: the default sender of the send forms. */
  userId?: string;
  /** Of the selected room. */
  state: MockedStateEvent[];
  /** Newest first; the view virtualizes it. */
  timeline: MockedTimelineEvent[];
  /** Delayed events (state and timeline) that are scheduled but not sent yet. */
  scheduled: { delayId: string; type: string; stateKey?: string; delayMs: number; restarts: number; scheduledAt?: number }[];
  /** Account-scoped, not per room. */
  toDevice: ToDeviceMessage[];
  /** Not per room. `name` and `uploadedBy` need the store to record them. */
  media: { mxcUri: string; mimetype?: string; bytes: number; name?: string; uploadedBy?: WidgetInstanceId; /** An object URL for a preview or a download. */ url?: string }[];
}

export interface MockedStateEvent {
  type: string;
  stateKey: string;
  content: Record<string, unknown>;
}
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
