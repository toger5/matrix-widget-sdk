/** The pure layout transitions behind the panel, tab and dev tool intents. */
import { describe, expect, it } from "vitest";

import { MAX_DEV_TOOL_PANELS, panelsInOrder, type WorkspaceLayout } from "../src/appViewModel";
import { dockItems, MAX_HORIZONTAL, type DockLayout } from "../src/dock/dockLayout";
import {
  activateTab,
  addPanel,
  arrangeDock,
  DEFAULT_DEV_TOOLS,
  emptyWorkspace,
  findWidgetTab,
  focusPanel,
  mergePanel,
  moveTabToPanel,
  openRoomToolsTab,
  openTimelineTab,
  putTab,
  removePanel,
  removeTab,
  resizeDevTools,
  resizeRoomDevTools,
  roomDevToolsLayout,
  roomOfPanel,
  roomTarget,
  splitTab,
  toggleDevToolPanel,
  toggleRoomDevToolPanel,
  updatePanel,
  updateRoomToolsTab,
  upgradeWorkspace,
  workspaceWidgetIds,
} from "../src/app/layout";

const room = (roomId: string) => ({ kind: "room" as const, roomId, tabs: [] });
const picker = { kind: "picker" as const };
/** `addPanel` where there is room for the panel. */
const add = (ws: WorkspaceLayout, content: Parameters<typeof addPanel>[1], after?: string) => {
  const added = addPanel(ws, content, after);
  if (!added) throw new Error("the dock is full");
  return added;
};
const roomsOf = (ws: WorkspaceLayout) => panelsInOrder(ws.roomsArea).map((p) => (p.content.kind === "room" ? p.content.roomId : "picker"));
/** The ids of the dock: [left, rows, right]. */
const shape = (dock: DockLayout) => [dock.left?.map((i) => i.id) ?? [], dock.center.rows.map((r) => r.items.map((i) => i.id)), dock.right?.map((i) => i.id) ?? []];

describe("layout", () => {
  it("adds panels on the right of a panel and focuses them; the dock holds each panel once, its room as the group", () => {
    const a = add(emptyWorkspace(), room("!a"));
    const b = add(a.ws, room("!b"));
    const c = add(b.ws, room("!c"), a.panelId);
    expect(roomsOf(c.ws)).toEqual(["!a", "!c", "!b"]);
    expect(shape(c.ws.roomsArea.dock)).toEqual([[], [[a.panelId, c.panelId, b.panelId]], []]);
    expect(dockItems(c.ws.roomsArea.dock).map((i) => i.group)).toEqual(["!a", "!c", "!b"]);
    expect(c.ws.roomsArea.focusedPanelId).toBe(c.panelId);
    // the focus goes to the panel after the closed one on screen
    expect(removePanel(c.ws, c.panelId).roomsArea.focusedPanelId).toBe(b.panelId);
    expect(shape(removePanel(c.ws, c.panelId).roomsArea.dock)).toEqual([[], [[a.panelId, b.panelId]], []]);
  });

  it(`a full row: a new panel goes into a new row at the bottom; a full dock takes none`, () => {
    let ws = emptyWorkspace();
    for (let i = 0; i < MAX_HORIZONTAL; i++) ws = add(ws, room(`!${i}`)).ws;
    const below = add(ws, picker, ws.roomsArea.panels[0].id);
    expect(shape(below.ws.roomsArea.dock)[1].map((r) => r.length)).toEqual([MAX_HORIZONTAL, 1]);
    // three full rows
    ws = below.ws;
    while (ws.roomsArea.dock.center.rows.length < 3 || ws.roomsArea.dock.center.rows.some((r) => r.items.length < MAX_HORIZONTAL)) {
      const next = addPanel(ws, picker);
      if (!next) break;
      ws = next.ws;
    }
    expect(addPanel(ws, picker)).toBeUndefined();
  });

  it("a picker that becomes a room gets the room as its group", () => {
    const p = add(emptyWorkspace(), picker);
    expect(dockItems(p.ws.roomsArea.dock)[0].group).toBeUndefined();
    const ws = updatePanel(p.ws, p.panelId, (panel) => ({ ...panel, content: room("!a") }));
    expect(dockItems(ws.roomsArea.dock)[0].group).toBe("!a");
  });

  it("arranges the same panels anew; other ids or a layout past the limits change nothing", () => {
    const a = add(emptyWorkspace(), room("!a"));
    const b = add(a.ws, room("!b"));
    const rows: DockLayout = { center: { rows: [{ share: 2, items: [{ id: b.panelId }] }, { share: 1, items: [{ id: a.panelId }] }] } };
    const ws = arrangeDock(b.ws, rows);
    expect(shape(ws.roomsArea.dock)).toEqual([[], [[b.panelId], [a.panelId]], []]);
    expect(ws.roomsArea.dock.center.rows[0].share).toBe(2);
    expect(roomsOf(ws)).toEqual(["!b", "!a"]);
    expect(arrangeDock(b.ws, { center: { rows: [{ items: [{ id: a.panelId }] }] } })).toBe(b.ws);
    expect(arrangeDock(b.ws, { center: { rows: [{ items: [{ id: a.panelId }, { id: "x" }] }] } })).toBe(b.ws);
    expect(arrangeDock(b.ws, { center: { rows: [{ items: [{ id: a.panelId }] }, { items: [{ id: b.panelId }] }, { items: [] }, { items: [] }] } })).toBe(b.ws);
  });

  it("merges a panel into a panel of its room: its tabs at the end (no second timeline), its shown tab shown, focused", () => {
    const a = add(emptyWorkspace(), room("!a"));
    let ws = openTimelineTab(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w1" }), a.panelId);
    const b = add(ws, room("!a"));
    ws = putTab(openTimelineTab(b.ws, b.panelId), b.panelId, { kind: "widget", id: "t2", widgetId: "!a|w2" });
    const c = add(ws, room("!c"));
    expect(mergePanel(c.ws, b.panelId, c.panelId)).toBe(c.ws); // another room
    const merged = mergePanel(c.ws, b.panelId, a.panelId);
    expect(merged.roomsArea.panels.map((p) => p.id)).toEqual([a.panelId, c.panelId]);
    expect(roomOfPanel(merged, a.panelId)?.tabs.map((t) => t.id)).toEqual(["t1", roomOfPanel(c.ws, a.panelId)!.tabs[1].id, "t2"]);
    expect(roomOfPanel(merged, a.panelId)?.activeTabId).toBe("t2");
    expect(merged.roomsArea.focusedPanelId).toBe(a.panelId);
    expect(shape(merged.roomsArea.dock)).toEqual([[], [[a.panelId, c.panelId]], []]);
    // a shown timeline joins a panel that has one: that one is shown
    const timeline = activateTab(c.ws, b.panelId, roomOfPanel(c.ws, b.panelId)!.tabs[0].id);
    expect(roomOfPanel(mergePanel(timeline, b.panelId, a.panelId), a.panelId)?.activeTabId).toBe(roomOfPanel(c.ws, a.panelId)!.tabs[1].id);
  });

  it("moves a tab onto another panel of its room: shown and focused there; a timeline where one is shows that one", () => {
    const a = add(emptyWorkspace(), room("!a"));
    let ws = openTimelineTab(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w1" }), a.panelId);
    const b = add(ws, room("!a"));
    ws = openTimelineTab(b.ws, b.panelId);
    const moved = moveTabToPanel(ws, a.panelId, "t1", b.panelId);
    expect(roomOfPanel(moved, a.panelId)?.tabs.map((t) => t.kind)).toEqual(["timeline"]);
    expect(roomOfPanel(moved, b.panelId)?.tabs.map((t) => t.id)).toEqual([roomOfPanel(ws, b.panelId)!.tabs[0].id, "t1"]);
    expect(roomOfPanel(moved, b.panelId)?.activeTabId).toBe("t1");
    expect(moved.roomsArea.focusedPanelId).toBe(b.panelId);
    expect(findWidgetTab(moved, "!a|w1")).toEqual({ panelId: b.panelId, tabId: "t1" });

    const timelineA = roomOfPanel(ws, a.panelId)!.tabs[1].id;
    const timelineB = roomOfPanel(ws, b.panelId)!.tabs[0].id;
    const timeline = moveTabToPanel(ws, a.panelId, timelineA, b.panelId);
    expect(roomOfPanel(timeline, a.panelId)?.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(roomOfPanel(timeline, b.panelId)?.tabs.map((t) => t.id)).toEqual([timelineB]);
    expect(roomOfPanel(timeline, b.panelId)?.activeTabId).toBe(timelineB);
    // into itself, or a panel of another room: nothing
    expect(moveTabToPanel(ws, a.panelId, "t1", a.panelId)).toBe(ws);
    const c = add(ws, room("!c"));
    expect(moveTabToPanel(c.ws, a.panelId, "t1", c.panelId)).toBe(c.ws);
  });

  it("splits a tab off into a new panel of its room, where the dock puts it; a dock without it changes nothing", () => {
    const a = add(emptyWorkspace(), room("!a"));
    const ws = putTab(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w1" }), a.panelId, { kind: "widget", id: "t2", widgetId: "!a|w2" });
    const dock: DockLayout = { center: { rows: [{ items: [{ id: a.panelId }] }, { items: [{ id: "new" }] }] } };
    const split = splitTab(ws, a.panelId, "t2", "new", dock);
    expect(roomOfPanel(split, a.panelId)).toMatchObject({ tabs: [{ id: "t1" }], activeTabId: "t1" });
    expect(roomOfPanel(split, "new")).toEqual({ kind: "room", roomId: "!a", tabs: [{ kind: "widget", id: "t2", widgetId: "!a|w2" }], activeTabId: "t2" });
    expect(shape(split.roomsArea.dock)).toEqual([[], [[a.panelId], ["new"]], []]);
    expect(dockItems(split.roomsArea.dock).map((i) => i.group)).toEqual(["!a", "!a"]);
    expect(split.roomsArea.focusedPanelId).toBe("new");
    expect(splitTab(ws, a.panelId, "t2", "new", ws.roomsArea.dock)).toBe(ws);
    expect(splitTab(ws, a.panelId, "nope", "new", dock)).toBe(ws);
  });

  it("puts tabs at the end and shows them; closing the shown tab shows its neighbour, the last one the room name", () => {
    const { ws, panelId } = add(emptyWorkspace(), room("!a"));
    expect(roomOfPanel(ws, panelId)?.activeTabId).toBeUndefined();
    let next = putTab(ws, panelId, { kind: "widget", id: "t1", widgetId: "!a|w1" });
    next = putTab(next, panelId, { kind: "widget", id: "t2", widgetId: "!a|w2" });
    next = putTab(next, panelId, { kind: "widget", id: "t3", widgetId: "!a|w3" });
    expect(roomOfPanel(next, panelId)?.tabs.map((t) => t.id)).toEqual(["t1", "t2", "t3"]);
    expect(roomOfPanel(next, panelId)?.activeTabId).toBe("t3");
    expect(findWidgetTab(next, "!a|w2")).toEqual({ panelId, tabId: "t2" });
    expect(workspaceWidgetIds(next)).toEqual(["!a|w1", "!a|w2", "!a|w3"]);

    next = removeTab(activateTab(next, panelId, "t2"), panelId, "t2");
    expect(roomOfPanel(next, panelId)?.activeTabId).toBe("t3"); // the right neighbour
    next = removeTab(next, panelId, "t3");
    expect(roomOfPanel(next, panelId)?.activeTabId).toBe("t1"); // the left one, at the end
    // Closing a tab that is not shown keeps the room name selected.
    next = removeTab(activateTab(next, panelId, undefined), panelId, "t1");
    expect(roomOfPanel(next, panelId)).toMatchObject({ tabs: [], activeTabId: undefined });
    expect(roomOfPanel(removeTab(putTab(next, panelId, { kind: "widget", id: "t4", widgetId: "!a|w4" }), panelId, "t4"), panelId)?.activeTabId).toBeUndefined();
  });

  it("activates a tab or the room name and focuses the panel; an unknown tab only focuses", () => {
    const a = add(emptyWorkspace(), room("!a"));
    const b = add(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w" }), room("!b"));
    expect(b.ws.roomsArea.focusedPanelId).toBe(b.panelId);

    const overview = activateTab(b.ws, a.panelId, undefined);
    expect(overview.roomsArea.focusedPanelId).toBe(a.panelId);
    expect(roomOfPanel(overview, a.panelId)?.activeTabId).toBeUndefined();
    expect(roomOfPanel(activateTab(overview, a.panelId, "t1"), a.panelId)?.activeTabId).toBe("t1");

    const unknown = activateTab(overview, a.panelId, "nope");
    expect(roomOfPanel(unknown, a.panelId)?.activeTabId).toBeUndefined();
    expect(activateTab(b.ws, a.panelId, "nope").roomsArea.focusedPanelId).toBe(a.panelId);
  });

  it("opens the Timeline tab at the end of a panel, at most one per panel: a second open shows it; it is no widget tab", () => {
    const a = add(emptyWorkspace(), room("!a"));
    const b = add(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w" }), room("!a"));
    let ws = openTimelineTab(b.ws, a.panelId);
    const tabs = roomOfPanel(ws, a.panelId)!.tabs;
    expect(tabs.map((t) => t.kind)).toEqual(["widget", "timeline"]);
    expect(roomOfPanel(ws, a.panelId)?.activeTabId).toBe(tabs[1].id);
    expect(ws.roomsArea.focusedPanelId).toBe(a.panelId);
    expect(workspaceWidgetIds(ws)).toEqual(["!a|w"]);

    ws = openTimelineTab(activateTab(ws, a.panelId, "t1"), a.panelId);
    expect(roomOfPanel(ws, a.panelId)?.tabs).toEqual(tabs);
    expect(roomOfPanel(ws, a.panelId)?.activeTabId).toBe(tabs[1].id);
    // The other panel of the same room gets its own.
    ws = openTimelineTab(ws, b.panelId);
    expect(roomOfPanel(ws, b.panelId)?.tabs.map((t) => t.kind)).toEqual(["timeline"]);
    expect(roomOfPanel(ws, b.panelId)?.tabs[0].id).not.toBe(tabs[1].id);
    // A picker panel has no room: nothing happens.
    const p = add(ws, picker);
    expect(openTimelineTab(p.ws, p.panelId)).toBe(p.ws);
    // Closing it shows its neighbour, like any tab.
    expect(roomOfPanel(removeTab(ws, a.panelId, tabs[1].id), a.panelId)?.activeTabId).toBe("t1");
  });

  it("opens the room dev tools tab at the end of a panel, at most one per panel, bar on top with both panels; a second open shows it", () => {
    const a = add(emptyWorkspace(), room("!a"));
    let ws = openTimelineTab(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w" }), a.panelId);
    ws = openRoomToolsTab(ws, a.panelId);
    const tabs = roomOfPanel(ws, a.panelId)!.tabs;
    expect(tabs.map((t) => t.kind)).toEqual(["widget", "timeline", "roomTools"]);
    expect(tabs[2]).toMatchObject({ layout: { dock: "top", panels: [{ panel: "state", share: 1 }, { panel: "timeline", share: 1 }] } });
    expect(roomOfPanel(ws, a.panelId)?.activeTabId).toBe(tabs[2].id);
    expect(workspaceWidgetIds(ws)).toEqual(["!a|w"]);
    ws = openRoomToolsTab(activateTab(ws, a.panelId, "t1"), a.panelId);
    expect(roomOfPanel(ws, a.panelId)?.tabs).toEqual(tabs);
    expect(roomOfPanel(ws, a.panelId)?.activeTabId).toBe(tabs[2].id);
    const p = add(ws, picker);
    expect(openRoomToolsTab(p.ws, p.panelId)).toBe(p.ws);
  });

  it("changes the layout of a room dev tools tab: toggle (bar order, shares evened out), dock, resize; another tab changes nothing", () => {
    const a = add(emptyWorkspace(), room("!a"));
    const ws = openRoomToolsTab(openTimelineTab(a.ws, a.panelId), a.panelId);
    const [timeline, tools] = roomOfPanel(ws, a.panelId)!.tabs;
    const layoutOf = (w: WorkspaceLayout) => roomOfPanel(w, a.panelId)!.tabs.find((t) => t.id === tools.id);
    const docked = updateRoomToolsTab(ws, a.panelId, tools.id, (l) => ({ ...l, dock: "left" }));
    expect(layoutOf(docked)).toMatchObject({ layout: { dock: "left" } });
    expect(updateRoomToolsTab(ws, a.panelId, timeline.id, (l) => ({ ...l, dock: "left" }))).toBe(ws);

    let layout = resizeRoomDevTools(roomDevToolsLayout("top"), [1.5, 0.5]);
    expect(layout.panels).toEqual([{ panel: "state", share: 1.5 }, { panel: "timeline", share: 0.5 }]);
    expect(resizeRoomDevTools(layout, [Number.NaN, -1]).panels).toEqual(layout.panels);
    layout = toggleRoomDevToolPanel(layout, "state");
    expect(layout.panels).toEqual([{ panel: "timeline", share: 0.5 }]);
    layout = toggleRoomDevToolPanel(layout, "state");
    expect(layout).toEqual(roomDevToolsLayout("top"));
    expect(toggleRoomDevToolPanel(toggleRoomDevToolPanel(layout, "timeline"), "state").panels).toEqual([]);
  });

  it("keeps one room dev tools tab per panel when a tab or a panel joins one that has it", () => {
    const a = add(emptyWorkspace(), room("!a"));
    let ws = openRoomToolsTab(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w1" }), a.panelId);
    const b = add(ws, room("!a"));
    ws = openRoomToolsTab(b.ws, b.panelId);
    const toolsA = roomOfPanel(ws, a.panelId)!.tabs[1].id;
    const toolsB = roomOfPanel(ws, b.panelId)!.tabs[0].id;
    const moved = moveTabToPanel(ws, a.panelId, toolsA, b.panelId);
    expect(roomOfPanel(moved, a.panelId)?.tabs.map((t) => t.id)).toEqual(["t1"]);
    expect(roomOfPanel(moved, b.panelId)?.tabs.map((t) => t.id)).toEqual([toolsB]);
    expect(roomOfPanel(moved, b.panelId)?.activeTabId).toBe(toolsB);
    const merged = mergePanel(ws, a.panelId, b.panelId);
    expect(roomOfPanel(merged, b.panelId)?.tabs.map((t) => t.id)).toEqual([toolsB, "t1"]);
    // the shown room dev tools of the merged panel: that panel's are shown
    expect(roomOfPanel(merged, b.panelId)?.activeTabId).toBe(toolsB);
  });

  it("upgrades a stored layout: only widget tabs are kept, a dropped active tab leaves the room name selected", () => {
    const stored = {
      roomsArea: {
        panels: [
          {
            id: "p1",
            widthShare: 1.5,
            content: {
              kind: "room",
              roomId: "!a",
              tabs: [
                { kind: "widget", id: "t1", widgetId: "!a|w" },
                { kind: "native", id: "t2", view: "roomOverview" },
                { kind: "new", id: "t3" },
              ],
              activeTabId: "t2",
            },
          },
          { id: "p2", widthShare: 1, content: { kind: "room", roomId: "!b", tabs: [{ kind: "widget", id: "t4", widgetId: "!b|w" }, { kind: "new", id: "t5" }], activeTabId: "t4" } },
          // the picker's `mode` of older layouts is dropped
          { id: "p3", widthShare: 1, content: { kind: "picker", mode: "allRooms" } },
        ],
        focusedPanelId: "p2",
      },
      pip: { stacking: "vertical", position: { x: 10, y: 20 }, boxSize: { width: 300, height: 200 } },
      devTools: { "!a|w": { open: true, dock: "left", panels: [{ panel: "stats", share: 1 }], size: { top: 200, side: 300 } } },
    };
    const ws = upgradeWorkspace(JSON.parse(JSON.stringify(stored)));
    expect(ws.roomsArea.panels.map((p) => p.content)).toEqual([
      { kind: "room", roomId: "!a", tabs: [{ kind: "widget", id: "t1", widgetId: "!a|w" }], activeTabId: undefined },
      { kind: "room", roomId: "!b", tabs: [{ kind: "widget", id: "t4", widgetId: "!b|w" }], activeTabId: "t4" },
      { kind: "picker" },
    ]);
    // the panels of an older layout in one row, with their widths
    expect(ws.roomsArea.dock).toEqual({ center: { rows: [{ items: [{ id: "p1", share: 1.5, group: "!a" }, { id: "p2", share: 1, group: "!b" }, { id: "p3", share: 1 }] }] } });
    expect(ws.roomsArea.focusedPanelId).toBe("p2");
    expect(ws.pip).toEqual(stored.pip);
    expect(ws.devTools).toEqual(stored.devTools);
    // A current layout comes back unchanged.
    expect(upgradeWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

  it("upgrades a stored layout with Timeline tabs: one per panel, in its place", () => {
    const ws = upgradeWorkspace({
      roomsArea: {
        panels: [
          {
            id: "p1",
            widthShare: 1,
            content: { kind: "room", roomId: "!a", tabs: [{ kind: "timeline", id: "t1" }, { kind: "widget", id: "t2", widgetId: "!a|w" }, { kind: "timeline", id: "t3" }, { kind: "timeline" }], activeTabId: "t3" },
          },
          { id: "p2", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [{ kind: "timeline", id: "t1" }, { kind: "timeline", id: "t4" }], activeTabId: "t4" } },
        ],
      },
    });
    expect(ws.roomsArea.panels.map((p) => p.content)).toEqual([
      { kind: "room", roomId: "!a", tabs: [{ kind: "timeline", id: "t1" }, { kind: "widget", id: "t2", widgetId: "!a|w" }], activeTabId: undefined },
      // "t1" is taken by the first panel: its second Timeline tab is the one that is kept.
      { kind: "room", roomId: "!a", tabs: [{ kind: "timeline", id: "t4" }], activeTabId: "t4" },
    ]);
    expect(upgradeWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

  it("upgrades a stored layout with room dev tools tabs: one per panel, with its layout (defaults for what is missing or malformed)", () => {
    const ws = upgradeWorkspace({
      roomsArea: {
        panels: [
          {
            id: "p1",
            widthShare: 1,
            content: {
              kind: "room",
              roomId: "!a",
              tabs: [
                { kind: "roomTools", id: "t1", layout: { dock: "left", panels: [{ panel: "timeline", share: 2 }, { panel: "nope", share: 1 }] } },
                { kind: "timeline", id: "t2" },
                { kind: "roomTools", id: "t3" },
              ],
              activeTabId: "t1",
            },
          },
          { id: "p2", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [{ kind: "roomTools", id: "t4", layout: { dock: "sideways", panels: "x" } }] } },
        ],
      },
    });
    expect(ws.roomsArea.panels.map((p) => p.content)).toEqual([
      { kind: "room", roomId: "!a", tabs: [{ kind: "roomTools", id: "t1", layout: { dock: "left", panels: [{ panel: "timeline", share: 2 }] } }, { kind: "timeline", id: "t2" }], activeTabId: "t1" },
      { kind: "room", roomId: "!a", tabs: [{ kind: "roomTools", id: "t4", layout: roomDevToolsLayout("top") }], activeTabId: undefined },
    ]);
    expect(upgradeWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);
  });

  it("upgrades malformed stored layouts without throwing", () => {
    for (const stored of [undefined, null, 42, "x", [], {}, { roomsArea: null }, { roomsArea: { panels: "x" } }]) {
      expect(upgradeWorkspace(stored)).toEqual(emptyWorkspace());
    }
    const ws = upgradeWorkspace({
      roomsArea: {
        panels: [null, { id: 1 }, { id: "p0", content: { kind: "room" } }, { id: "p1", widthShare: -2, content: { kind: "room", roomId: "!a", tabs: [null, { kind: "widget", id: "t1" }, { kind: "widget", id: "t2", widgetId: "!a|w" }], activeTabId: 7 } }, { id: "p2", content: { kind: "unknown" } }],
        focusedPanelId: "gone",
      },
      pip: { stacking: "diagonal", position: "x", boxSize: { width: "wide", height: 90 } },
      devTools: { "!a|w": { dock: "nowhere", panels: [{ panel: "bogus" }, { panel: "console", share: 0 }], size: null }, "!b|w": 3 },
    });
    expect(ws.roomsArea).toEqual({ dock: { center: { rows: [{ items: [{ id: "p1", group: "!a" }] }] } }, panels: [{ id: "p1", content: { kind: "room", roomId: "!a", tabs: [{ kind: "widget", id: "t2", widgetId: "!a|w" }], activeTabId: undefined } }], focusedPanelId: "p1" });
    expect(ws.pip).toEqual({ ...emptyWorkspace().pip, boxSize: { width: emptyWorkspace().pip.boxSize.width, height: 90 } });
    expect(ws.devTools).toEqual({ "!a|w": { ...DEFAULT_DEV_TOOLS, panels: [{ panel: "console", share: 1 }] } });
  });

  it("upgrades a stored layout with repeated ids: a panel, a tab and a widget are kept once, a widget tab only in its own room", () => {
    const tab = (id: string, widgetId: string) => ({ kind: "widget", id, widgetId });
    const ws = upgradeWorkspace({
      roomsArea: {
        panels: [
          { id: "p1", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [tab("t1", "!a|w"), tab("t2", "!b|w"), tab("t1", "!a|v")], activeTabId: "t2" } },
          { id: "p1", widthShare: 1, content: { kind: "picker" } },
          { id: "p2", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [tab("t3", "!a|w"), tab("t4", "!a|v")], activeTabId: "t4" } },
        ],
        focusedPanelId: "p1",
      },
    });
    expect(ws.roomsArea.panels).toEqual([
      { id: "p1", content: { kind: "room", roomId: "!a", tabs: [tab("t1", "!a|w")], activeTabId: undefined } },
      { id: "p2", content: { kind: "room", roomId: "!a", tabs: [tab("t4", "!a|v")], activeTabId: "t4" } },
    ]);
    expect(workspaceWidgetIds(ws)).toEqual(["!a|w", "!a|v"]);
  });

  it("a pick of the Room list opens in the panel showing the room (focused first), else in the focused picker, else in a new panel right of the focused one", () => {
    const a = add(emptyWorkspace(), room("!a"));
    const p = add(a.ws, picker);
    const b = add(p.ws, room("!b"));
    const a2 = add(b.ws, room("!a"));
    // !a is shown twice: the focused one wins, else the first from the left
    expect(roomTarget(a2.ws, "!a")).toEqual({ in: "room", panelId: a2.panelId });
    expect(roomTarget(focusPanel(a2.ws, b.panelId), "!a")).toEqual({ in: "room", panelId: a.panelId });
    // a room no panel shows: the focused picker, else a new panel next to the focused one
    expect(roomTarget(focusPanel(a2.ws, p.panelId), "!c")).toEqual({ in: "picker", panelId: p.panelId });
    expect(roomTarget(a2.ws, "!c")).toEqual({ in: "new", after: a2.panelId });
    expect(roomTarget(emptyWorkspace(), "!c")).toEqual({ in: "new", after: undefined });
  });

  it("upgrades a stored dock: unknown and repeated ids are dropped, panels it misses get a place; one past the limits is rebuilt as rows", () => {
    const panel = (id: string, roomId: string) => ({ id, content: { kind: "room", roomId, tabs: [] } });
    const panels = [panel("p1", "!a"), panel("p2", "!b"), panel("p3", "!c"), panel("p4", "!d")];
    const ws = upgradeWorkspace({
      roomsArea: {
        dock: {
          center: { share: 2, rows: [{ share: 3, items: [{ id: "p1", share: 2 }, { id: "gone" }, { id: "p1" }] }, { items: [{ id: "p2" }] }, null] },
          right: [{ id: "p3", share: 0.5, group: "!wrong" }],
        },
        panels,
      },
    });
    expect(shape(ws.roomsArea.dock)).toEqual([[], [["p1"], ["p2", "p4"]], ["p3"]]);
    expect(ws.roomsArea.dock.right).toEqual([{ id: "p3", share: 0.5, group: "!c" }]);
    expect(upgradeWorkspace(JSON.parse(JSON.stringify(ws)))).toEqual(ws);

    const many = Array.from({ length: 20 }, (_, i) => ({ ...panel(`p${i}`, `!${i}`), widthShare: 1 }));
    const tooMany = upgradeWorkspace({ roomsArea: { dock: { center: { rows: [{ items: many.map((p) => ({ id: p.id })) }] } }, panels: many } });
    expect(tooMany.roomsArea.dock.center.rows.map((r) => r.items.length)).toEqual([MAX_HORIZONTAL, MAX_HORIZONTAL, MAX_HORIZONTAL]);
    expect(tooMany.roomsArea.panels).toHaveLength(3 * MAX_HORIZONTAL);
  });

  it("closes the oldest dev tool panel when one more than the maximum opens", () => {
    let layout = DEFAULT_DEV_TOOLS;
    for (const panel of ["messages", "stats", "driver", "console"] as const) layout = toggleDevToolPanel(layout, panel);
    expect(layout.panels.map((p) => p.panel)).toEqual(["stats", "driver", "console"]);
    expect(layout.panels).toHaveLength(MAX_DEV_TOOL_PANELS);
    expect(toggleDevToolPanel(layout, "driver").panels.map((p) => p.panel)).toEqual(["stats", "console"]);
  });

  it("resizes the dev tools in the orientation of their dock: top and bottom share a height, left and right a width", () => {
    const size = (dock: (typeof DEFAULT_DEV_TOOLS)["dock"]) => resizeDevTools({ ...DEFAULT_DEV_TOOLS, dock }, { size: 300.4 }).size;
    expect(size("top")).toEqual({ top: 300, side: 360 });
    expect(size("bottom")).toEqual({ top: 300, side: 360 });
    expect(size("left")).toEqual({ top: 240, side: 300 });
    expect(size("right")).toEqual({ top: 240, side: 300 });
    const two = toggleDevToolPanel(toggleDevToolPanel(DEFAULT_DEV_TOOLS, "messages"), "stats");
    expect(resizeDevTools(two, { shares: [1.5, 0.5] })).toMatchObject({ size: DEFAULT_DEV_TOOLS.size, panels: [{ share: 1.5 }, { share: 0.5 }] });
  });
});
