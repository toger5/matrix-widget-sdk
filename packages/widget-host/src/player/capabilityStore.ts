/**
 * The capabilities the user has approved, kept per account, room and widget so a widget is not
 * asked about again every time it is opened. In `localStorage`: one entry per widget.
 */
const PREFIX = "widget_host_capabilities_v1";

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

/** Replaces what is stored under `key`; an empty list removes the entry. */
export function saveCapabilities(key: string, capabilities: string[]): void {
  if (capabilities.length === 0) localStorage.removeItem(key);
  else localStorage.setItem(key, JSON.stringify(capabilities));
}

/** Forget what was approved for every widget of `userId`, e.g. when they log out. */
export function clearCapabilities(userId: string): void {
  const prefix = `${PREFIX} ${userId} `;
  const keys = Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i));
  for (const key of keys) if (key?.startsWith(prefix)) localStorage.removeItem(key);
}
