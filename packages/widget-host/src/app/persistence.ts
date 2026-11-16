/** What survives a reload: the settings and, per Matrix account, the layout (open panels, tabs, sizes, dock positions) and the recents. */
import type { AccountId, RecentWidget, SettingsViewModel, WorkspaceLayout } from "../appViewModel";

const KEY = "widget_host_ui_v1";

export interface PersistedUi {
  settings: SettingsViewModel;
  leftBarCollapsed: boolean;
  sidePanelWidth: number;
  workspaces: Record<AccountId, WorkspaceLayout>;
  recents: Record<AccountId, RecentWidget[]>;
  /** The Matrix account that was active last. */
  lastAccountId?: AccountId;
}

export function loadPersisted(): PersistedUi | undefined {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (typeof stored !== "object" || stored === null) return undefined;
    const ui = stored as Partial<PersistedUi>;
    return {
      settings: { devTools: ui.settings?.devTools === true, theme: ui.settings?.theme ?? "system" },
      leftBarCollapsed: ui.leftBarCollapsed === true,
      sidePanelWidth: typeof ui.sidePanelWidth === "number" ? ui.sidePanelWidth : 324,
      workspaces: ui.workspaces ?? {},
      recents: ui.recents ?? {},
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
