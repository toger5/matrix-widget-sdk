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
  it("brings each stored workspace through `upgradeWorkspace` (cases in test/layout.test.ts); a broken one is empty, a non-object ignored", () => {
    const tabs = [
      { kind: "widget", id: "t1", widgetId: "!a:example.org|m.widget/call" },
      { kind: "roomTools", id: "t2", layout: { dock: "left", panels: [{ panel: "timeline", share: 1 }] } },
    ];
    const content = { kind: "room", roomId: "!a:example.org", tabs, activeTabId: "t2" };
    storeUi({ workspaces: { ada: { roomsArea: { panels: [{ id: "p1", content: { ...content, tabs: [...tabs, { kind: "new", id: "t3" }] } }] } }, broken: "not a layout" } });
    const ui = loadPersisted();
    expect(ui?.workspaces.ada.roomsArea.panels[0].content).toEqual(content);
    expect(ui?.workspaces.ada.roomsArea.dock).toEqual({ center: { rows: [{ items: [{ id: "p1", group: "!a:example.org" }] }] } });
    expect(ui?.workspaces.broken.roomsArea.panels).toEqual([]);
    storeUi({ workspaces: [1, 2] });
    expect(loadPersisted()?.workspaces).toEqual({});
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
