/**
 * Pure transitions of a `WorkspaceLayout`: what an intent does to panels, tabs and the dev tools
 * layout. No effects here (starting and stopping widgets is the controller's job), so these are
 * unit tested without a browser (`test/layout.test.ts`).
 */
import {
  MAX_DEV_TOOL_PANELS,
  sideDock,
  type DevToolPanel,
  type PanelId,
  type RoomPanelViewModel,
  type RoomViewModel,
  type TabId,
  type TabViewModel,
  type WidgetDevToolsLayout,
  type WidgetInstanceId,
  type WorkspaceLayout,
} from "../appViewModel";

let counter = 0;
/** Ids of panels and tabs only have to be unique within the stored layout. */
export const newId = (prefix: string): string => `${prefix}-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const emptyWorkspace = (): WorkspaceLayout => ({
  roomsArea: { panels: [] },
  pip: { stacking: "horizontal", position: { x: 24, y: 24 }, boxSize: { width: 224, height: 140 } },
  devTools: {},
});

export const DEFAULT_DEV_TOOLS: WidgetDevToolsLayout = { open: false, dock: "top", panels: [], size: { top: 240, side: 360 } };

const withPanels = (ws: WorkspaceLayout, panels: RoomPanelViewModel[], focusedPanelId = ws.roomsArea.focusedPanelId): WorkspaceLayout => ({
  ...ws,
  roomsArea: { panels, focusedPanelId: panels.some((p) => p.id === focusedPanelId) ? focusedPanelId : panels.at(-1)?.id },
});

export const panelOf = (ws: WorkspaceLayout, panelId: PanelId) => ws.roomsArea.panels.find((p) => p.id === panelId);
export const roomOfPanel = (ws: WorkspaceLayout, panelId: PanelId): RoomViewModel | undefined => {
  const content = panelOf(ws, panelId)?.content;
  return content?.kind === "room" ? content : undefined;
};

export function updatePanel(ws: WorkspaceLayout, panelId: PanelId, change: (panel: RoomPanelViewModel) => RoomPanelViewModel): WorkspaceLayout {
  return withPanels(
    ws,
    ws.roomsArea.panels.map((p) => (p.id === panelId ? change(p) : p)),
  );
}

export function updateRoom(ws: WorkspaceLayout, panelId: PanelId, change: (room: RoomViewModel) => RoomViewModel): WorkspaceLayout {
  return updatePanel(ws, panelId, (p) => (p.content.kind === "room" ? { ...p, content: change(p.content) } : p));
}

export const focusPanel = (ws: WorkspaceLayout, panelId: PanelId): WorkspaceLayout => withPanels(ws, ws.roomsArea.panels, panelId);

/** A new panel on the right of `after` (or at the end), focused. */
export function addPanel(ws: WorkspaceLayout, content: RoomPanelViewModel["content"], after?: PanelId): { ws: WorkspaceLayout; panelId: PanelId } {
  const panel: RoomPanelViewModel = { id: newId("panel"), widthShare: 1, content };
  const panels = [...ws.roomsArea.panels];
  const index = after ? panels.findIndex((p) => p.id === after) : -1;
  panels.splice(index === -1 ? panels.length : index + 1, 0, panel);
  return { ws: withPanels(ws, panels, panel.id), panelId: panel.id };
}

export const removePanel = (ws: WorkspaceLayout, panelId: PanelId): WorkspaceLayout => {
  const index = ws.roomsArea.panels.findIndex((p) => p.id === panelId);
  const panels = ws.roomsArea.panels.filter((p) => p.id !== panelId);
  const focused = ws.roomsArea.focusedPanelId === panelId ? (panels[Math.min(index, panels.length - 1)]?.id ?? undefined) : ws.roomsArea.focusedPanelId;
  return withPanels(ws, panels, focused);
};

/** Add `tab` to the room of a panel (replacing `replaceTabId`, the "new tab" a widget was picked in) and make it the active tab. */
export function putTab(ws: WorkspaceLayout, panelId: PanelId, tab: TabViewModel, replaceTabId?: TabId): WorkspaceLayout {
  return updateRoom(ws, panelId, (room) => {
    const index = replaceTabId ? room.tabs.findIndex((t) => t.id === replaceTabId) : -1;
    const tabs = index === -1 ? [...room.tabs, tab] : room.tabs.map((t, i) => (i === index ? tab : t));
    return { ...room, tabs, activeTabId: tab.id };
  });
}

/** Remove a tab; the tab on its right (or left) becomes the active one. */
export function removeTab(ws: WorkspaceLayout, panelId: PanelId, tabId: TabId): WorkspaceLayout {
  return updateRoom(ws, panelId, (room) => {
    const index = room.tabs.findIndex((t) => t.id === tabId);
    if (index === -1) return room;
    const tabs = room.tabs.filter((t) => t.id !== tabId);
    const activeTabId = room.activeTabId === tabId ? tabs[Math.min(index, tabs.length - 1)]?.id : room.activeTabId;
    return { ...room, tabs, activeTabId };
  });
}

export function moveTab(ws: WorkspaceLayout, panelId: PanelId, tabId: TabId, toIndex: number): WorkspaceLayout {
  return updateRoom(ws, panelId, (room) => {
    const tab = room.tabs.find((t) => t.id === tabId);
    if (!tab) return room;
    const tabs = room.tabs.filter((t) => t.id !== tabId);
    tabs.splice(Math.max(0, Math.min(toIndex, tabs.length)), 0, tab);
    return { ...room, tabs };
  });
}

/** The tab that holds a widget, in any panel. */
export function findWidgetTab(ws: WorkspaceLayout, widgetId: WidgetInstanceId): { panelId: PanelId; tabId: TabId } | undefined {
  for (const panel of ws.roomsArea.panels) {
    if (panel.content.kind !== "room") continue;
    const tab = panel.content.tabs.find((t) => t.kind === "widget" && t.widgetId === widgetId);
    if (tab) return { panelId: panel.id, tabId: tab.id };
  }
  return undefined;
}

/** Every widget a tab of the workspace refers to. */
export function workspaceWidgetIds(ws: WorkspaceLayout): WidgetInstanceId[] {
  return ws.roomsArea.panels.flatMap((p) => (p.content.kind === "room" ? p.content.tabs.flatMap((t) => (t.kind === "widget" ? [t.widgetId] : [])) : []));
}

/** Resize a panel against its right neighbour: together they keep their share. */
export function resizePanel(ws: WorkspaceLayout, panelId: PanelId, widthShare: number): WorkspaceLayout {
  const { panels } = ws.roomsArea;
  const index = panels.findIndex((p) => p.id === panelId);
  const next = panels[index + 1];
  if (index === -1) return ws;
  if (!next) return updatePanel(ws, panelId, (p) => ({ ...p, widthShare }));
  const total = panels[index].widthShare + next.widthShare;
  const share = Math.max(0.05 * total, Math.min(widthShare, 0.95 * total));
  return withPanels(
    ws,
    panels.map((p, i) => (i === index ? { ...p, widthShare: share } : i === index + 1 ? { ...p, widthShare: total - share } : p)),
  );
}

export function updateDevTools(ws: WorkspaceLayout, widgetId: WidgetInstanceId, change: (layout: WidgetDevToolsLayout) => WidgetDevToolsLayout): WorkspaceLayout {
  return { ...ws, devTools: { ...ws.devTools, [widgetId]: change(ws.devTools[widgetId] ?? DEFAULT_DEV_TOOLS) } };
}

/** Resize the panel area (the size of the dock's orientation, `sideDock`) and / or the shares of the panels. */
export function resizeDevTools(layout: WidgetDevToolsLayout, { size, shares }: { size?: number; shares?: number[] }): WidgetDevToolsLayout {
  return {
    ...layout,
    size: size === undefined ? layout.size : { ...layout.size, [sideDock(layout.dock) ? "side" : "top"]: Math.round(size) },
    panels: shares ? layout.panels.map((p, i) => ({ ...p, share: shares[i] ?? p.share })) : layout.panels,
  };
}

/** Open or close a dev tool panel. Opening one more than `MAX_DEV_TOOL_PANELS` closes the oldest. */
export function toggleDevToolPanel(layout: WidgetDevToolsLayout, panel: DevToolPanel): WidgetDevToolsLayout {
  if (layout.panels.some((p) => p.panel === panel)) return { ...layout, panels: layout.panels.filter((p) => p.panel !== panel) };
  const panels = [...layout.panels, { panel, share: 1 }];
  return { ...layout, panels: panels.slice(Math.max(0, panels.length - MAX_DEV_TOOL_PANELS)) };
}
