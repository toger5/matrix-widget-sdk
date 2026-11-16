/**
 * The controller of the MVVM split (`src/views/README.md`): it holds the `AppViewModel` in a
 * store, turns every `AppIntent` into view model changes and effects (sessions, widgets, the
 * DevBackend, the clipboard), and feeds what comes back from the runtime (a widget became ready,
 * rooms changed) into the view model. Views only see `store`, `dispatch` and the data hooks of
 * `AppRoot`.
 */
import {
  activeAccount,
  activeWorkspace,
  approveBlockedUntil,
  loggableIntent,
  widgetInstanceId,
  type AccountDataViewModel,
  type AccountId,
  type AccountViewModel,
  type AppIntent,
  type AppViewModel,
  type CapabilityPromptViewModel,
  type DevBackendViewModel,
  type Loadable,
  type LoginViewModel,
  type MainViewModel,
  type ModalViewModel,
  type PanelId,
  type RecentRoom,
  type RecentWidget,
  type RoomId,
  type SettingsViewModel,
  type WidgetHostBehavior,
  type WidgetInstanceId,
  type WidgetInstanceViewModel,
  type WidgetKey,
  type WorkspaceLayout,
} from "../appViewModel";
import { EXAMPLE_LEGACY, EXAMPLE_NEW } from "../exampleWidgets";
import { capabilityStoreKey, clearCapabilities } from "../lib/capabilityStore";
import { DevBackend } from "../matrix_session/memory/devBackend";
import type { DevBackendSeed } from "../matrix_session/memory/seed";
import { sessions, StoredLoginInvalidError, type LiveSession, type PendingLogin, type RoomBackend, type RoomSummary, type SessionProvider } from "../session";
import { roomWidgets } from "../views/helpers";
import {
  activateTab,
  addPanel,
  emptyWorkspace,
  findWidgetTab,
  focusPanel,
  moveTab,
  newId,
  panelOf,
  putTab,
  removePanel,
  removeTab,
  resizeDevTools,
  resizePanel,
  roomOfPanel,
  roomTarget,
  toggleDevToolPanel,
  updateDevTools,
  updatePanel,
  workspaceWidgetIds,
} from "./layout";
import { loadPersisted, savePersisted, type PersistedUi } from "./persistence";
import { AccountVerification, type AccountVerificationEvents } from "./runtime/deviceVerification";
import { WidgetRuntime } from "./runtime/widgetRuntime";
import { Store } from "./store";

/** The id of the DevBackend account. */
export const DEV_ACCOUNT_ID: AccountId = "devBackend";
/** Recent widgets and recent rooms kept per account (the RoomPicker shows `RECENT_TILES` of each). */
const MAX_RECENTS = 12;
const TOAST_MS = 4000;
/** Why a running device verification ended when the DevBackend became active. */
const VERIFICATION_STOPPED = "The DevBackend was activated, which stops the verification.";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The capability prompt after the driver asked its whole open question (again): what was not in
 * the open prompt is "New" (and stays so until the answer), and "Approve" is blocked from `now`.
 */
const joinCapabilityPrompt = (open: CapabilityPromptViewModel | undefined, question: { requested: string[]; unknown: string[] }, now: number): CapabilityPromptViewModel => ({
  requested: question.requested,
  unknown: question.unknown,
  added: open ? question.requested.filter((c) => open.added.includes(c) || !open.requested.includes(c)) : [],
  lastRequestAt: now,
});

const DEFAULT_DEV_BEHAVIOR: WidgetHostBehavior = { autoApproveCapabilities: false, autoApproveOpenId: false, rememberCapabilities: false };
/** Matrix accounts: the user is asked, and the answer is remembered. */
const MATRIX_BEHAVIOR: WidgetHostBehavior = { autoApproveCapabilities: false, autoApproveOpenId: false, rememberCapabilities: true };

const defaultDevBackendVm = (): DevBackendViewModel => ({
  // "widgetHostBehavior" is a section of the Client Backend Tool: open once the tool is opened.
  openSections: ["state", "timeline", "widgetHostBehavior"],
  sendForm: "message",
  stateForm: "widget",
  tools: { open: null, heightShare: 0.5 },
  behavior: DEFAULT_DEV_BEHAVIOR,
});

/**
 * What `window.widgetHost.populate()` and the `?seed=` parameter take: the content of the
 * DevBackend plus the screen to show on it. See `e2e/seeds/*.json`.
 */
export interface HostSeed extends DevBackendSeed {
  settings?: Partial<SettingsViewModel>;
  /**
   * Room panels to open, left to right. `widgets` are `widgetKey`s (`m.widget/<state key>`) or state
   * keys; each gets a tab, and the last one is shown. `active` shows another one of them, `overview`
   * the room name (the RoomOverview); a panel without widgets shows the RoomOverview anyway.
   */
  open?: { room: RoomId; widgets?: string[]; active?: string; overview?: boolean }[];
  /** The SidePanel view; `null` closes it. Default: the DevBackendView, like after activating the DevBackend. */
  sidePanel?: "devBackend" | "settings" | "account" | "rooms" | null;
  /** WidgetHostBehavior of the DevBackend (all mocked rooms). "Fail sends" is the content field `failSends`. */
  behavior?: Partial<WidgetHostBehavior>;
  leftBarCollapsed?: boolean;
  /** How long a widget has for `notify_ready` before it counts as failed. Default: 15 s (`NOTIFY_READY_TIMEOUT_MS`). */
  notifyReadyTimeoutMs?: number;
}

export interface ControllerOptions {
  /** `false`: nothing is read from or written to `localStorage` (scripted runs). */
  persist?: boolean;
  provider?: SessionProvider;
}

export class AppController {
  readonly store: Store<AppViewModel>;

  private readonly provider: SessionProvider;
  private persist: boolean;
  private readonly sessions = new Map<AccountId, LiveSession>();
  /** The device verification of each adopted Matrix session. */
  private readonly verifications = new Map<AccountId, AccountVerification>();
  private devBackend: DevBackend | undefined;
  private readonly runtimes = new Map<WidgetInstanceId, WidgetRuntime>();
  /** Room backends of the active account, shared by the widgets of a room and released with the last one. */
  private readonly backends = new Map<RoomId, { backend: Promise<RoomBackend>; refs: number }>();
  /** Per account, newest first; persisted for Matrix accounts. */
  private readonly recentWidgets: Record<AccountId, RecentWidget[]> = {};
  private readonly recentRooms: Record<AccountId, RecentRoom[]> = {};
  private stopWatchingRooms: (() => void) | undefined;
  private pendingLogin: PendingLogin | undefined;
  private stopOAuth: (() => void) | undefined;
  private generation = 0;
  private saveQueued = false;
  /** `HostSeed.notifyReadyTimeoutMs` of the last `populate`. */
  private notifyReadyTimeoutMs: number | undefined;
  /** The OS preference, for the theme "system". Kept in a field: the listener must live as long as the controller. */
  private readonly darkScheme = globalThis.matchMedia?.("(prefers-color-scheme: dark)");
  /** The theme the running widgets were last told about (`pushTheme`). */
  private theme: "light" | "dark";

  constructor(options: ControllerOptions = {}) {
    this.provider = options.provider ?? sessions;
    this.persist = options.persist !== false;
    const persisted = this.persist ? loadPersisted() : undefined;
    Object.assign(this.recentWidgets, persisted?.recents);
    Object.assign(this.recentRooms, persisted?.recentRooms);
    this.persisted = persisted;
    this.store = new Store<AppViewModel>({ settings: { devTools: false, theme: "system", ...persisted?.settings }, screen: { kind: "restoring" } });
    this.store.subscribe(() => this.queueSave());
    this.theme = this.resolvedTheme();
    // The OS scheme matters while the setting is "system". (The AppShell listens itself for the page's `data-theme`.)
    this.darkScheme?.addEventListener("change", () => this.pushTheme());
  }

  private readonly persisted: PersistedUi | undefined;

  // -------------------------------------------------------------------------------------------
  // Reading the model

  get vm(): AppViewModel {
    return this.store.get();
  }
  private get main(): MainViewModel | undefined {
    return this.vm.screen.kind === "main" ? this.vm.screen.main : undefined;
  }
  private get workspace(): WorkspaceLayout | undefined {
    return this.main && activeWorkspace(this.main);
  }
  private get devActive(): boolean {
    return this.main?.activeAccountId === DEV_ACCOUNT_ID;
  }
  activeSession(): LiveSession | undefined {
    return this.main && this.sessions.get(this.main.activeAccountId);
  }
  getDevBackend(): DevBackend | undefined {
    return this.devBackend;
  }
  runtime(widgetId: WidgetInstanceId): WidgetRuntime | undefined {
    return this.runtimes.get(widgetId);
  }

  // -------------------------------------------------------------------------------------------
  // Writing the model

  private setMain(change: (main: MainViewModel) => MainViewModel): void {
    this.store.update((vm) => (vm.screen.kind === "main" ? { ...vm, screen: { kind: "main", main: change(vm.screen.main) } } : vm));
  }
  private setWorkspace(change: (ws: WorkspaceLayout) => WorkspaceLayout): void {
    this.setMain((m) => ({ ...m, workspaces: { ...m.workspaces, [m.activeAccountId]: change(m.workspaces[m.activeAccountId] ?? emptyWorkspace()) } }));
  }
  private setWidget(id: WidgetInstanceId, change: (widget: WidgetInstanceViewModel) => WidgetInstanceViewModel): void {
    this.setMain((m) => (m.widgets[id] ? { ...m, widgets: { ...m.widgets, [id]: change(m.widgets[id]) } } : m));
  }
  private setAccount(id: AccountId, change: (account: AccountViewModel) => AccountViewModel): void {
    this.setMain((m) => ({ ...m, accounts: m.accounts.map((a) => (a.id === id ? change(a) : a)) }));
  }
  /** The login form: the login screen, or "add account" on the main screen. */
  private setLogin(change: (login: LoginViewModel) => LoginViewModel): void {
    this.store.update((vm) => {
      if (vm.screen.kind === "login") return { ...vm, screen: { kind: "login", login: change(vm.screen.login) } };
      if (vm.screen.kind === "main" && vm.screen.main.addAccount) return { ...vm, screen: { kind: "main", main: { ...vm.screen.main, addAccount: change(vm.screen.main.addAccount) } } };
      return vm;
    });
  }
  private modal(modal: ModalViewModel | undefined): void {
    this.setMain((m) => ({ ...m, modal }));
  }
  private toast(text: string): void {
    const id = newId("toast");
    this.setMain((m) => ({ ...m, toasts: [...m.toasts, { id, text }] }));
    window.setTimeout(() => this.dispatch({ type: "toast/dismiss", id }), TOAST_MS);
  }

  private queueSave(): void {
    if (!this.persist || this.saveQueued) return;
    this.saveQueued = true;
    window.setTimeout(() => {
      this.saveQueued = false;
      const m = this.main;
      // The DevBackend's content lives in memory only, so its workspace cannot be restored after a reload.
      const workspaces = Object.fromEntries(Object.entries(m?.workspaces ?? this.persisted?.workspaces ?? {}).filter(([id]) => id !== DEV_ACCOUNT_ID));
      savePersisted({
        settings: this.vm.settings,
        leftBarCollapsed: m?.leftBar.collapsed ?? this.persisted?.leftBarCollapsed ?? false,
        sidePanelWidth: m?.sidePanel.width ?? this.persisted?.sidePanelWidth ?? 324,
        workspaces,
        recents: Object.fromEntries(Object.entries(this.recentWidgets).filter(([id]) => id !== DEV_ACCOUNT_ID)),
        recentRooms: Object.fromEntries(Object.entries(this.recentRooms).filter(([id]) => id !== DEV_ACCOUNT_ID)),
        lastAccountId: m && m.activeAccountId !== DEV_ACCOUNT_ID ? m.activeAccountId : (m?.returnAccountId ?? this.persisted?.lastAccountId),
      });
    }, 300);
  }

  // -------------------------------------------------------------------------------------------
  // Start

  /**
   * Look at the URL and at the stored logins and show the first screen. The URL parameters of
   * scripted runs (README, "Using it in end-to-end tests") start in the DevBackend:
   * `mode=memory`, `event`, `autoload`, `autoApprove`, `room`, `user`, and `seed=<url of a seed json>`.
   */
  async start(params = new URLSearchParams(location.search)): Promise<void> {
    const seedUrl = params.get("seed");
    if (seedUrl !== null || params.has("event") || params.get("autoload") === "1" || params.get("mode") === "memory") {
      this.persist = false;
      const seed = seedUrl !== null ? ((await (await fetch(seedUrl)).json()) as HostSeed) : seedFromParams(params);
      await this.populate(seed);
      return;
    }
    let stored: Awaited<ReturnType<SessionProvider["stored"]>> = [];
    try {
      stored = await this.provider.stored();
    } catch (e) {
      console.error("reading the stored logins failed", e);
    }
    if (stored.length === 0) {
      this.store.update((vm) => ({ ...vm, screen: { kind: "login", login: { homeserver: "matrix.org", busy: false } } }));
      return;
    }
    const first = stored.find((s) => s.accountId === this.persisted?.lastAccountId) ?? stored[0];
    this.showMain(
      stored.map((s) => ({ id: s.accountId, kind: "matrix", status: "restoring", userId: s.userId, homeserver: s.homeserver })),
      first.accountId,
    );
    await Promise.all(stored.map((s) => this.restore(s.accountId)));
  }

  /** Switch to the main screen with these accounts (and the DevBackend account, if dev tools are on). */
  private showMain(accounts: AccountViewModel[], activeAccountId: AccountId, extra: Partial<MainViewModel> = {}): void {
    const main: MainViewModel = {
      accounts,
      activeAccountId,
      leftBar: { collapsed: this.persisted?.leftBarCollapsed ?? false, expandButtonVisible: false },
      sidePanel: { width: this.persisted?.sidePanelWidth ?? 324 },
      workspaces: { ...this.persisted?.workspaces, [activeAccountId]: this.persisted?.workspaces?.[activeAccountId] ?? emptyWorkspace() },
      data: this.accountData(activeAccountId, { status: "loading" }),
      widgets: {},
      toasts: [],
      ...extra,
    };
    this.store.update((vm) => ({ ...vm, screen: { kind: "main", main } }));
    this.syncDevAccount();
  }

  /** The DevBackend account is listed exactly while dev tools are enabled. */
  private syncDevAccount(): void {
    const devTools = this.vm.settings.devTools;
    this.setMain((m) => {
      const listed = m.accounts.some((a) => a.id === DEV_ACCOUNT_ID);
      if (devTools === listed) return m;
      const dev: AccountViewModel = { id: DEV_ACCOUNT_ID, kind: "devBackend", status: "live", userId: this.devBackend?.userId ?? "@alice:example.org", displayName: "DevBackend", homeserver: "in-memory" };
      return { ...m, accounts: devTools ? [...m.accounts, dev] : m.accounts.filter((a) => a.id !== DEV_ACCOUNT_ID) };
    });
  }

  private async restore(accountId: AccountId): Promise<void> {
    this.setAccount(accountId, (a) => ({ ...a, status: "restoring", error: undefined }));
    try {
      const session = await this.provider.restore(accountId);
      await this.adoptSession(session);
    } catch (e) {
      console.error(`restoring ${accountId} failed`, e);
      if (e instanceof StoredLoginInvalidError) {
        // The homeserver has ended this login: there is nothing to restore and nothing to log out of.
        await this.provider.clearStored(accountId).catch(() => undefined);
        this.forgetAccount(accountId, e.message);
      } else {
        this.setAccount(accountId, (a) => ({ ...a, status: "restoreFailed", error: errorText(e) }));
      }
    }
  }

  /** A session is live: keep it, show its account, and load the rooms if it is the active one. */
  private async adoptSession(session: LiveSession): Promise<void> {
    this.sessions.set(session.accountId, session);
    const suspended = this.devActive;
    if (suspended) await session.suspend().catch((e: unknown) => console.warn("suspending failed", e));
    const base: AccountViewModel = { id: session.accountId, kind: "matrix", status: suspended ? "suspended" : "live", userId: session.userId };
    this.setMain((m) => ({
      ...m,
      accounts: m.accounts.some((a) => a.id === session.accountId) ? m.accounts.map((a) => (a.id === session.accountId ? { ...a, ...base, error: undefined } : a)) : [...m.accounts.filter((a) => a.id !== DEV_ACCOUNT_ID), base, ...m.accounts.filter((a) => a.id === DEV_ACCOUNT_ID)],
    }));
    if (this.main?.activeAccountId === session.accountId) this.watchRooms();
    void session
      .account()
      .then((info) => this.setAccount(session.accountId, (a) => ({ ...a, ...info })))
      .catch((e: unknown) => console.warn("reading the account failed", e));
    this.followVerification(session);
  }

  /**
   * From now on `verified` and `verification` of the session's account follow its
   * `AccountVerification` (a suspended session may only answer after `resume()`).
   */
  private followVerification(session: LiveSession): void {
    this.dropVerification(session.accountId);
    this.verifications.set(session.accountId, new AccountVerification(session, this.verificationEvents(session.accountId)));
  }

  /** Cancel what runs and stop following the account's session. */
  private dropVerification(accountId: AccountId): void {
    this.verifications.get(accountId)?.dispose();
    this.verifications.delete(accountId);
  }

  /** Where the `AccountVerification` of an account reports to. */
  private verificationEvents(accountId: AccountId): AccountVerificationEvents {
    return {
      changed: ({ verified, verification }) => this.setAccount(accountId, (a) => ({ ...a, verified, verification })),
      outcome: (outcome) => {
        // The AccountView shows it; elsewhere a toast says how it ended.
        const m = this.main;
        if (!m || (m.sidePanel.view === "account" && m.activeAccountId === accountId)) return;
        const account = m.accounts.find((a) => a.id === accountId);
        const name = account?.displayName || account?.userId || accountId;
        this.toast(outcome.verified ? `This device is verified for ${name}` : `Verifying this device for ${name} failed: ${outcome.error}`);
      },
    };
  }

  /** Remove an account from the app (it was logged out, or its login is gone). */
  private forgetAccount(accountId: AccountId, loginError?: string): void {
    const m = this.main;
    if (!m) return;
    const wasActive = m.activeAccountId === accountId;
    if (wasActive) this.stopAllWidgets();
    this.dropVerification(accountId);
    this.sessions.delete(accountId);
    delete this.recentWidgets[accountId];
    delete this.recentRooms[accountId];
    const accounts = m.accounts.filter((a) => a.id !== accountId);
    const next = accounts.find((a) => a.kind === "matrix");
    if (!next && !(this.devActive && !wasActive)) {
      // No account left: the login screen. The DevBackend goes with it (it is reached again with "skip login").
      this.stopAllWidgets();
      this.stopWatchingRooms?.();
      this.store.update((vm) => ({ ...vm, screen: { kind: "login", login: { homeserver: "matrix.org", busy: false, error: loginError } } }));
      return;
    }
    this.setMain((mm) => {
      const { [accountId]: _dropped, ...workspaces } = mm.workspaces;
      return { ...mm, accounts, workspaces, returnAccountId: mm.returnAccountId === accountId ? next?.id : mm.returnAccountId };
    });
    if (wasActive && next) void this.switchAccount(next.id, true);
  }

  // -------------------------------------------------------------------------------------------
  // Rooms and widgets of the active account

  /** Follow the room list of the active account's session. */
  private watchRooms(): void {
    this.stopWatchingRooms?.();
    this.stopWatchingRooms = undefined;
    const session = this.activeSession();
    const accountId = this.main?.activeAccountId;
    if (!session || !accountId) {
      this.setMain((m) => ({ ...m, data: this.accountData(m.activeAccountId, { status: "loading" }) }));
      return;
    }
    const read = () => {
      if (this.main?.activeAccountId !== accountId) return;
      let rooms: RoomSummary[];
      try {
        rooms = session.rooms();
      } catch (e) {
        this.setMain((m) => ({ ...m, data: { ...m.data, rooms: { status: "error", error: errorText(e) } } }));
        return;
      }
      this.setMain((m) => ({ ...m, data: this.accountData(accountId, { status: "ready", value: rooms }) }));
      this.reconcile();
    };
    this.stopWatchingRooms = session.onRoomsChanged(read);
    read();
  }

  /** `MainViewModel.data` of an account. */
  private accountData(accountId: AccountId, rooms: Loadable<RoomSummary[]>): AccountDataViewModel {
    return { rooms, recentWidgets: this.recentWidgets[accountId] ?? [], recentRooms: this.recentRooms[accountId] ?? [] };
  }

  private rooms(): RoomSummary[] {
    const rooms = this.main?.data.rooms;
    return rooms?.status === "ready" ? rooms.value : [];
  }

  /**
   * Bring the running widgets in line with the workspace and the rooms: start the widget of every
   * widget tab that is not running (after a restore, an account switch, or when its room arrived),
   * and close what no longer exists (a mocked room or a widget was removed).
   */
  private reconcile(): void {
    const m = this.main;
    const ws = this.workspace;
    if (!m || !ws || m.data.rooms.status !== "ready") return;
    const rooms = m.data.rooms.value;
    const known = (roomId: RoomId, key: WidgetKey) => roomWidgets(rooms.find((r) => r.id === roomId)).some((w) => w.key === key && w.widget);
    // The DevBackend's room list is complete at any time. A Matrix account's list fills while it syncs, so nothing is closed there.
    const complete = this.devActive;

    for (const panel of ws.roomsArea.panels) {
      if (panel.content.kind !== "room") continue;
      const { roomId, tabs } = panel.content;
      if (complete && !rooms.some((r) => r.id === roomId)) {
        this.closePanel(panel.id);
        continue;
      }
      for (const tab of tabs) {
        const key = tab.widgetId.slice(roomId.length + 1);
        if (m.widgets[tab.widgetId]) continue;
        if (known(roomId, key)) this.startWidget(roomId, key);
        else if (complete) this.setWorkspace((w) => removeTab(w, panel.id, tab.id));
      }
    }
    if (complete) {
      for (const widget of Object.values(this.main?.widgets ?? {})) {
        if (!known(widget.roomId, widget.widgetKey)) this.stopWidget(widget.id, true);
        // TODO-FINDING widget-url-changes-while-running - the widget's state event changed (new URL or name) while the widget runs. Nothing happens today: the running widget keeps the old URL until it is reloaded (the dev tool bar's reload button) or closed and opened again. Options: reload it at once (loses its state), or mark the tab "changed, reload?".
      }
    }
  }

  /** How the host answers the widgets of the active account. The only reader of `WidgetHostBehavior`. */
  private behavior(): WidgetHostBehavior {
    if (!this.devActive) return MATRIX_BEHAVIOR;
    return { ...DEFAULT_DEV_BEHAVIOR, ...this.main?.devBackend?.behavior };
  }

  private acquireBackend(session: LiveSession, roomId: RoomId): Promise<RoomBackend> {
    let entry = this.backends.get(roomId);
    if (!entry) {
      entry = { backend: session.backendFor(roomId), refs: 0 };
      this.backends.set(roomId, entry);
    }
    entry.refs += 1;
    return entry.backend;
  }

  private releaseBackend(roomId: RoomId): void {
    const entry = this.backends.get(roomId);
    if (!entry || --entry.refs > 0) return;
    this.backends.delete(roomId);
    void entry.backend.then((backend) => backend.dispose()).catch(() => undefined);
  }

  /** Start a widget of a room of the active account. Its tab is the caller's business. */
  private startWidget(roomId: RoomId, key: WidgetKey): boolean {
    const session = this.activeSession();
    const m = this.main;
    const found = roomWidgets(this.rooms().find((r) => r.id === roomId)).find((w) => w.key === key);
    if (!session || !m || !found?.widget) return false;
    const widget = found.widget;
    const id = widgetInstanceId(roomId, key);
    const accountId = m.activeAccountId;
    const old = m.widgets[id];
    this.setMain((mm) => ({
      ...mm,
      widgets: { ...mm.widgets, [id]: { id, roomId, widgetKey: key, widget, load: { state: "loading" }, alwaysOnScreen: old?.alwaysOnScreen ?? false, prompts: {}, generation: undefined } },
    }));
    const stillWanted = () => this.main?.activeAccountId === accountId && !!this.main.widgets[id] && !this.runtimes.has(id);
    this.acquireBackend(session, roomId).then(
      (backend) => {
        if (!stillWanted()) return this.releaseBackend(roomId);
        const behavior = () => this.behavior();
        const runtime = new WidgetRuntime({
          id,
          widget,
          backend,
          capabilityKey: behavior().rememberCapabilities ? capabilityStoreKey(session.userId, roomId, key) : undefined,
          autoApproveCapabilities: () => behavior().autoApproveCapabilities,
          autoApproveOpenId: () => behavior().autoApproveOpenId,
          theme: () => this.resolvedTheme(),
          notifyReadyTimeoutMs: this.notifyReadyTimeoutMs,
          events: {
            ready: () => this.setWidget(id, (w) => ({ ...w, load: { state: "ready" } })),
            failed: (error) => this.setWidget(id, (w) => (w.load.state === "ready" ? w : { ...w, load: { state: "failed", error } })),
            capabilitiesRequested: (question) => this.setWidget(id, (w) => ({ ...w, prompts: { ...w.prompts, capabilities: question && joinCapabilityPrompt(w.prompts.capabilities, question, Date.now()) } })),
            openIdRequested: (pending) => this.setWidget(id, (w) => ({ ...w, prompts: { ...w.prompts, openId: pending ? true : undefined } })),
            alwaysOnScreen: (value) => this.setAlwaysOnScreen(id, value),
            activity: () => this.devBackend?.refresh(id),
          },
        });
        this.runtimes.set(id, runtime);
        this.setWidget(id, (w) => ({ ...w, generation: ++this.generation }));
      },
      (e: unknown) => {
        this.releaseBackend(roomId);
        this.setWidget(id, (w) => ({ ...w, load: { state: "failed", error: errorText(e) } }));
      },
    );
    return true;
  }

  /** Stop a widget: its driver, its iframe, its backend reference. `closeTab` also removes its tab. */
  private stopWidget(id: WidgetInstanceId, closeTab: boolean): void {
    const widget = this.main?.widgets[id];
    const runtime = this.runtimes.get(id);
    if (runtime) {
      runtime.dispose();
      this.runtimes.delete(id);
      if (widget) this.releaseBackend(widget.roomId);
    }
    this.setMain((m) => {
      const { [id]: _stopped, ...widgets } = m.widgets;
      return { ...m, widgets };
    });
    const tab = closeTab && this.workspace ? findWidgetTab(this.workspace, id) : undefined;
    if (tab) this.setWorkspace((ws) => removeTab(ws, tab.panelId, tab.tabId));
  }

  private stopAllWidgets(): void {
    for (const id of Object.keys(this.main?.widgets ?? {})) this.stopWidget(id, false);
    for (const runtime of this.runtimes.values()) runtime.dispose();
    this.runtimes.clear();
    for (const roomId of [...this.backends.keys()]) {
      const entry = this.backends.get(roomId)!;
      entry.refs = 1;
      this.releaseBackend(roomId);
    }
  }

  private setAlwaysOnScreen(id: WidgetInstanceId, value: boolean): void {
    this.setWidget(id, (w) => ({ ...w, alwaysOnScreen: value }));
    // A widget without a tab only exists in the PiP panel. Once it no longer wants to be on screen there is no place to show it.
    if (!value && this.workspace && !findWidgetTab(this.workspace, id)) this.stopWidget(id, false);
  }

  /** `WidgetIframes` mounted (or unmounted) the iframe of a widget. */
  attachIframe(id: WidgetInstanceId, generation: number, iframe: HTMLIFrameElement | null): void {
    if (this.main?.widgets[id]?.generation === generation) this.runtimes.get(id)?.attach(iframe);
  }

  resolvedTheme(): "light" | "dark" {
    const { theme } = this.vm.settings;
    return theme === "system" ? (this.darkScheme?.matches ? "dark" : "light") : theme;
  }

  /**
   * Tell the running widgets when the resolved theme changed (the setting, or the OS while it is
   * "system"): `update_theme`, which the driver sends only to widgets holding `host:…update_theme`.
   * Widgets that start later ask with `get_client_context`. The iframes follow by CSS on their own
   * (docs/widget-color-scheme.md).
   */
  private pushTheme(): void {
    const theme = this.resolvedTheme();
    if (theme === this.theme) return;
    this.theme = theme;
    for (const runtime of this.runtimes.values()) runtime.updateTheme(theme);
  }

  /** A room panel opened the room, with this widget as a new tab: both become the newest recents. */
  private addRecent(roomId: RoomId, widgetKey?: WidgetKey): void {
    const accountId = this.main?.activeAccountId;
    if (!accountId) return;
    const lastOpened = Date.now();
    if (widgetKey !== undefined) this.recentWidgets[accountId] = [{ roomId, widgetKey, lastOpened }, ...(this.recentWidgets[accountId] ?? []).filter((r) => r.roomId !== roomId || r.widgetKey !== widgetKey)].slice(0, MAX_RECENTS);
    this.recentRooms[accountId] = [{ roomId, lastOpened }, ...(this.recentRooms[accountId] ?? []).filter((r) => r.roomId !== roomId)].slice(0, MAX_RECENTS);
    this.setMain((m) => (m.activeAccountId === accountId ? { ...m, data: this.accountData(accountId, m.data.rooms) } : m));
  }

  // -------------------------------------------------------------------------------------------
  // Panels and tabs

  /** Open a widget in a panel as a new tab at the end: start it, or bring its tab to the front if it already runs. */
  private openWidget(panelId: string, widgetKey: WidgetKey): void {
    const ws = this.workspace;
    const room = ws && roomOfPanel(ws, panelId);
    if (!ws || !room) return;
    const id = widgetInstanceId(room.roomId, widgetKey);
    const existing = findWidgetTab(ws, id);
    if (existing) return this.setWorkspace((w) => activateTab(w, existing.panelId, existing.tabId));
    // Not running, or running without a tab (always on screen, its panel was closed): it gets a tab here.
    if (!this.main?.widgets[id] && !this.startWidget(room.roomId, widgetKey)) return;
    this.setWorkspace((w) => focusPanel(putTab(w, panelId, { kind: "widget", id: newId("tab"), widgetId: id }), panelId));
    this.addRecent(room.roomId, widgetKey);
  }

  /**
   * Close a tab. Its widget stops, unless it is always on screen: then it keeps running in the PiP
   * panel. The neighbour is shown, and after the last tab the room name (`removeTab`).
   */
  private closeTab(panelId: string, tabId: string): void {
    const tab = this.workspace && roomOfPanel(this.workspace, panelId)?.tabs.find((t) => t.id === tabId);
    if (!tab) return;
    this.setWorkspace((ws) => removeTab(ws, panelId, tabId));
    // TODO-FINDING close-tab-of-always-on-screen-widget - closing the tab (or the room panel) of an always-on-screen widget keeps it running in the PiP panel; only the PiP close button stops it. This is the reading of designFeedback.md ("How I read four points", 4) and is not in appDesign.md. The alternative: closing the tab stops the widget like any other.
    if (!this.main?.widgets[tab.widgetId]?.alwaysOnScreen) this.stopWidget(tab.widgetId, false);
  }

  private closePanel(panelId: string): void {
    const room = this.workspace && roomOfPanel(this.workspace, panelId);
    for (const tab of room?.tabs ?? []) this.closeTab(panelId, tab.id);
    this.setWorkspace((ws) => removePanel(ws, panelId));
  }

  /**
   * A pick in the RoomPicker of a panel: the panel shows the room (on its RoomOverview, or with the
   * widget as a new tab). A widget that has a tab already is jumped to, and the panel stays as it is.
   */
  private openRoomIn(panelId: PanelId, roomId: RoomId, widgetKey?: WidgetKey): void {
    const ws = this.workspace;
    if (!ws || !panelOf(ws, panelId)) return;
    const tab = widgetKey !== undefined ? findWidgetTab(ws, widgetInstanceId(roomId, widgetKey)) : undefined;
    if (tab) return this.setWorkspace((w) => activateTab(w, tab.panelId, tab.tabId));
    const old = roomOfPanel(ws, panelId);
    if (old && old.roomId !== roomId) for (const t of old.tabs) this.closeTab(panelId, t.id);
    if (old?.roomId !== roomId) this.setWorkspace((w) => focusPanel(updatePanel(w, panelId, (p) => ({ ...p, content: { kind: "room", roomId, tabs: [] } })), panelId));
    this.addRecent(roomId);
    if (widgetKey !== undefined) this.openWidget(panelId, widgetKey);
  }

  /** A pick in the Room list of the SidePanel, in the panel `roomTarget` chooses. */
  private openRoom(roomId: RoomId, widgetKey?: WidgetKey): void {
    const ws = this.workspace ?? emptyWorkspace();
    const target = roomTarget(ws, roomId);
    if (target.in === "picker") return this.openRoomIn(target.panelId, roomId, widgetKey);
    let panelId = target.in === "room" ? target.panelId : "";
    if (target.in === "new") {
      this.setWorkspace((w) => {
        const added = addPanel(w, { kind: "room", roomId, tabs: [] }, target.after);
        panelId = added.panelId;
        return added.ws;
      });
    } else if (widgetKey === undefined) {
      this.setWorkspace((w) => activateTab(w, panelId, undefined));
    }
    // A widget that has a tab already is jumped to (`openWidget`); that is no new recent room.
    if (widgetKey === undefined || !findWidgetTab(ws, widgetInstanceId(roomId, widgetKey))) this.addRecent(roomId);
    if (widgetKey !== undefined) this.openWidget(panelId, widgetKey);
  }

  private jumpToWidget(id: WidgetInstanceId): void {
    const ws = this.workspace;
    const widget = this.main?.widgets[id];
    if (!ws || !widget) return;
    const tab = findWidgetTab(ws, id);
    if (tab) return this.setWorkspace((w) => activateTab(w, tab.panelId, tab.tabId));
    // Its room panel was closed: open the room again, on the right.
    const tabId = newId("tab");
    this.setWorkspace((w) => addPanel(w, { kind: "room", roomId: widget.roomId, tabs: [{ kind: "widget", id: tabId, widgetId: id }], activeTabId: tabId }).ws);
  }

  // -------------------------------------------------------------------------------------------
  // Accounts and the DevBackend

  private async ensureDevBackend(): Promise<DevBackend> {
    if (!this.devBackend) {
      this.devBackend = await DevBackend.fromSeed({ demoMedia: true });
      this.sessions.set(DEV_ACCOUNT_ID, this.devBackend);
    }
    return this.devBackend;
  }

  private async switchAccount(target: AccountId, confirmed: boolean): Promise<void> {
    const m = this.main;
    if (!m || m.activeAccountId === target || !m.accounts.some((a) => a.id === target)) return;
    const toDev = target === DEV_ACCOUNT_ID;
    const from = activeAccount(m);
    const panels = this.workspace?.roomsArea.panels.length ?? 0;
    if (toDev && !confirmed && panels > 0) {
      return this.modal({
        kind: "confirm",
        title: "Switch to the DevBackend?",
        body: `Your ${panels === 1 ? "room panel is" : `${panels} room panels are`} closed and ${panels === 1 ? "its" : "their"} widgets stop. They are opened again when you switch back to ${from?.displayName ?? from?.userId ?? "your account"}.`,
        confirmLabel: "Switch to the DevBackend",
        danger: false,
        intent: { type: "account/switch", accountId: target, confirmed: true },
      });
    }
    if (toDev) await this.ensureDevBackend();
    this.stopAllWidgets();
    this.setMain((mm) => ({
      ...mm,
      activeAccountId: target,
      widgets: {},
      modal: undefined,
      returnAccountId: toDev ? (from?.kind === "matrix" ? from.id : mm.returnAccountId) : mm.returnAccountId,
      sidePanel: toDev ? { ...mm.sidePanel, view: "devBackend" } : mm.sidePanel.view === "devBackend" ? { ...mm.sidePanel, view: undefined } : mm.sidePanel,
      devBackend: toDev ? (mm.devBackend ?? defaultDevBackendVm()) : mm.devBackend,
      workspaces: { ...mm.workspaces, [target]: mm.workspaces[target] ?? emptyWorkspace() },
      accounts: mm.accounts.map((a) => (a.kind === "matrix" && (a.status === "live" || a.status === "suspended") ? { ...a, status: toDev ? "suspended" : "live" } : a)),
      data: this.accountData(target, { status: "loading" }),
    }));
    // A verification needs the homeserver: it ends before the sessions are suspended.
    // TODO-FINDING verification-cancel-on-suspend - the cancel is sent by the session in the background and is likely refused by the suspension that follows at once (js: the FetchGate); the other device then sees the verification time out. Options: wait for the cancel (with a time limit) before suspending, or accept the timeout.
    if (toDev) for (const verification of this.verifications.values()) verification.stop(VERIFICATION_STOPPED);
    // "Once active, no Matrix CS API calls are made anymore."
    for (const [id, session] of this.sessions) {
      if (id === DEV_ACCOUNT_ID) continue;
      await (toDev ? session.suspend() : session.resume()).catch((e: unknown) => console.warn(`${toDev ? "suspending" : "resuming"} ${id} failed`, e));
      // What changed while it was suspended, or could not be read then.
      if (!toDev) this.verifications.get(id)?.refresh();
    }
    this.watchRooms();
  }

  private async logout(accountId: AccountId, confirmed: boolean): Promise<void> {
    const account = this.main?.accounts.find((a) => a.id === accountId);
    if (!account || account.kind !== "matrix") return;
    if (!confirmed) {
      return this.modal({
        kind: "confirm",
        title: `Log out ${account.displayName ?? account.userId}?`,
        body: "Its room panels are closed and its widgets stop. What you approved for its widgets is forgotten, and this device's encryption keys are deleted.",
        confirmLabel: "Log out",
        danger: true,
        intent: { type: "account/logout", accountId, confirmed: true },
      });
    }
    const session = this.sessions.get(accountId);
    try {
      // A running verification is cancelled while the client can still tell the other device.
      this.dropVerification(accountId);
      if (session) await session.logout();
      else await this.provider.clearStored(accountId);
      clearCapabilities(account.userId);
      this.forgetAccount(accountId);
    } catch (e) {
      if (session && this.sessions.get(accountId) === session) this.followVerification(session);
      this.toast(`Logging out failed: ${errorText(e)}`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // Login

  /** Run a step of the login form: busy while it runs, its error is shown in the form. */
  private async loginStep(work: () => Promise<void>): Promise<void> {
    this.setLogin((l) => ({ ...l, busy: true, error: undefined }));
    try {
      await work();
    } catch (e) {
      this.setLogin((l) => ({ ...l, error: errorText(e) }));
    } finally {
      this.setLogin((l) => ({ ...l, busy: false }));
    }
  }

  /** A login completed: its account becomes the active one. */
  private async loggedIn(session: LiveSession): Promise<void> {
    this.pendingLogin = undefined;
    if (this.vm.screen.kind === "login") this.showMain([], session.accountId);
    else this.setMain((m) => ({ ...m, addAccount: undefined }));
    await this.adoptSession(session);
    if (this.main && this.main.activeAccountId !== session.accountId) await this.switchAccount(session.accountId, true);
  }

  private continueLogin(homeserver: string): void {
    // The popup has to be opened inside the click, before the homeserver is looked up.
    const popup = window.open("about:blank", "widget-host-login", "width=600,height=700");
    void this.loginStep(async () => {
      this.setLogin((l) => ({ ...l, homeserver, options: undefined }));
      try {
        await this.pendingLogin?.discard().catch(() => undefined);
        const pending = (this.pendingLogin = await this.provider.startLogin(homeserver.trim()));
        this.setLogin((l) => ({ ...l, options: pending.options }));
        if (!pending.options.oauth) {
          popup?.close();
          if (!pending.options.password) throw new Error("This homeserver offers no login method this app supports.");
          return; // The form shows the password fields now.
        }
        if (!popup) throw new Error("The login popup was blocked. Allow popups for this page and try again.");
        popup.location.href = await pending.oauthUrl();
        const callbackUrl = await new Promise<string | undefined>((resolve) => {
          const onMessage = (ev: MessageEvent) => {
            if (ev.origin === location.origin && (ev.data as { type?: string } | null)?.type === "oidc-callback") done((ev.data as { callbackUrl: string }).callbackUrl);
          };
          const closedCheck = window.setInterval(() => popup.closed && done(undefined), 500);
          const done = (url: string | undefined) => {
            window.removeEventListener("message", onMessage);
            clearInterval(closedCheck);
            this.stopOAuth = undefined;
            resolve(url);
          };
          this.stopOAuth = () => done(undefined);
          window.addEventListener("message", onMessage);
        });
        if (callbackUrl === undefined) return await pending.abortOAuth();
        await this.loggedIn(await pending.completeOAuth(callbackUrl));
      } catch (e) {
        popup?.close();
        throw e;
      }
    });
  }

  // -------------------------------------------------------------------------------------------
  // Scripted start: the content of the DevBackend and the screen on it, from one JSON

  /**
   * Reset the app to the DevBackend with exactly this content and screen: every widget stops,
   * every panel closes, the mocked rooms are replaced. The fast path of the end-to-end tests.
   */
  async populate(seed: HostSeed): Promise<void> {
    this.stopOAuth?.();
    for (const verification of this.verifications.values()) verification.stop(VERIFICATION_STOPPED);
    if (this.main) this.stopAllWidgets();
    this.notifyReadyTimeoutMs = seed.notifyReadyTimeoutMs;
    this.stopWatchingRooms?.();
    // The DevBackend validates its seed strictly: hand it its own fields only.
    const content: DevBackendSeed = { userId: seed.userId, rooms: seed.rooms, media: seed.media, demoMedia: seed.demoMedia, failSends: seed.failSends };
    if (this.devBackend) await this.devBackend.populate(content);
    else {
      this.devBackend = await DevBackend.fromSeed(content);
      this.sessions.set(DEV_ACCOUNT_ID, this.devBackend);
    }
    const dev = this.devBackend;
    const rooms = dev.rooms();
    const behavior = { ...DEFAULT_DEV_BEHAVIOR, ...seed.behavior };
    // The DevBackend's recents live in memory only and start again with its content.
    delete this.recentWidgets[DEV_ACCOUNT_ID];
    delete this.recentRooms[DEV_ACCOUNT_ID];
    const matrixAccounts = (this.main?.accounts ?? []).filter((a) => a.kind === "matrix");
    // TODO-FINDING seed-dev-tools-off-in-devbackend - a seed with `settings: { devTools: false }` wins over the rule "dev tools cannot be turned off while the DevBackend is active" (`settings/set` enforces it). The result is a state no user can reach: the DevBackend account is not listed (`syncDevAccount`), so `devBackendActive` is false: no fence, no badge, no DevBackend button, although the DevBackend's rooms are shown. Options: force `devTools: true` here too, or keep it as the only way for tests to see the "dev tools disabled" views.
    this.store.update((vm) => ({ ...vm, settings: { ...vm.settings, devTools: true, ...seed.settings } }));
    this.pushTheme(); // no widget runs now; only remembers the theme
    this.showMain(matrixAccounts, DEV_ACCOUNT_ID, {
      returnAccountId: matrixAccounts[0]?.id,
      leftBar: { collapsed: seed.leftBarCollapsed === true, expandButtonVisible: false },
      sidePanel: { width: 324, view: seed.sidePanel === null ? undefined : (seed.sidePanel ?? "devBackend") },
      devBackend: { ...defaultDevBackendVm(), selectedRoomId: dev.roomIds()[0], behavior }, // the first room of the dropdown (seed order), not of the sorted room list
      workspaces: { [DEV_ACCOUNT_ID]: emptyWorkspace() },
      data: this.accountData(DEV_ACCOUNT_ID, { status: "ready", value: rooms }),
    });
    this.watchRooms();
    for (const open of seed.open ?? []) {
      const room = rooms.find((r) => r.id === open.room);
      if (!room) throw new Error(`seed.open: unknown room ${open.room}`);
      if (open.overview && open.active) throw new Error(`seed.open: room ${open.room} has both \`active\` and \`overview\`; the room name is a tab too`);
      const keyOf = (name: string) => {
        const found = roomWidgets(room).find((w) => w.key === name || w.event.state_key === name);
        if (!found) throw new Error(`seed.open: room ${open.room} has no widget ${name}`);
        return found.key;
      };
      let panelId = "";
      this.setWorkspace((ws) => {
        const added = addPanel(ws, { kind: "room", roomId: room.id, tabs: [] });
        panelId = added.panelId;
        return added.ws;
      });
      this.addRecent(room.id);
      for (const name of open.widgets ?? []) this.openWidget(panelId, keyOf(name));
      if (open.overview) this.dispatch({ type: "tab/showOverview", panelId });
      if (open.active) {
        const tab = findWidgetTab(this.workspace!, widgetInstanceId(room.id, keyOf(open.active)));
        if (tab) this.dispatch({ type: "tab/activate", panelId: tab.panelId, tabId: tab.tabId });
      }
    }
    const first = this.workspace?.roomsArea.panels[0]?.id;
    if (first) this.setWorkspace((ws) => focusPanel(ws, first));
  }

  // -------------------------------------------------------------------------------------------
  // Intents

  /** Stable, so views can use it without memoising. Never throws: a failing intent is logged and shown as a toast. */
  readonly dispatch = (intent: AppIntent): void => {
    try {
      this.handle(intent);
    } catch (e) {
      console.error("intent failed", loggableIntent(intent), e);
      this.toast(errorText(e));
    }
  };

  private handle(intent: AppIntent): void {
    const dev = this.devBackend;
    switch (intent.type) {
      // app
      case "login/continue":
        return this.continueLogin(intent.homeserver);
      case "login/withPassword":
        return void this.loginStep(async () => {
          if (!this.pendingLogin) throw new Error("Choose a homeserver first.");
          await this.loggedIn(await this.pendingLogin.withPassword(intent.username, intent.password));
        });
      case "login/skip":
        // "It allows skipping the login, which immediately ends up in the DevBackend (and enables dev tools)."
        return void this.populate({ demoMedia: true }).then(() => (this.persist = false));
      case "login/cancel":
        this.stopOAuth?.();
        void this.pendingLogin?.discard().catch(() => undefined);
        this.pendingLogin = undefined;
        return this.setMain((m) => ({ ...m, addAccount: undefined }));
      case "settings/set": {
        // Dev tools cannot be turned off while the DevBackend is active.
        const settings = { ...this.vm.settings, ...intent.settings };
        if (this.devActive) settings.devTools = true;
        this.store.update((vm) => ({ ...vm, settings }));
        this.pushTheme();
        return this.syncDevAccount();
      }
      case "modal/open":
        return this.modal(intent.modal);
      case "modal/close":
        return this.modal(undefined);
      case "toast/dismiss":
        return this.setMain((m) => ({ ...m, toasts: m.toasts.filter((t) => t.id !== intent.id) }));

      // accounts
      case "account/switch":
        return void this.switchAccount(intent.accountId, intent.confirmed === true);
      case "devBackend/toggle":
        if (!this.devActive) return void this.switchAccount(DEV_ACCOUNT_ID, false);
        // While it is active the button only opens and closes the DevBackendView; leaving is the text button at its bottom.
        return this.setMain((m) => ({ ...m, sidePanel: { ...m.sidePanel, view: m.sidePanel.view === "devBackend" ? undefined : "devBackend" } }));
      case "devBackend/leave": {
        const back = this.main?.returnAccountId ?? this.main?.accounts.find((a) => a.kind === "matrix")?.id;
        return back ? void this.switchAccount(back, true) : undefined;
      }
      case "account/add":
        return this.setMain((m) => ({ ...m, addAccount: { homeserver: "matrix.org", busy: false } }));
      case "account/retryRestore":
        return void this.restore(intent.accountId);
      case "account/manage": {
        const url = this.main?.accounts.find((a) => a.id === intent.accountId)?.manageUrl;
        if (url) window.open(url, "_blank", "noopener");
        return;
      }
      case "account/copyMatrixUri": {
        const userId = this.main?.accounts.find((a) => a.id === intent.accountId)?.userId;
        if (userId) this.copy(`matrix:u/${encodeURIComponent(userId.replace(/^@/, ""))}`, "Matrix URI copied");
        return;
      }
      case "account/logout":
        return void this.logout(intent.accountId, intent.confirmed === true);
      case "verification/startEmoji":
        // A suspended session cannot verify (its AccountView is not shown while the DevBackend is active).
        return this.devActive ? undefined : this.verifications.get(intent.accountId)?.startEmoji();
      case "verification/startRecoveryKey":
        return this.devActive ? undefined : this.verifications.get(intent.accountId)?.startRecoveryKey();
      case "verification/submitRecoveryKey":
        return this.verifications.get(intent.accountId)?.submitRecoveryKey(intent.recoveryKey);
      case "verification/answerEmoji":
        return this.verifications.get(intent.accountId)?.answerEmoji(intent.match);
      case "verification/cancel":
        return this.verifications.get(intent.accountId)?.cancel();

      // left bar and side panel
      case "leftBar/collapse":
        this.setMain((m) => ({ ...m, leftBar: { collapsed: true, expandButtonVisible: false } }));
        return this.toast("Press Esc to show the expand button");
      case "leftBar/revealExpandButton":
        return this.setMain((m) => (m.leftBar.collapsed ? { ...m, leftBar: { ...m.leftBar, expandButtonVisible: true } } : m));
      case "leftBar/expand":
        return this.setMain((m) => ({ ...m, leftBar: { collapsed: false, expandButtonVisible: false } }));
      case "sidePanel/toggle":
        if (intent.view === "devBackend" && !this.devActive) return;
        return this.setMain((m) => ({ ...m, sidePanel: { ...m.sidePanel, view: m.sidePanel.view === intent.view ? undefined : intent.view } }));
      case "sidePanel/close":
        return this.setMain((m) => ({ ...m, sidePanel: { ...m.sidePanel, view: undefined } }));
      case "sidePanel/resize":
        return this.setMain((m) => ({ ...m, sidePanel: { ...m.sidePanel, width: Math.round(intent.width) } }));

      // rooms area
      case "panel/new": {
        const ws = this.workspace;
        const same = intent.sameRoomAs && ws ? roomOfPanel(ws, intent.sameRoomAs) : undefined;
        return this.setWorkspace((w) => addPanel(w, same ? { kind: "room", roomId: same.roomId, tabs: [] } : { kind: "picker" }, intent.sameRoomAs ?? w.roomsArea.focusedPanelId).ws);
      }
      case "panel/close":
        return this.closePanel(intent.panelId);
      case "panel/focus":
        return this.setWorkspace((ws) => focusPanel(ws, intent.panelId));
      case "panel/resize":
        return this.setWorkspace((ws) => resizePanel(ws, intent.panelId, intent.widthShare));
      case "panel/openRoom":
        return this.openRoomIn(intent.panelId, intent.roomId, intent.widgetKey);
      case "room/open":
        return this.openRoom(intent.roomId, intent.widgetKey);

      // tabs
      case "tab/showOverview":
        return this.setWorkspace((ws) => activateTab(ws, intent.panelId, undefined));
      case "tab/openWidget":
        return this.openWidget(intent.panelId, intent.widgetKey);
      case "tab/moveWidgetHere": {
        const from = this.workspace && findWidgetTab(this.workspace, intent.widgetId);
        return this.setWorkspace((ws) => {
          const without = from ? removeTab(ws, from.panelId, from.tabId) : ws;
          return focusPanel(putTab(without, intent.panelId, { kind: "widget", id: newId("tab"), widgetId: intent.widgetId }), intent.panelId);
        });
      }
      case "tab/activate":
        return this.setWorkspace((ws) => activateTab(ws, intent.panelId, intent.tabId));
      case "tab/move":
        return this.setWorkspace((ws) => moveTab(ws, intent.panelId, intent.tabId, intent.toIndex));
      case "tab/close":
        return this.closeTab(intent.panelId, intent.tabId);

      // widgets
      case "widget/reload": {
        const widget = this.main?.widgets[intent.widgetId];
        if (!widget) return;
        const runtime = this.runtimes.get(intent.widgetId);
        if (runtime) {
          runtime.dispose();
          this.runtimes.delete(intent.widgetId);
          this.releaseBackend(widget.roomId);
        }
        return void this.startWidget(widget.roomId, widget.widgetKey);
      }
      case "widget/answerCapabilities": {
        const prompt = this.main?.widgets[intent.widgetId]?.prompts.capabilities;
        // "Approve" is blocked for a moment after the card appeared or a request added to it; the view shows it, this enforces it. "Deny all" is never blocked.
        if (prompt && intent.approved.length > 0 && Date.now() < approveBlockedUntil(prompt)) return;
        return this.runtimes.get(intent.widgetId)?.answerCapabilities(intent.approved, prompt?.requested);
      }
      case "widget/answerOpenId":
        return this.runtimes.get(intent.widgetId)?.answerOpenId(intent.allow);
      case "widget/jumpToTab":
        return this.jumpToWidget(intent.widgetId);
      case "widget/close": {
        const widget = this.main?.widgets[intent.widgetId];
        if (!widget) return;
        if (widget.alwaysOnScreen && !intent.confirmed) {
          return this.modal({
            kind: "confirm",
            title: `Stop ${widget.widget.name}?`,
            body: "The widget asked to stay on screen (it may be in a call). Closing it here stops it.",
            confirmLabel: "Stop the widget",
            danger: true,
            intent: { ...intent, confirmed: true },
          });
        }
        return this.stopWidget(intent.widgetId, true);
      }

      // widget dev tools
      case "devTools/toggle":
        return this.setWorkspace((ws) => updateDevTools(ws, intent.widgetId, (l) => ({ ...l, open: !l.open, panels: !l.open && l.panels.length === 0 ? [{ panel: "messages", share: 1 }] : l.panels })));
      case "devTools/dock":
        return this.setWorkspace((ws) => updateDevTools(ws, intent.widgetId, (l) => ({ ...l, dock: intent.dock })));
      case "devTools/togglePanel":
        return this.setWorkspace((ws) => updateDevTools(ws, intent.widgetId, (l) => toggleDevToolPanel(l, intent.panel)));
      case "devTools/resize":
        return this.setWorkspace((ws) => updateDevTools(ws, intent.widgetId, (l) => resizeDevTools(l, intent)));
      case "devTools/clear":
        return this.runtimes.get(intent.widgetId)?.clear(intent.what);
      case "devTools/revokeCapabilities": {
        const widget = this.main?.widgets[intent.widgetId];
        if (!widget) return;
        if (!intent.confirmed) {
          const count = intent.capabilities === "all" ? "all capabilities" : intent.capabilities.length === 1 ? "this capability" : `${intent.capabilities.length} capabilities`;
          return this.modal({
            kind: "confirm",
            title: `Revoke ${count} of ${widget.widget.name}?`,
            body: "The widget is told at once and may stop working until it asks again. What was remembered for it is forgotten.",
            confirmLabel: "Revoke",
            danger: true,
            intent: { ...intent, confirmed: true },
          });
        }
        return this.runtimes.get(intent.widgetId)?.revoke(intent.capabilities);
      }
      case "devTools/grantCapability":
        return this.runtimes.get(intent.widgetId)?.grant(intent.capability);
      case "devTools/mockHostAction":
        return this.runtimes.get(intent.widgetId)?.mockHostAction(intent.action, intent.value);

      // picture in picture
      case "pip/move":
        return this.setWorkspace((ws) => ({ ...ws, pip: { ...ws.pip, position: intent.position } }));
      case "pip/resize":
        return this.setWorkspace((ws) => ({ ...ws, pip: { ...ws.pip, boxSize: intent.boxSize } }));
      case "pip/setStacking":
        return this.setWorkspace((ws) => ({ ...ws, pip: { ...ws.pip, stacking: intent.stacking } }));

      // RoomOverview and DevBackendView
      case "room/copyToDevBackend": {
        const session = this.activeSession();
        const accountId = this.main?.activeAccountId;
        if (!session || !accountId) return;
        return void (async () => {
          try {
            const exported = await session.exportRoom(intent.roomId, intent.lastEvents);
            const backend = await this.ensureDevBackend();
            backend.importRoom(exported, { accountId, roomId: intent.roomId });
            this.toast(`“${exported.name}” was copied to the DevBackend`);
          } catch (e) {
            this.toast(`Copying to the DevBackend failed: ${errorText(e)}`);
          }
        })();
      }
      case "mock/selectRoom":
        return this.setDevVm((d) => ({ ...d, selectedRoomId: intent.roomId }));
      case "mock/addRoom": {
        if (!dev) return;
        const roomId = dev.addRoom();
        return this.setDevVm((d) => ({ ...d, selectedRoomId: roomId }));
      }
      case "mock/removeRoom":
        if (!dev) return;
        dev.removeRoom(intent.roomId);
        return this.setDevVm((d) => ({ ...d, selectedRoomId: d.selectedRoomId === intent.roomId ? dev.roomIds()[0] : d.selectedRoomId }));
      case "mock/clearRoom":
        return dev?.clearRoom(intent.roomId);
      case "mock/toggleSection":
        return this.setDevVm((d) => ({ ...d, openSections: d.openSections.includes(intent.section) ? d.openSections.filter((s) => s !== intent.section) : [...d.openSections, intent.section] }));
      case "mock/setSendForm":
        return this.setDevVm((d) => ({ ...d, sendForm: intent.form }));
      case "mock/setStateForm":
        return this.setDevVm((d) => ({ ...d, stateForm: intent.form }));
      case "mock/sendState":
        // The DevBackend refuses some edits (a malformed event, a delayed event of another sender): say so instead of an unhandled rejection.
        return void dev?.sendState(intent.roomId, intent.event, intent.delayMs).catch((e: unknown) => this.toast(`Sending the state event failed: ${errorText(e)}`));
      case "mock/sendEvent":
        return void dev?.sendEvent(intent.roomId, intent.event, intent.delayMs).catch((e: unknown) => this.toast(`Sending the event failed: ${errorText(e)}`));
      case "mock/updateScheduled":
        return void dev?.updateScheduled(intent.roomId, intent.delayId, intent.update).catch((e: unknown) => this.toast(`Updating the scheduled event failed: ${errorText(e)}`));
      case "mock/sendToDevice":
        return void dev?.sendToDevice(intent.message);
      case "mock/setBehavior": {
        this.setDevVm((d) => ({ ...d, behavior: { ...DEFAULT_DEV_BEHAVIOR, ...d.behavior, ...intent.behavior } }));
        if (intent.behavior.autoApproveOpenId === undefined) return;
        const { autoApproveOpenId } = this.behavior();
        for (const runtime of this.runtimes.values()) runtime.setOpenIdAutoApproved(autoApproveOpenId);
        return;
      }
      case "mock/setFailSends":
        return dev?.setFailSends(intent.on);
      case "mock/toggleTool":
        return this.setDevVm((d) => ({ ...d, tools: { ...d.tools, open: d.tools.open === intent.tool ? null : intent.tool } }));
      case "mock/resizeTool":
        return this.setDevVm((d) => ({ ...d, tools: { ...d.tools, heightShare: Math.max(0.15, Math.min(intent.heightShare, 0.8)) } }));
      case "media/upload":
        return void Promise.all(intent.files.map(async (file) => ({ name: file.name, mimetype: file.type || undefined, data: await file.arrayBuffer() }))).then(
          (files) => dev?.addMedia(files),
          (e: unknown) => this.toast(`Reading the file failed: ${errorText(e)}`),
        );
      case "media/copyMxcUri":
        return this.copy(intent.mxcUri, "MXC URI copied");
      case "picker/reloadRooms":
        return this.watchRooms();
      case "devTools/copyMessage": {
        const message = this.runtimes.get(intent.widgetId)?.devTools.get().messages.find((m) => m.id === intent.messageId);
        return message ? this.copy(JSON.stringify(message, null, 2), "Message copied") : undefined;
      }
      default: {
        const unhandled: never = intent;
        console.warn("unhandled intent", loggableIntent(unhandled));
      }
    }
  }

  private setDevVm(change: (devBackend: DevBackendViewModel) => DevBackendViewModel): void {
    this.setMain((m) => ({ ...m, devBackend: change(m.devBackend ?? defaultDevBackendVm()) }));
  }

  private copy(text: string, done: string): void {
    void navigator.clipboard.writeText(text).then(
      () => this.toast(done),
      () => this.toast("Copying failed: the browser did not allow access to the clipboard"),
    );
  }
}

/** The seed the URL parameters of the old in-memory mode describe: one room with the two test widgets, plus `event`. */
function seedFromParams(params: URLSearchParams): HostSeed {
  const room = params.get("room") ?? "!room:example.org";
  const widgets = [EXAMPLE_NEW, EXAMPLE_LEGACY];
  let first = `${widgets[0].type}/${widgets[0].state_key}`;
  const event = params.get("event");
  if (event !== null) {
    try {
      const parsed = JSON.parse(event) as (typeof widgets)[number];
      if (typeof parsed?.type !== "string" || typeof parsed.state_key !== "string" || typeof parsed.content !== "object" || parsed.content === null) throw new Error("a widget state event needs `type`, `state_key` and `content`");
      const index = widgets.findIndex((w) => w.type === parsed.type && w.state_key === parsed.state_key);
      if (index === -1) widgets.push(parsed);
      else widgets[index] = parsed;
      first = `${parsed.type}/${parsed.state_key}`;
    } catch (e) {
      console.error(`The ?event= parameter is not a widget state event: ${errorText(e)}`);
    }
  }
  return {
    userId: params.get("user") ?? "@alice:example.org",
    rooms: [{ id: room, name: "In-memory room", widgets }],
    demoMedia: true,
    behavior: { autoApproveCapabilities: params.get("autoApprove") === "1" },
    open: [{ room, widgets: params.get("autoload") === "1" ? [first] : [] }],
  };
}
