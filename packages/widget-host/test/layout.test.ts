/** The pure layout transitions behind the panel, tab and dev tool intents. */
import { describe, expect, it } from "vitest";

import { MAX_DEV_TOOL_PANELS } from "../src/appViewModel";
import {
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

  it("puts, replaces and removes tabs, keeping an active tab", () => {
    const { ws, panelId } = addPanel(emptyWorkspace(), room("!a"));
    let next = putTab(ws, panelId, { kind: "new", id: "t1" });
    next = putTab(next, panelId, { kind: "widget", id: "t2", widgetId: "!a|w" }, "t1");
    next = putTab(next, panelId, { kind: "native", id: "t3", view: "roomOverview" });
    expect(roomOfPanel(next, panelId)?.tabs.map((t) => t.id)).toEqual(["t2", "t3"]);
    expect(findWidgetTab(next, "!a|w")).toEqual({ panelId, tabId: "t2" });
    expect(workspaceWidgetIds(next)).toEqual(["!a|w"]);
    next = removeTab(next, panelId, "t3");
    expect(roomOfPanel(next, panelId)?.activeTabId).toBe("t2");
    expect(roomOfPanel(removeTab(next, panelId, "t2"), panelId)?.activeTabId).toBeUndefined();
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
