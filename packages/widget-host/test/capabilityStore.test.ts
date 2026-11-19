/**
 * "Remember capabilities" (`src/lib/capabilityStore.ts`): what the driver does not know is never
 * stored, so a later version of the app that knows the name asks before it grants it; what is
 * stored belongs to the URL of the iframe it was approved for; version 1 entries are dropped.
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
const URL_A = "https://a.example/widget/";
/** Not capabilities of the widget API: another namespace, and a known action name under a namespace that is not its own. */
const UNKNOWN = ["widget:org.example.custom.share_screen", `widget:${X}navigate`];

describe("capability store", () => {
  beforeEach(() => items.clear());

  it("remembers the capabilities of the widget API, in their order", () => {
    saveCapabilities(KEY, URL_A, [SEND_MESSAGE, NAVIGATE]);
    expect(loadCapabilities(KEY, URL_A)).toEqual([SEND_MESSAGE, NAVIGATE]);
  });

  it("never remembers what the driver does not know", () => {
    saveCapabilities(KEY, URL_A, [UNKNOWN[0], SEND_MESSAGE, UNKNOWN[1]]);
    expect(loadCapabilities(KEY, URL_A)).toEqual([SEND_MESSAGE]);
    // Only unknown ones: nothing is stored at all.
    saveCapabilities(KEY, URL_A, UNKNOWN);
    expect(items.has(KEY)).toBe(false);
    expect(loadCapabilities(KEY, URL_A)).toEqual([]);
  });

  it("hands them only to the URL they were approved for: a widget whose state event now points elsewhere is asked again", () => {
    saveCapabilities(KEY, URL_A, [SEND_MESSAGE]);
    expect(loadCapabilities(KEY, "https://b.example/widget/")).toEqual([]);
    expect(loadCapabilities(KEY, URL_A)).toEqual([SEND_MESSAGE]);
  });

  it("keeps every account's entries apart", () => {
    const bob = capabilityStoreKey("@bob:dev.local", "!lab:dev.local", "widget-1");
    saveCapabilities(KEY, URL_A, [NAVIGATE]);
    saveCapabilities(bob, URL_A, [NAVIGATE]);
    clearCapabilities("@alice:dev.local");
    expect(loadCapabilities(KEY, URL_A)).toEqual([]);
    expect(loadCapabilities(bob, URL_A)).toEqual([NAVIGATE]);
  });

  it("migrating drops version 1 and the entries without a URL: they do not say which page they were approved for", () => {
    const v1 = KEY.replace("widget_host_capabilities_v2 ", "widget_host_capabilities_v1 ");
    items.set(v1, JSON.stringify([SEND_MESSAGE]));
    items.set(KEY, JSON.stringify([NAVIGATE]));
    items.set("widget_host_ui_v1", "{}");
    migrateCapabilityStore();
    expect(items.has(v1)).toBe(false);
    expect(loadCapabilities(KEY, URL_A)).toEqual([]);
    expect(items.has("widget_host_ui_v1")).toBe(true);
  });
});
