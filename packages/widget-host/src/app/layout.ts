/**
 * Pure transitions of a `WorkspaceLayout`: what an intent does to panels, tabs and the dev tools
 * layout. No effects here (starting and stopping widgets is the controller's job), so these are
 * unit tested without a browser (`test/layout.test.ts`).
 */
import {
  dockItems,
  emptyDock,
  insertAt,
  locateItem,
  MAX_HORIZONTAL,
  MAX_ROWS,
  normalize,
  removeItem,
  withinLimits,
  type DockItem,
  type DockLayout,
  type DockRow,
  type DropTarget,
} from "../dock/dockLayout";
import { allowedTargets, targetKey } from "../dock/dockTargets";
import {
  MAX_DEV_TOOL_PANELS,
  sideDock,
  type DevToolPanel,
  type PanelId,
  type RoomDevToolPanel,
  type RoomDevToolsLayout,
  type RoomId,
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
  roomsArea: { dock: emptyDock(), panels: [] },
  pip: { stacking: "horizontal", position: { x: 24, y: 24 }, boxSize: { width: 224, height: 140 } },
  devTools: {},
});

export const DEFAULT_DEV_TOOLS: WidgetDevToolsLayout = { open: false, dock: "top", panels: [], size: { top: 240, side: 360 } };

/** The panels of the room dev tools, in bar order. */
export const ROOM_DEV_TOOL_PANELS: readonly RoomDevToolPanel[] = ["state", "timeline"];
/** The room dev tools with both panels, the bar at `dock`: a room tab's start "top", the SidePanel's "left". */
export const roomDevToolsLayout = (dock: RoomDevToolsLayout["dock"]): RoomDevToolsLayout => ({ dock, panels: ROOM_DEV_TOOL_PANELS.map((panel) => ({ panel, share: 1 })) });

/** A host tab (the timeline, the room dev tools): at most one of each kind per room panel. */
const isHostTab = (tab: TabViewModel): boolean => tab.kind !== "widget";

const groupOf = (panel: RoomPanelViewModel): string | undefined => (panel.content.kind === "room" ? panel.content.roomId : undefined);

/** Every item of a dock changed by `change` (the sides and the rows keep their shape). */
function mapItems(dock: DockLayout, change: (item: DockItem) => DockItem): DockLayout {
  const out: DockLayout = { center: { ...dock.center, rows: dock.center.rows.map((r) => ({ ...r, items: r.items.map(change) })) } };
  if (dock.left) out.left = dock.left.map(change);
  if (dock.right) out.right = dock.right.map(change);
  return out;
}

/** The dock of `panels`: without the items of panels that are gone, each item's `group` the room of its panel. */
function syncDock(dock: DockLayout, panels: RoomPanelViewModel[]): DockLayout {
  const byId = new Map(panels.map((p) => [p.id, p]));
  let out = dock;
  for (const item of dockItems(dock)) if (!byId.has(item.id)) out = removeItem(out, item.id);
  return mapItems(out, (item) => {
    const group = groupOf(byId.get(item.id)!);
    if (item.group === group) return item;
    const { group: _old, ...rest } = item;
    return group === undefined ? rest : { ...rest, group };
  });
}

const withPanels = (ws: WorkspaceLayout, panels: RoomPanelViewModel[], focusedPanelId = ws.roomsArea.focusedPanelId, dock = ws.roomsArea.dock): WorkspaceLayout => ({
  ...ws,
  roomsArea: { dock: syncDock(dock, panels), panels, focusedPanelId: panels.some((p) => p.id === focusedPanelId) ? focusedPanelId : panels.at(-1)?.id },
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

/**
 * Where a new panel goes in the dock: right of `after` (below it in a side column), else at the
 * end of the last row, else in a new row at the bottom, else the first place left. `undefined`:
 * the dock is full (`isSaturated`).
 */
export function newPanelTarget(dock: DockLayout, after?: PanelId): DropTarget | undefined {
  const targets = allowedTargets(dock, {});
  const allowed = (t: DropTarget) => targets.find((a) => targetKey(a) === targetKey(t));
  const at = after === undefined ? undefined : locateItem(dock, after);
  const { rows } = dock.center;
  const last = rows.length - 1;
  const preferred: DropTarget[] = [
    ...(at ? ["row" in at ? { kind: "between" as const, row: at.row, index: at.index + 1 } : { kind: "side" as const, side: at.side, index: at.index + 1 }] : []),
    ...(last >= 0 ? [{ kind: "between" as const, row: last, index: rows[last].items.length }] : []),
    { kind: "newRow", index: rows.length },
  ];
  for (const t of preferred) {
    const found = allowed(t);
    if (found) return found;
  }
  return targets[0];
}

/** A new panel right of `after` (`newPanelTarget`), focused. `undefined`: no place is left for it. */
export function addPanel(ws: WorkspaceLayout, content: RoomPanelViewModel["content"], after?: PanelId): { ws: WorkspaceLayout; panelId: PanelId } | undefined {
  const target = newPanelTarget(ws.roomsArea.dock, after);
  if (!target) return undefined;
  const panel: RoomPanelViewModel = { id: newId("panel"), content };
  const dock = insertAt(ws.roomsArea.dock, target, { id: panel.id });
  return { ws: withPanels(ws, [...ws.roomsArea.panels, panel], panel.id, dock), panelId: panel.id };
}

/** Remove a panel; the focus goes to the panel after it on screen (or before it). */
export const removePanel = (ws: WorkspaceLayout, panelId: PanelId): WorkspaceLayout => {
  const order = dockItems(ws.roomsArea.dock).map((i) => i.id);
  const index = order.indexOf(panelId);
  const rest = order.filter((id) => id !== panelId);
  const panels = ws.roomsArea.panels.filter((p) => p.id !== panelId);
  const focused = ws.roomsArea.focusedPanelId === panelId ? rest[Math.max(0, Math.min(index, rest.length - 1))] : ws.roomsArea.focusedPanelId;
  return withPanels(ws, panels, focused);
};

/** A new arrangement of the same panels (a splitter, a panel moved to a gap). Any other set of ids, or a layout past the limits, changes nothing. */
export function arrangeDock(ws: WorkspaceLayout, dock: DockLayout): WorkspaceLayout {
  const ids = dockItems(dock).map((i) => i.id);
  const panelIds = new Set(ws.roomsArea.panels.map((p) => p.id));
  if (ids.length !== panelIds.size || new Set(ids).size !== ids.length || !ids.every((id) => panelIds.has(id)) || !withinLimits(dock)) return ws;
  return withPanels(ws, ws.roomsArea.panels, ws.roomsArea.focusedPanelId, dock);
}

/** The tabs of `tabs` that a room with `into` can take: a host tab only if it has none of its kind. */
const joinable = (into: TabViewModel[], tabs: TabViewModel[]): TabViewModel[] => {
  const kinds = new Set(into.filter(isHostTab).map((t) => t.kind));
  return tabs.filter((t) => {
    if (!isHostTab(t)) return true;
    if (kinds.has(t.kind)) return false;
    kinds.add(t.kind);
    return true;
  });
};

/**
 * A panel dropped onto a panel of the same room: its tabs join that panel's at the end (a second
 * timeline or room dev tools tab is dropped: that panel's stays), its shown tab is shown there, and
 * it goes. The widgets keep running. Another room, or itself, changes nothing.
 */
export function mergePanel(ws: WorkspaceLayout, panelId: PanelId, intoPanelId: PanelId): WorkspaceLayout {
  const from = roomOfPanel(ws, panelId);
  const into = roomOfPanel(ws, intoPanelId);
  if (!from || !into || panelId === intoPanelId || from.roomId !== into.roomId) return ws;
  const moved = joinable(into.tabs, from.tabs);
  const shown = from.tabs.find((t) => t.id === from.activeTabId);
  const activeTabId = shown === undefined ? into.activeTabId : moved.includes(shown) ? shown.id : into.tabs.find((t) => t.kind === shown.kind)?.id;
  const merged = updateRoom(ws, intoPanelId, (r) => ({ ...r, tabs: [...r.tabs, ...moved], activeTabId }));
  return focusPanel(withPanels(merged, merged.roomsArea.panels.filter((p) => p.id !== panelId)), intoPanelId);
}

/**
 * A tab dropped onto another panel of its room: it becomes that panel's shown tab, at the end. A
 * host tab (timeline, room dev tools) where that panel has one of its kind already shows that one,
 * and the dragged one is closed.
 */
export function moveTabToPanel(ws: WorkspaceLayout, panelId: PanelId, tabId: TabId, intoPanelId: PanelId): WorkspaceLayout {
  const from = roomOfPanel(ws, panelId);
  const into = roomOfPanel(ws, intoPanelId);
  const tab = from?.tabs.find((t) => t.id === tabId);
  if (!from || !into || !tab || panelId === intoPanelId || from.roomId !== into.roomId) return ws;
  const without = removeTab(ws, panelId, tabId);
  const existing = isHostTab(tab) ? into.tabs.find((t) => t.kind === tab.kind) : undefined;
  return existing ? activateTab(without, intoPanelId, existing.id) : focusPanel(putTab(without, intoPanelId, tab), intoPanelId);
}

/**
 * A tab dropped on a gap of the RoomsArea: a new panel `newPanelId` of its room with only that tab,
 * shown and focused; `dock` is the arrangement with the new panel (the DockArea's). A dock that
 * does not hold exactly the panels and the new one changes nothing.
 */
export function splitTab(ws: WorkspaceLayout, panelId: PanelId, tabId: TabId, newPanelId: PanelId, dock: DockLayout): WorkspaceLayout {
  const from = roomOfPanel(ws, panelId);
  const tab = from?.tabs.find((t) => t.id === tabId);
  if (!from || !tab || panelOf(ws, newPanelId)) return ws;
  const panel: RoomPanelViewModel = { id: newPanelId, content: { kind: "room", roomId: from.roomId, tabs: [tab], activeTabId: tab.id } };
  const without = removeTab(ws, panelId, tabId);
  const added = { ...without, roomsArea: { ...without.roomsArea, panels: [...without.roomsArea.panels, panel] } };
  const arranged = arrangeDock(added, dock);
  return arranged === added ? ws : focusPanel(arranged, newPanelId);
}

/** Add `tab` at the end of the tabs of a panel's room and make it the active tab. */
export function putTab(ws: WorkspaceLayout, panelId: PanelId, tab: TabViewModel): WorkspaceLayout {
  return updateRoom(ws, panelId, (room) => ({ ...room, tabs: [...room.tabs, tab], activeTabId: tab.id }));
}

/**
 * "Open timeline" / "Show timeline" of the RoomOverview: show the panel's Timeline tab, a new one at
 * the end if it has none (at most one per panel), and focus the panel.
 */
export const openTimelineTab = (ws: WorkspaceLayout, panelId: PanelId): WorkspaceLayout => openHostTab(ws, panelId, { kind: "timeline", id: newId("tab") });

/**
 * "Open room dev tools" / "Show room dev tools" of the RoomOverview: show the panel's room dev tools
 * tab, a new one at the end if it has none (at most one per panel; bar on top, both panels), and
 * focus the panel.
 */
export const openRoomToolsTab = (ws: WorkspaceLayout, panelId: PanelId): WorkspaceLayout => openHostTab(ws, panelId, { kind: "roomTools", id: newId("tab"), layout: roomDevToolsLayout("top") });

/** Show the panel's tab of the kind of `tab` (a host tab), else add `tab` at the end; focus the panel. */
function openHostTab(ws: WorkspaceLayout, panelId: PanelId, tab: TabViewModel): WorkspaceLayout {
  const room = roomOfPanel(ws, panelId);
  if (!room) return ws;
  const existing = room.tabs.find((t) => t.kind === tab.kind);
  return existing ? activateTab(ws, panelId, existing.id) : focusPanel(putTab(ws, panelId, tab), panelId);
}

/** Change the layout of a room dev tools tab. Another tab, or none, changes nothing. */
export function updateRoomToolsTab(ws: WorkspaceLayout, panelId: PanelId, tabId: TabId, change: (layout: RoomDevToolsLayout) => RoomDevToolsLayout): WorkspaceLayout {
  if (!roomOfPanel(ws, panelId)?.tabs.some((t) => t.id === tabId && t.kind === "roomTools")) return ws;
  return updateRoom(ws, panelId, (room) => ({ ...room, tabs: room.tabs.map((t) => (t.id === tabId && t.kind === "roomTools" ? { ...t, layout: change(t.layout) } : t)) }));
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

/** Where a pick of the Room list opens a room: a panel that shows it, the focused picker panel, or a new panel after `after`. */
export type RoomTarget = { in: "room"; panelId: PanelId } | { in: "picker"; panelId: PanelId } | { in: "new"; after?: PanelId };

/**
 * Where a pick of the Room list (SidePanel) opens a room: the panel that shows the room (the focused
 * one first), else the focused panel if it is a picker, else a new panel right of the focused one.
 */
export function roomTarget(ws: WorkspaceLayout, roomId: RoomId): RoomTarget {
  const { panels, focusedPanelId } = ws.roomsArea;
  const focused = panels.find((p) => p.id === focusedPanelId);
  const showing = [focused, ...panels].find((p) => p?.content.kind === "room" && p.content.roomId === roomId);
  if (showing) return { in: "room", panelId: showing.id };
  if (focused?.content.kind === "picker") return { in: "picker", panelId: focused.id };
  return { in: "new", after: focused?.id };
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

/**
 * A toggle of the room dev tools' bar (or the × of a panel): close the panel, or open it in bar
 * order with the shares of all open panels evened out.
 */
export function toggleRoomDevToolPanel(layout: RoomDevToolsLayout, panel: RoomDevToolPanel): RoomDevToolsLayout {
  if (layout.panels.some((p) => p.panel === panel)) return { ...layout, panels: layout.panels.filter((p) => p.panel !== panel) };
  const open = new Set([...layout.panels.map((p) => p.panel), panel]);
  return { ...layout, panels: ROOM_DEV_TOOL_PANELS.filter((p) => open.has(p)).map((p) => ({ panel: p, share: 1 })) };
}

/** The separator between the room dev tools' panels: their new shares, in panel order (a missing or invalid one keeps its share). */
export const resizeRoomDevTools = (layout: RoomDevToolsLayout, shares: number[]): RoomDevToolsLayout => ({
  ...layout,
  panels: layout.panels.map((p, i) => ({ ...p, share: isNumber(shares[i]) && shares[i] > 0 ? shares[i] : p.share })),
});

// ---------------------------------------------------------------------------------------------
// Stored layouts

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
// Records, so that tsc asks for a new dock or dev tool panel here (else stored layouts would lose it).
const DOCKS: Record<WidgetDevToolsLayout["dock"], true> = { top: true, bottom: true, left: true, right: true };
const DEV_TOOL_PANELS: Record<DevToolPanel, true> = { messages: true, stats: true, driver: true, console: true };
const isDock = (value: unknown): value is WidgetDevToolsLayout["dock"] => typeof value === "string" && Object.hasOwn(DOCKS, value);
const isDevToolPanel = (value: unknown): value is DevToolPanel => typeof value === "string" && Object.hasOwn(DEV_TOOL_PANELS, value);

/** A stored room dev tools layout; what is missing or malformed gets the default of `dock` (both panels). */
export function upgradeRoomDevToolsLayout(value: unknown, dock: RoomDevToolsLayout["dock"]): RoomDevToolsLayout {
  if (!isObject(value)) return roomDevToolsLayout(dock);
  const stored = Array.isArray(value.panels) ? value.panels : roomDevToolsLayout(dock).panels;
  const panels = ROOM_DEV_TOOL_PANELS.flatMap((panel) => {
    const p: unknown = stored.find((x) => isObject(x) && x.panel === panel);
    return isObject(p) ? [{ panel, share: positive(p.share) ?? 1 }] : [];
  });
  return { dock: isDock(value.dock) ? value.dock : dock, panels };
}

/** The ids a layout uses once: panels, tabs, and widgets (a widget runs once per account and has at most one tab). */
interface SeenIds {
  panels: Set<string>;
  tabs: Set<string>;
  widgets: Set<string>;
}

/** `hostKinds`: the kinds of host tabs the panel has already (at most one of each per panel). */
function upgradeTab(value: unknown, roomId: string, seen: SeenIds, hostKinds: ReadonlySet<string>): TabViewModel | undefined {
  if (!isObject(value) || typeof value.id !== "string" || seen.tabs.has(value.id)) return undefined;
  if (value.kind === "timeline" || value.kind === "roomTools") {
    if (hostKinds.has(value.kind)) return undefined;
    seen.tabs.add(value.id);
    return value.kind === "timeline" ? { kind: "timeline", id: value.id } : { kind: "roomTools", id: value.id, layout: upgradeRoomDevToolsLayout(value.layout, "top") };
  }
  // Older layouts also stored "native" (the room overview, now the room name) and "new" tabs.
  if (value.kind !== "widget" || typeof value.widgetId !== "string") return undefined;
  // A widget of another room, or a second tab of a widget, would break `widgetSlot` (one place per widget).
  if (!value.widgetId.startsWith(`${roomId}|`) || seen.widgets.has(value.widgetId)) return undefined;
  seen.tabs.add(value.id);
  seen.widgets.add(value.widgetId);
  return { kind: "widget", id: value.id, widgetId: value.widgetId };
}

function upgradePanel(value: unknown, seen: SeenIds): RoomPanelViewModel | undefined {
  if (!isObject(value) || typeof value.id !== "string" || seen.panels.has(value.id) || !isObject(value.content)) return undefined;
  const content = value.content;
  if (content.kind === "picker") {
    seen.panels.add(value.id);
    // Older layouts also stored the picker's `mode` (recents / all rooms).
    return { id: value.id, content: { kind: "picker" } };
  }
  if (content.kind !== "room" || typeof content.roomId !== "string") return undefined;
  seen.panels.add(value.id);
  const roomId = content.roomId;
  const tabs: TabViewModel[] = [];
  for (const t of Array.isArray(content.tabs) ? content.tabs : []) {
    const tab = upgradeTab(t, roomId, seen, new Set(tabs.filter(isHostTab).map((other) => other.kind)));
    if (tab) tabs.push(tab);
  }
  // A room without a shown tab shows its RoomOverview: so does one whose active tab was dropped.
  const activeTabId = tabs.find((t) => t.id === content.activeTabId)?.id;
  return { id: value.id, content: { kind: "room", roomId: content.roomId, tabs, activeTabId } };
}

const positive = (value: unknown): number | undefined => (isNumber(value) && value > 0 ? value : undefined);
const withShare = <T extends object>(x: T, share: number | undefined): T & { share?: number } => (share === undefined ? x : { ...x, share });

/**
 * The stored dock, as far as it is valid: items of known panels, each once. `undefined` when there
 * is none or it is past the limits.
 */
function upgradeDock(value: unknown, panelIds: ReadonlySet<string>): DockLayout | undefined {
  if (!isObject(value) || !isObject(value.center) || !Array.isArray(value.center.rows)) return undefined;
  const seen = new Set<string>();
  const items = (list: unknown): DockItem[] =>
    (Array.isArray(list) ? list : []).flatMap((i) => {
      if (!isObject(i) || typeof i.id !== "string" || !panelIds.has(i.id) || seen.has(i.id)) return [];
      seen.add(i.id);
      return [withShare({ id: i.id }, positive(i.share))];
    });
  const left = items(value.left);
  const rows: DockRow[] = value.center.rows.flatMap((r) => (isObject(r) ? [withShare({ items: items(r.items) }, positive(r.share))] : []));
  const right = items(value.right);
  const dock = normalize({ center: withShare({ rows }, positive(value.center.share)), left, right });
  return withinLimits(dock) ? dock : undefined;
}

/** Older layouts had one row of panels with a `widthShare` each: rows of up to `MAX_HORIZONTAL`, at most `MAX_ROWS` (the rest is dropped). */
function rowsDock(panels: unknown[], panelIds: ReadonlySet<string>): DockLayout {
  const items = panels.flatMap((p) => (isObject(p) && typeof p.id === "string" && panelIds.has(p.id) ? [withShare({ id: p.id }, positive(p.widthShare))] : []));
  const rows: DockRow[] = [];
  for (let i = 0; i < items.length && rows.length < MAX_ROWS; i += MAX_HORIZONTAL) rows.push({ items: items.slice(i, i + MAX_HORIZONTAL) });
  return normalize({ center: { rows } });
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
 * A stored layout (`localStorage`, any version) as the current `WorkspaceLayout`: tabs of removed
 * kinds and a second Timeline or room dev tools tab of a panel are dropped (a room whose active tab was dropped
 * shows its RoomOverview), and what is malformed (also a repeated id, a widget tab in the wrong
 * room) is left out or replaced by its default, so a broken entry never breaks the app. It
 * rebuilds the layout field by field: a new field of `WorkspaceLayout` (or of what it contains) has
 * to be read here too, else it is lost on reload. A widget whose state event is gone keeps its tab
 * here; the controller's `reconcile` decides about it once the rooms are known.
 */
export function upgradeWorkspace(stored: unknown): WorkspaceLayout {
  const empty = emptyWorkspace();
  if (!isObject(stored)) return empty;
  const roomsArea = isObject(stored.roomsArea) ? stored.roomsArea : {};
  const seen: SeenIds = { panels: new Set(), tabs: new Set(), widgets: new Set() };
  const storedPanels = Array.isArray(roomsArea.panels) ? roomsArea.panels : [];
  const allPanels = storedPanels.flatMap((p) => upgradePanel(p, seen) ?? []);
  const ids = new Set(allPanels.map((p) => p.id));
  // Panels the stored dock does not hold get a place as new panels would; those that find none are dropped.
  let dock = upgradeDock(roomsArea.dock, ids) ?? rowsDock(storedPanels, ids);
  for (const panel of allPanels) {
    if (locateItem(dock, panel.id)) continue;
    const target = newPanelTarget(dock);
    if (target) dock = insertAt(dock, target, { id: panel.id });
  }
  const placed = new Set(dockItems(dock).map((i) => i.id));
  const panels = allPanels.filter((p) => placed.has(p.id));
  const pip = isObject(stored.pip) ? stored.pip : {};
  const position = isObject(pip.position) ? pip.position : {};
  const boxSize = isObject(pip.boxSize) ? pip.boxSize : {};
  const devTools = isObject(stored.devTools) ? stored.devTools : {};
  return {
    roomsArea: { dock: syncDock(dock, panels), panels, focusedPanelId: panels.find((p) => p.id === roomsArea.focusedPanelId)?.id ?? panels.at(-1)?.id },
    pip: {
      stacking: pip.stacking === "vertical" ? "vertical" : "horizontal",
      position: { x: isNumber(position.x) ? position.x : empty.pip.position.x, y: isNumber(position.y) ? position.y : empty.pip.position.y },
      boxSize: { width: isNumber(boxSize.width) ? boxSize.width : empty.pip.boxSize.width, height: isNumber(boxSize.height) ? boxSize.height : empty.pip.boxSize.height },
    },
    devTools: Object.fromEntries(Object.entries(devTools).flatMap(([id, layout]) => (isObject(layout) ? [[id, upgradeDevTools(layout)]] : []))),
  };
}
