/** What the tab bar, the "all tabs" menu and the tab panel need to know about a tab. Pure derivations. */
import type { MainViewModel, PanelId, TabId, TabViewModel, WidgetKey } from "../../appViewModel";
import type { RoomSummary } from "../../session";
import type { WidgetEventParser } from "../../widgetStateEvent";
import { localWidgetsOf, roomWidgets } from "../helpers";
import type { IconName } from "../ui/icons";

/** An id that is safe in `id` / `aria-controls` (those are space separated lists). */
const domId = (...parts: string[]) => parts.join("-").replace(/[^\w-]/g, "_");
export const tabDomId = (panelId: PanelId, tabId: TabId) => domId("tab", panelId, tabId);
/** The room name, the first tab of a room panel. */
export const roomTabDomId = (panelId: PanelId) => domId("roomtab", panelId);
export const tabPanelDomId = (panelId: PanelId) => domId("tabpanel", panelId);

export interface TabInfo {
  /** The label. */
  name: string;
  /** The `title` of the tab. */
  title: string;
  /** The accessible name of its × ("Close Whiteboard", "Close the timeline"). */
  closeLabel: string;
  /** A widget tab: its widget key (the avatar's color). A host tab has `icon` instead. */
  widgetKey?: WidgetKey;
  /** A host tab: its icon (the timeline: message; the room dev tools: the Dev tools icon of the LeftBar). */
  icon?: IconName;
  /** The widget asked to be always on screen: the pin icon. */
  pinned: boolean;
  load?: "loading" | "ready" | "failed";
}

/** `roomName`: the name of the panel's room (the title of a host tab). `widgetEvents`: `ViewEnv.widgetEvents`. */
export function tabInfo(main: MainViewModel, room: RoomSummary | undefined, tab: TabViewModel, roomName: string, widgetEvents: WidgetEventParser): TabInfo {
  if (tab.kind === "timeline") return { name: "Timeline", title: `Timeline of ${roomName}`, closeLabel: "Close the timeline", icon: "message", pinned: false };
  if (tab.kind === "roomTools") return { name: "Room dev tools", title: `Room dev tools of ${roomName}`, closeLabel: "Close the room dev tools", icon: "cone", pinned: false };
  const widget = main.widgets[tab.widgetId];
  // A tab can outlive its widget for a moment (the layout is restored before the widgets start).
  const key = widget?.widgetKey ?? (room && tab.widgetId.startsWith(`${room.id}|`) ? tab.widgetId.slice(room.id.length + 1) : tab.widgetId);
  const name = widget?.widget.name ?? roomWidgets(widgetEvents, room, room && localWidgetsOf(main, room.id)).find((w) => w.key === key)?.name ?? "Widget";
  const pinned = !!widget?.alwaysOnScreen;
  return { name, title: `${name}${pinned ? " · always on screen" : ""}`, closeLabel: `Close ${name}`, widgetKey: key, pinned, load: widget?.load.state === "sameOrigin" ? undefined : widget?.load.state };
}

/** "call.example.org" of a widget URL, for the second line of a widget row of the RoomOverview. */
export function hostOf(url: unknown): string {
  if (typeof url !== "string") return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
