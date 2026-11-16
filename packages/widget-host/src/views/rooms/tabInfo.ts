/** What the tab bar, the "all tabs" menu and the tab panel need to know about a tab. Pure derivations. */
import type { MainViewModel, PanelId, TabId, TabViewModel, WidgetKey } from "../../appViewModel";
import type { RoomSummary } from "../../session";
import { roomWidgets } from "../helpers";

/** An id that is safe in `id` / `aria-controls` (those are space separated lists). */
export const domId = (...parts: string[]) => parts.join("-").replace(/[^\w-]/g, "_");
export const tabDomId = (panelId: PanelId, tabId: TabId) => domId("tab", panelId, tabId);
export const tabPanelDomId = (panelId: PanelId) => domId("tabpanel", panelId);

export interface TabInfo {
  name: string;
  /** Widget tabs only. */
  widgetKey?: WidgetKey;
  /** The widget asked to be always on screen: the pin icon. */
  pinned: boolean;
  load?: "loading" | "ready" | "failed";
}

export function tabInfo(main: MainViewModel, room: RoomSummary | undefined, tab: TabViewModel): TabInfo {
  if (tab.kind === "new") return { name: "New tab", pinned: false };
  if (tab.kind === "native") return { name: "Room overview", pinned: false };
  const widget = main.widgets[tab.widgetId];
  // A tab can outlive its widget for a moment (the layout is restored before the widgets start).
  const key = widget?.widgetKey ?? (room && tab.widgetId.startsWith(`${room.id}|`) ? tab.widgetId.slice(room.id.length + 1) : tab.widgetId);
  const name = widget?.widget.name ?? roomWidgets(room).find((w) => w.key === key)?.name ?? "Widget";
  return { name, widgetKey: key, pinned: !!widget?.alwaysOnScreen, load: widget?.load.state };
}

/** "call.example.org" of a widget URL, for the second line of a tile. */
export function hostOf(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
