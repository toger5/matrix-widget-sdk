/**
 * "Remember capabilities" (`src/lib/capabilityStore.ts`): what the driver does not know is never
 * stored, so a later version of the app that knows the name asks before it grants it; and the
 * entries of version 1 lose `get_openid`, which is a single-use capability since.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { capabilityStoreKey, clearCapabilities, loadCapabilities, migrateCapabilityStore, saveCapabilities } from "../src/lib/capabilityStore";
import { X } from "./harness";

const items = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => void items.set(key, value),
  removeItem: (key: string) => void items.delete(key),
  key: (index: number) => [...items.keys()][index] ?? null,
  get length() {
    return items.size;
  },
});

const KEY = capabilityStoreKey("@alice:dev.local", "!lab:dev.local", "widget-1");
const SEND_MESSAGE = `widget:${X}send_event.timeline:m.room.message`;
const NAVIGATE = "widget:m.navigate";
/** Not capabilities of the widget API: another namespace, and a known action name under a namespace that is not its own. */
const UNKNOWN = ["widget:org.example.custom.share_screen", `widget:${X}navigate`];

describe("capability store", () => {
  beforeEach(() => items.clear());

  it("remembers the capabilities of the widget API, in their order", () => {
    saveCapabilities(KEY, [SEND_MESSAGE, NAVIGATE]);
    expect(loadCapabilities(KEY)).toEqual([SEND_MESSAGE, NAVIGATE]);
  });

  it("never remembers what the driver does not know", () => {
    saveCapabilities(KEY, [UNKNOWN[0], SEND_MESSAGE, UNKNOWN[1]]);
    expect(loadCapabilities(KEY)).toEqual([SEND_MESSAGE]);
    // Only unknown ones: nothing is stored at all.
    saveCapabilities(KEY, UNKNOWN);
    expect(items.has(KEY)).toBe(false);
    expect(loadCapabilities(KEY)).toEqual([]);
  });

  it("keeps every account's entries apart", () => {
    const bob = capabilityStoreKey("@bob:dev.local", "!lab:dev.local", "widget-1");
    saveCapabilities(KEY, [NAVIGATE]);
    saveCapabilities(bob, [NAVIGATE]);
    clearCapabilities("@alice:dev.local");
    expect(loadCapabilities(KEY)).toEqual([]);
    expect(loadCapabilities(bob)).toEqual([NAVIGATE]);
  });
});

describe("capability store migration from version 1", () => {
  beforeEach(() => items.clear());
  const v1 = (key: string) => key.replace("widget_host_capabilities_v2 ", "widget_host_capabilities_v1 ");
  const GET_OPENID = `widget:${X}get_openid`;

  it("moves every entry to version 2 without get_openid, which is a single-use capability now", () => {
    const other = capabilityStoreKey("@bob:dev.local", "!lab:dev.local", "im.vector.modular.widgets/call");
    expect(KEY.startsWith("widget_host_capabilities_v2 ")).toBe(true);
    items.set(v1(KEY), JSON.stringify([SEND_MESSAGE, GET_OPENID, NAVIGATE, "widget:m.get_openid"]));
    items.set(v1(other), JSON.stringify([GET_OPENID]));
    items.set("widget_host_ui_v1", "{}");
    migrateCapabilityStore();
    expect(loadCapabilities(KEY)).toEqual([SEND_MESSAGE, NAVIGATE]);
    // An entry that held nothing else is gone.
    expect(items.has(other)).toBe(false);
    expect([...items.keys()].sort()).toEqual([KEY, "widget_host_ui_v1"]);
  });

  it("runs once: a version 2 entry wins, nothing of version 1 is left", () => {
    saveCapabilities(KEY, [NAVIGATE]);
    items.set(v1(KEY), JSON.stringify([SEND_MESSAGE]));
    migrateCapabilityStore();
    migrateCapabilityStore();
    expect(loadCapabilities(KEY)).toEqual([NAVIGATE]);
    expect([...items.keys()]).toEqual([KEY]);
  });
});
