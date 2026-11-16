/** What survives a reload: the settings and, per Matrix account, the layout (open panels, tabs, sizes, dock positions) and the recent widgets and rooms. */
import type { AccountId, RecentRoom, RecentWidget, SettingsViewModel, WorkspaceLayout } from "../appViewModel";
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
      settings: { devTools: ui.settings?.devTools === true, theme: ui.settings?.theme ?? "system" },
      leftBarCollapsed: ui.leftBarCollapsed === true,
      sidePanelWidth: typeof ui.sidePanelWidth === "number" ? ui.sidePanelWidth : 324,
      // Stored by any earlier version: brought to the current shape, malformed parts dropped.
      workspaces: Object.fromEntries(Object.entries(isRecord(ui.workspaces) ? ui.workspaces : {}).map(([id, ws]) => [id, upgradeWorkspace(ws)])),
      recents,
      recentRooms: { ...Object.fromEntries(Object.entries(recents).map(([id, widgets]) => [id, roomsOfRecentWidgets(widgets)])), ...recentRooms },
      lastAccountId: ui.lastAccountId,
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
