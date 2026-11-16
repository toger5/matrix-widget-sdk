/** What survives a reload (`src/app/persistence.ts`): stored layouts of earlier versions are brought to the current shape. */
import { afterEach, describe, expect, it, vi } from "vitest";

import { loadPersisted } from "../src/app/persistence";

const KEY = "widget_host_ui_v1";

function storeUi(value: unknown): void {
  const items = new Map([[KEY, JSON.stringify(value)]]);
  vi.stubGlobal("localStorage", { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, v: string) => void items.set(key, v) });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("loadPersisted", () => {
  it("drops the removed tab kinds: a room whose stored active tab was the room overview tab shows its RoomOverview", () => {
    storeUi({
      settings: { devTools: true, theme: "dark" },
      workspaces: {
        ada: {
          roomsArea: {
            panels: [
              {
                id: "p1",
                widthShare: 1,
                content: {
                  kind: "room",
                  roomId: "!a:example.org",
                  tabs: [
                    { kind: "widget", id: "t1", widgetId: "!a:example.org|m.widget/call" },
                    { kind: "native", id: "t2", view: "roomOverview" },
                    { kind: "new", id: "t3" },
                  ],
                  activeTabId: "t2",
                },
              },
            ],
            focusedPanelId: "p1",
          },
          pip: { stacking: "horizontal", position: { x: 24, y: 24 }, boxSize: { width: 224, height: 140 } },
          devTools: {},
        },
        broken: "not a layout",
      },
    });
    const ui = loadPersisted();
    expect(ui?.settings).toEqual({ devTools: true, theme: "dark" });
    expect(ui?.workspaces.ada.roomsArea.panels[0].content).toEqual({
      kind: "room",
      roomId: "!a:example.org",
      tabs: [{ kind: "widget", id: "t1", widgetId: "!a:example.org|m.widget/call" }],
      activeTabId: undefined,
    });
    expect(ui?.workspaces.broken.roomsArea.panels).toEqual([]);
  });

  it("ignores stored workspaces that are not an object", () => {
    storeUi({ workspaces: [1, 2] });
    expect(loadPersisted()?.workspaces).toEqual({});
  });
});
