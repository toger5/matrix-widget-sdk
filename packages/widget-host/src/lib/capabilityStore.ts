/**
 * The capabilities the user has approved, kept per account, room and widget so a widget is not
 * asked about again every time it is opened. In `localStorage`: one entry per widget.
 *
 * A single-use capability (`get_openid`) is only stored when the user chose to allow it always
 * (it is then granted again per use without asking); the runtime decides that, not this store.
 */
import { capabilityIsKnown } from "@matrix-widget-tools/widget-host-bindings";

const PREFIX = "widget_host_capabilities_v2";
/**
 * Version 1, from before `get_openid` became a single-use capability. Its entries hold
 * `get_openid` for every widget that was approved once (every legacy widget got it without
 * asking): it meant "may ask for a token, the user is asked per token" then, and would mean "gets
 * every token without asking" now.
 */
const PREFIX_V1 = "widget_host_capabilities_v1";
/** What version 1 must not hand over: `get_openid`, in both spellings. */
const DROPPED_FROM_V1 = ["widget:org.matrix.mscXXXX.get_openid", "widget:m.get_openid"];

const storedKeys = (prefix: string) =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => !!key?.startsWith(`${prefix} `));

/** `widget` is the widget's `widgetKey`. None of the ids contains a space. */
export const capabilityStoreKey = (userId: string, roomId: string, widget: string) => `${PREFIX} ${userId} ${roomId} ${widget}`;

export function loadCapabilities(key: string): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(key) ?? "[]");
    return Array.isArray(stored) ? stored.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Replaces what is stored under `key`; an empty list removes the entry. What the driver does not
 * know (`capabilityIsKnown`) is never stored, so it is asked about again next time: it allows
 * nothing now, and a later version of the app that knows the name must not grant it unasked.
 */
export function saveCapabilities(key: string, capabilities: string[]): void {
  const known = capabilities.filter((capability) => capabilityIsKnown(capability));
  if (known.length === 0) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(known));
}

/** Forget what was approved for every widget of `userId`, e.g. when they log out. */
export function clearCapabilities(userId: string): void {
  for (const key of storedKeys(`${PREFIX} ${userId}`)) localStorage.removeItem(key);
}

/**
 * Move the entries of version 1 to version 2 without `get_openid` (see `PREFIX_V1`); an entry
 * left empty is dropped. Run once at startup, before a widget starts. Idempotent: a version 2
 * entry that exists already wins, and nothing of version 1 is left afterwards.
 */
export function migrateCapabilityStore(): void {
  for (const key of storedKeys(PREFIX_V1)) {
    const next = PREFIX + key.slice(PREFIX_V1.length);
    if (localStorage.getItem(next) === null) saveCapabilities(next, loadCapabilities(key).filter((capability) => !DROPPED_FROM_V1.includes(capability)));
    localStorage.removeItem(key);
  }
}

/** Forget what was approved for one widget (`capabilityStoreKey`): it was removed, or its URL changed. */
export function forgetCapabilities(key: string): void {
  localStorage.removeItem(key);
}
