/**
 * The capabilities the user has approved, kept per account, room and widget so a widget is not
 * asked about again every time it is opened. In `localStorage`: one entry per widget, holding the
 * URL of the iframe they were approved for (`WidgetIframe.url`) and the capabilities. They belong to
 * that URL: whoever may change the widget's state event could otherwise point an approved widget at
 * another page, which would get them without a prompt. A start with another URL finds nothing.
 *
 * A single-use capability (`get_openid`) is only stored when the user chose to allow it always
 * (it is then granted again per use without asking); the runtime decides that, not this store.
 */
import { capabilityIsKnown } from "@matrix-widget-tools/widget-host-bindings";

const PREFIX = "widget_host_capabilities_v2";
/** Version 1 (and version 2 entries from before they held the URL) did not say which URL they were approved for: dropped. */
const PREFIX_V1 = "widget_host_capabilities_v1";

const storedKeys = (prefix: string) =>
  Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)).filter((key): key is string => !!key?.startsWith(`${prefix} `));

/** `widget` is the widget's `widgetKey`. None of the ids contains a space. */
export const capabilityStoreKey = (userId: string, roomId: string, widget: string) => `${PREFIX} ${userId} ${roomId} ${widget}`;

/** What is stored under `key` for the iframe URL `url`; nothing when it was approved for another URL. */
export function loadCapabilities(key: string, url: string): string[] {
  try {
    const stored = JSON.parse(localStorage.getItem(key) ?? "null") as { url?: unknown; capabilities?: unknown } | null;
    return stored?.url === url && Array.isArray(stored.capabilities) ? stored.capabilities.filter((c): c is string => typeof c === "string") : [];
  } catch {
    return [];
  }
}

/**
 * Replaces what is stored under `key`, for the iframe URL `url`; an empty list removes the entry.
 * What the driver does not know (`capabilityIsKnown`) is never stored, so it is asked about again
 * next time: it allows nothing now, and a later version of the app that knows the name must not grant
 * it unasked.
 */
export function saveCapabilities(key: string, url: string, capabilities: string[]): void {
  const known = capabilities.filter((capability) => capabilityIsKnown(capability));
  if (known.length === 0) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify({ url, capabilities: known }));
}

/** Forget what was approved for every widget of `userId`, e.g. when they log out. */
export function clearCapabilities(userId: string): void {
  for (const key of storedKeys(`${PREFIX} ${userId}`)) localStorage.removeItem(key);
}

/** Drop the entries of version 1 (see `PREFIX_V1`). Run once at startup, before a widget starts. */
export function migrateCapabilityStore(): void {
  for (const key of storedKeys(PREFIX_V1)) localStorage.removeItem(key);
}

/** Forget what was approved for one widget (`capabilityStoreKey`): it was removed, or its URL changed. */
export function forgetCapabilities(key: string): void {
  localStorage.removeItem(key);
}
