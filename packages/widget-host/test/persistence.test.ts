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
    expect(ui?.settings).toEqual({ devTools: true, devBackend: true, theme: "dark" });
    expect(ui?.workspaces.ada.roomsArea.panels[0].content).toEqual({
      kind: "room",
      roomId: "!a:example.org",
      tabs: [{ kind: "widget", id: "t1", widgetId: "!a:example.org|m.widget/call" }],
      activeTabId: undefined,
    });
    expect(ui?.workspaces.broken.roomsArea.panels).toEqual([]);
  });

  it("derives the recent rooms of an account that has none stored from its recent widgets, newest first", () => {
    const widget = (roomId: string, lastOpened: number) => ({ roomId, widgetKey: "m.widget/w", lastOpened });
    storeUi({
      recents: { ada: [widget("!a:x", 30), widget("!b:x", 20), widget("!a:x", 10)], work: [widget("!c:x", 5)] },
      recentRooms: { work: [{ roomId: "!d:x", lastOpened: 50 }] },
    });
    const ui = loadPersisted();
    expect(ui?.recentRooms).toEqual({
      ada: [
        { roomId: "!a:x", lastOpened: 30 },
        { roomId: "!b:x", lastOpened: 20 },
      ],
      work: [{ roomId: "!d:x", lastOpened: 50 }],
    });
    expect(ui?.recents.ada).toHaveLength(3);
  });

  it("drops malformed recents: an account whose value is not a list, entries with missing or wrongly typed fields", () => {
    storeUi({
      recents: { ada: [null, "x", { roomId: "!a:x", lastOpened: 1 }, { roomId: "!a:x", widgetKey: "m.widget/w", lastOpened: "1" }, { roomId: "!b:x", widgetKey: "m.widget/w", lastOpened: 2 }], work: "broken" },
      recentRooms: { ada: [{ roomId: 5, lastOpened: 1 }, { roomId: "!c:x", lastOpened: 3 }], old: { roomId: "!d:x" } },
    });
    const ui = loadPersisted();
    expect(ui?.recents).toEqual({ ada: [{ roomId: "!b:x", widgetKey: "m.widget/w", lastOpened: 2 }] });
    expect(ui?.recentRooms).toEqual({ ada: [{ roomId: "!c:x", lastOpened: 3 }] });
  });

  it("ignores stored workspaces that are not an object", () => {
    storeUi({ workspaces: [1, 2] });
    expect(loadPersisted()?.workspaces).toEqual({});
  });

  it("gives settings stored before the DevBackend switch the DevBackend of the dev tools, and keeps a stored one", () => {
    storeUi({ settings: { devTools: false, theme: "light" } });
    expect(loadPersisted()?.settings).toEqual({ devTools: false, devBackend: false, theme: "light" });
    storeUi({ settings: { devTools: true } });
    expect(loadPersisted()?.settings).toEqual({ devTools: true, devBackend: true, theme: "system" });
    storeUi({ settings: { devTools: true, devBackend: false } });
    expect(loadPersisted()?.settings.devBackend).toBe(false);
    storeUi({ settings: { devTools: false, devBackend: true } });
    expect(loadPersisted()?.settings).toEqual({ devTools: false, devBackend: true, theme: "system" });
  });

  it("keeps the local widgets per account and room, and drops malformed ones", () => {
    const widget = { type: "m.widget", state_key: "w1", content: { name: "W", url: "https://w.example.org/" } };
    storeUi({
      localWidgets: {
        ada: { "!a:x": [widget, null, { type: "m.widget", content: {} }, { type: "m.widget", state_key: "w2", content: "x" }, { ...widget, extra: 1 }], "!b:x": "broken" },
        work: [widget],
        old: "broken",
      },
    });
    expect(loadPersisted()?.localWidgets).toEqual({ ada: { "!a:x": [widget, widget] } });
    storeUi({});
    expect(loadPersisted()?.localWidgets).toEqual({});
  });
});
