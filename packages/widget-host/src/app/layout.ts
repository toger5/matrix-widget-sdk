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

/** Add `tab` at the end of the tabs of a panel's room and make it the active tab. */
export function putTab(ws: WorkspaceLayout, panelId: PanelId, tab: TabViewModel): WorkspaceLayout {
  return updateRoom(ws, panelId, (room) => ({ ...room, tabs: [...room.tabs, tab], activeTabId: tab.id }));
}

/**
 * Show a tab of a panel, or with `tabId` undefined its room name (the RoomOverview), and focus the
 * panel. An unknown tab changes nothing but the focus.
 */
export function activateTab(ws: WorkspaceLayout, panelId: PanelId, tabId: TabId | undefined): WorkspaceLayout {
  const room = roomOfPanel(ws, panelId);
  if (!room) return ws;
  if (tabId !== undefined && !room.tabs.some((t) => t.id === tabId)) return focusPanel(ws, panelId);
  return focusPanel(updateRoom(ws, panelId, (r) => ({ ...r, activeTabId: tabId })), panelId);
}

/** Remove a tab; the tab on its right (or left) becomes the active one, and after the last one the room name. */
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

// ---------------------------------------------------------------------------------------------
// Stored layouts

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
// Records, so that tsc asks for a new dock or dev tool panel here (else stored layouts would lose it).
const DOCKS: Record<WidgetDevToolsLayout["dock"], true> = { top: true, bottom: true, left: true, right: true };
const DEV_TOOL_PANELS: Record<DevToolPanel, true> = { messages: true, stats: true, driver: true, console: true };
const isDock = (value: unknown): value is WidgetDevToolsLayout["dock"] => typeof value === "string" && Object.hasOwn(DOCKS, value);
const isDevToolPanel = (value: unknown): value is DevToolPanel => typeof value === "string" && Object.hasOwn(DEV_TOOL_PANELS, value);

/** The ids a layout uses once: panels, tabs, and widgets (a widget runs once per account and has at most one tab). */
interface SeenIds {
  panels: Set<string>;
  tabs: Set<string>;
  widgets: Set<string>;
}

function upgradeTab(value: unknown, roomId: string, seen: SeenIds): TabViewModel | undefined {
  // Only widget tabs are left. Older layouts also stored "native" (the room overview, now the room name) and "new" tabs.
  if (!isObject(value) || value.kind !== "widget" || typeof value.id !== "string" || typeof value.widgetId !== "string") return undefined;
  // A widget of another room, or a second tab of a widget, would break `widgetSlot` (one place per widget).
  if (!value.widgetId.startsWith(`${roomId}|`) || seen.tabs.has(value.id) || seen.widgets.has(value.widgetId)) return undefined;
  seen.tabs.add(value.id);
  seen.widgets.add(value.widgetId);
  return { kind: "widget", id: value.id, widgetId: value.widgetId };
}

function upgradePanel(value: unknown, seen: SeenIds): RoomPanelViewModel | undefined {
  if (!isObject(value) || typeof value.id !== "string" || seen.panels.has(value.id) || !isObject(value.content)) return undefined;
  const widthShare = isNumber(value.widthShare) && value.widthShare > 0 ? value.widthShare : 1;
  const content = value.content;
  if (content.kind === "picker") {
    seen.panels.add(value.id);
    return { id: value.id, widthShare, content: { kind: "picker", mode: content.mode === "allRooms" ? "allRooms" : "recents" } };
  }
  if (content.kind !== "room" || typeof content.roomId !== "string") return undefined;
  seen.panels.add(value.id);
  const roomId = content.roomId;
  const tabs = (Array.isArray(content.tabs) ? content.tabs : []).flatMap((t) => upgradeTab(t, roomId, seen) ?? []);
  // A room without a shown tab shows its RoomOverview: so does one whose active tab was dropped.
  const activeTabId = tabs.find((t) => t.id === content.activeTabId)?.id;
  return { id: value.id, widthShare, content: { kind: "room", roomId: content.roomId, tabs, activeTabId } };
}

function upgradeDevTools(value: Record<string, unknown>): WidgetDevToolsLayout {
  const size = isObject(value.size) ? value.size : {};
  return {
    open: value.open === true,
    dock: isDock(value.dock) ? value.dock : DEFAULT_DEV_TOOLS.dock,
    panels: (Array.isArray(value.panels) ? value.panels : [])
      .flatMap((p) => (isObject(p) && isDevToolPanel(p.panel) ? [{ panel: p.panel, share: isNumber(p.share) && p.share > 0 ? p.share : 1 }] : []))
      .slice(-MAX_DEV_TOOL_PANELS),
    size: { top: isNumber(size.top) ? size.top : DEFAULT_DEV_TOOLS.size.top, side: isNumber(size.side) ? size.side : DEFAULT_DEV_TOOLS.size.side },
  };
}

/**
 * A stored layout (`localStorage`, any version) as the current `WorkspaceLayout`: tabs other than
 * widget tabs are dropped (a room whose active tab was dropped shows its RoomOverview), and what
 * is malformed (also a repeated id, a widget tab in the wrong room) is left out or replaced by its
 * default, so a broken entry never breaks the app. It rebuilds the layout field by field: a new
 * field of `WorkspaceLayout` (or of what it contains) has to be read here too, else it is lost on
 * reload. A widget whose state event is gone keeps its tab here; the controller's `reconcile`
 * decides about it once the rooms are known.
 */
export function upgradeWorkspace(stored: unknown): WorkspaceLayout {
  const empty = emptyWorkspace();
  if (!isObject(stored)) return empty;
  const roomsArea = isObject(stored.roomsArea) ? stored.roomsArea : {};
  const seen: SeenIds = { panels: new Set(), tabs: new Set(), widgets: new Set() };
  const panels = (Array.isArray(roomsArea.panels) ? roomsArea.panels : []).flatMap((p) => upgradePanel(p, seen) ?? []);
  const pip = isObject(stored.pip) ? stored.pip : {};
  const position = isObject(pip.position) ? pip.position : {};
  const boxSize = isObject(pip.boxSize) ? pip.boxSize : {};
  const devTools = isObject(stored.devTools) ? stored.devTools : {};
  return {
    roomsArea: { panels, focusedPanelId: panels.find((p) => p.id === roomsArea.focusedPanelId)?.id ?? panels.at(-1)?.id },
    pip: {
      stacking: pip.stacking === "vertical" ? "vertical" : "horizontal",
      position: { x: isNumber(position.x) ? position.x : empty.pip.position.x, y: isNumber(position.y) ? position.y : empty.pip.position.y },
      boxSize: { width: isNumber(boxSize.width) ? boxSize.width : empty.pip.boxSize.width, height: isNumber(boxSize.height) ? boxSize.height : empty.pip.boxSize.height },
    },
    devTools: Object.fromEntries(Object.entries(devTools).flatMap(([id, layout]) => (isObject(layout) ? [[id, upgradeDevTools(layout)]] : []))),
  };
}
