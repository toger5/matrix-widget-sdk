/**
 * "Remember capabilities" (`src/lib/capabilityStore.ts`): what the driver does not know is never
 * stored, so a later version of the app that knows the name asks before it grants it.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { capabilityStoreKey, loadCapabilities, saveCapabilities } from "../src/lib/capabilityStore";
import { X } from "./harness";

const items = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (key: string) => items.get(key) ?? null,
  setItem: (key: string, value: string) => void items.set(key, value),
  removeItem: (key: string) => void items.delete(key),
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
});
