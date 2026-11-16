/** The pure layout transitions behind the panel, tab and dev tool intents. */
import { describe, expect, it } from "vitest";

import { MAX_DEV_TOOL_PANELS } from "../src/appViewModel";
import {
  activateTab,
  addPanel,
  DEFAULT_DEV_TOOLS,
  emptyWorkspace,
  findWidgetTab,
  putTab,
  removePanel,
  removeTab,
  resizeDevTools,
  resizePanel,
  roomOfPanel,
  toggleDevToolPanel,
  upgradeWorkspace,
  workspaceWidgetIds,
} from "../src/app/layout";

const room = (roomId: string) => ({ kind: "room" as const, roomId, tabs: [] });

describe("layout", () => {
  it("adds panels on the right of a panel and focuses them", () => {
    const a = addPanel(emptyWorkspace(), room("!a"));
    const b = addPanel(a.ws, room("!b"));
    const c = addPanel(b.ws, room("!c"), a.panelId);
    expect(c.ws.roomsArea.panels.map((p) => (p.content.kind === "room" ? p.content.roomId : ""))).toEqual(["!a", "!c", "!b"]);
    expect(c.ws.roomsArea.focusedPanelId).toBe(c.panelId);
    expect(removePanel(c.ws, c.panelId).roomsArea.focusedPanelId).toBe(b.panelId);
  });

  it("puts tabs at the end and shows them; closing the shown tab shows its neighbour, the last one the room name", () => {
    const { ws, panelId } = addPanel(emptyWorkspace(), room("!a"));
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
    const a = addPanel(emptyWorkspace(), room("!a"));
    const b = addPanel(putTab(a.ws, a.panelId, { kind: "widget", id: "t1", widgetId: "!a|w" }), room("!b"));
    expect(b.ws.roomsArea.focusedPanelId).toBe(b.panelId);

    const overview = activateTab(b.ws, a.panelId, undefined);
    expect(overview.roomsArea.focusedPanelId).toBe(a.panelId);
    expect(roomOfPanel(overview, a.panelId)?.activeTabId).toBeUndefined();
    expect(roomOfPanel(activateTab(overview, a.panelId, "t1"), a.panelId)?.activeTabId).toBe("t1");

    const unknown = activateTab(overview, a.panelId, "nope");
    expect(roomOfPanel(unknown, a.panelId)?.activeTabId).toBeUndefined();
    expect(activateTab(b.ws, a.panelId, "nope").roomsArea.focusedPanelId).toBe(a.panelId);
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
      { kind: "picker", mode: "allRooms" },
    ]);
    expect(ws.roomsArea.panels[0].widthShare).toBe(1.5);
    expect(ws.roomsArea.focusedPanelId).toBe("p2");
    expect(ws.pip).toEqual(stored.pip);
    expect(ws.devTools).toEqual(stored.devTools);
    // A current layout comes back unchanged.
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
    expect(ws.roomsArea).toEqual({ panels: [{ id: "p1", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [{ kind: "widget", id: "t2", widgetId: "!a|w" }], activeTabId: undefined } }], focusedPanelId: "p1" });
    expect(ws.pip).toEqual({ ...emptyWorkspace().pip, boxSize: { width: emptyWorkspace().pip.boxSize.width, height: 90 } });
    expect(ws.devTools).toEqual({ "!a|w": { ...DEFAULT_DEV_TOOLS, panels: [{ panel: "console", share: 1 }] } });
  });

  it("upgrades a stored layout with repeated ids: a panel, a tab and a widget are kept once, a widget tab only in its own room", () => {
    const tab = (id: string, widgetId: string) => ({ kind: "widget", id, widgetId });
    const ws = upgradeWorkspace({
      roomsArea: {
        panels: [
          { id: "p1", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [tab("t1", "!a|w"), tab("t2", "!b|w"), tab("t1", "!a|v")], activeTabId: "t2" } },
          { id: "p1", widthShare: 1, content: { kind: "picker", mode: "recents" } },
          { id: "p2", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [tab("t3", "!a|w"), tab("t4", "!a|v")], activeTabId: "t4" } },
        ],
        focusedPanelId: "p1",
      },
    });
    expect(ws.roomsArea.panels).toEqual([
      { id: "p1", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [tab("t1", "!a|w")], activeTabId: undefined } },
      { id: "p2", widthShare: 1, content: { kind: "room", roomId: "!a", tabs: [tab("t4", "!a|v")], activeTabId: "t4" } },
    ]);
    expect(workspaceWidgetIds(ws)).toEqual(["!a|w", "!a|v"]);
  });

  it("resizes a panel against its right neighbour", () => {
    const a = addPanel(emptyWorkspace(), room("!a"));
    const b = addPanel(a.ws, room("!b"));
    const shares = resizePanel(b.ws, a.panelId, 1.5).roomsArea.panels.map((p) => p.widthShare);
    expect(shares).toEqual([1.5, 0.5]);
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
