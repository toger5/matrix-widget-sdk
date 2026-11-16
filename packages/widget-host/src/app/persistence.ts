/** What survives a reload: the settings and, per Matrix account, the layout (open panels, tabs, sizes, dock positions), the recent widgets and rooms and the local widgets. */
import type { AccountId, RecentRoom, RecentWidget, RoomId, SettingsViewModel, WorkspaceLayout } from "../appViewModel";
import type { StateEvent } from "../widgetStateEvent";
import { upgradeWorkspace } from "./layout";

const KEY = "widget_host_ui_v1";

export interface PersistedUi {
  settings: SettingsViewModel;
  leftBarCollapsed: boolean;
  sidePanelWidth: number;
  workspaces: Record<AccountId, WorkspaceLayout>;
  /** The recent widgets. */
  recents: Record<AccountId, RecentWidget[]>;
  /** Stored since the RoomPicker shows recent rooms; for an account without an entry they are derived from its `recents`. */
  recentRooms?: Record<AccountId, RecentRoom[]>;
  /** The Matrix account that was active last. */
  lastAccountId?: AccountId;
  /** The local widgets ("Add widget", only in this host) per account and room. Deleted with the account on logout. */
  localWidgets?: Record<AccountId, Record<RoomId, StateEvent[]>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Stored recents per account: an account whose value is not a list is dropped, a malformed entry is skipped. */
function recentsOf<T>(value: unknown, entry: (e: Record<string, unknown>) => T | undefined): Record<AccountId, T[]> {
  const lists = Object.entries(isRecord(value) ? value : {}).filter((e): e is [AccountId, unknown[]] => Array.isArray(e[1]));
  return Object.fromEntries(lists.map(([id, list]) => [id, list.flatMap((e) => (isRecord(e) ? (entry(e) ?? []) : []))]));
}

const recentWidget = ({ roomId, widgetKey, lastOpened }: Record<string, unknown>): RecentWidget | undefined =>
  typeof roomId === "string" && typeof widgetKey === "string" && typeof lastOpened === "number" ? { roomId, widgetKey, lastOpened } : undefined;

const recentRoom = ({ roomId, lastOpened }: Record<string, unknown>): RecentRoom | undefined => (typeof roomId === "string" && typeof lastOpened === "number" ? { roomId, lastOpened } : undefined);

const stateEvent = (e: unknown): StateEvent | undefined =>
  isRecord(e) && typeof e.type === "string" && typeof e.state_key === "string" && isRecord(e.content) ? { type: e.type, state_key: e.state_key, content: e.content } : undefined;

/** Stored local widgets: an account or a room whose value has the wrong shape is dropped, a malformed event is skipped. */
function localWidgetsOf(value: unknown): Record<AccountId, Record<RoomId, StateEvent[]>> {
  const accounts = Object.entries(isRecord(value) ? value : {}).filter((e): e is [AccountId, Record<string, unknown>] => isRecord(e[1]));
  return Object.fromEntries(
    accounts.map(([id, rooms]) => [
      id,
      Object.fromEntries(
        Object.entries(rooms)
          .filter((e): e is [RoomId, unknown[]] => Array.isArray(e[1]))
          .map(([roomId, events]) => [roomId, events.flatMap((e) => stateEvent(e) ?? [])]),
      ),
    ]),
  );
}

/** The rooms of the recent widgets, newest first: the recent rooms of a layout stored before they were. */
function roomsOfRecentWidgets(widgets: RecentWidget[]): RecentRoom[] {
  const rooms = new Map<string, number>();
  for (const w of widgets) if (!rooms.has(w.roomId)) rooms.set(w.roomId, w.lastOpened);
  return [...rooms].map(([roomId, lastOpened]) => ({ roomId, lastOpened }));
}

export function loadPersisted(): PersistedUi | undefined {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return undefined;
    const ui = stored as Partial<PersistedUi>;
    const recents = recentsOf(ui.recents, recentWidget);
    const recentRooms = recentsOf(ui.recentRooms, recentRoom);
    return {
      // Stored before the DevBackend had its own switch: it was enabled with the dev tools.
      settings: { devTools: ui.settings?.devTools === true, devBackend: typeof ui.settings?.devBackend === "boolean" ? ui.settings.devBackend : ui.settings?.devTools === true, theme: ui.settings?.theme ?? "system" },
      leftBarCollapsed: ui.leftBarCollapsed === true,
      sidePanelWidth: typeof ui.sidePanelWidth === "number" ? ui.sidePanelWidth : 324,
      // Stored by any earlier version: brought to the current shape, malformed parts dropped.
      workspaces: Object.fromEntries(Object.entries(isRecord(ui.workspaces) ? ui.workspaces : {}).map(([id, ws]) => [id, upgradeWorkspace(ws)])),
      recents,
      recentRooms: { ...Object.fromEntries(Object.entries(recents).map(([id, widgets]) => [id, roomsOfRecentWidgets(widgets)])), ...recentRooms },
      lastAccountId: ui.lastAccountId,
      localWidgets: localWidgetsOf(ui.localWidgets),
    };
  } catch {
    return undefined;
  }
}

export function savePersisted(ui: PersistedUi): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ui));
  } catch (e) {
    console.warn("saving the layout failed", e);
  }
}
