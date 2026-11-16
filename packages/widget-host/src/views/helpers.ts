/** Derivations the views share. Pure functions of the view model; nothing here holds state. */
import type { MainViewModel, RoomId, WidgetKey } from "../appViewModel";
import type { RoomSummary } from "../session";
import { describesWidget, localWidgetKey, resolveWidget, widgetKey, type ResolvedWidget, type StateEvent } from "../widgetStateEvent";

/** Where legacy widgets are loaded through; the compat wrapper this host serves itself by default (`?wrapper=` overrides). */
export const wrapperUrl = () =>
  new URLSearchParams(globalThis.location?.search ?? "").get("wrapper") ??
  new URL(`${import.meta.env.BASE_URL}widget_compatibility_wrapper/`, globalThis.location?.origin ?? "http://localhost").href;

/** A widget of a room as the RoomOverview lists it. `problem`: the state event cannot be embedded (the row is disabled). */
export interface RoomWidget {
  key: WidgetKey;
  name: string;
  event: StateEvent;
  widget?: ResolvedWidget;
  problem?: string;
  /** A local widget ("Add widget", only in this host): `key` is its `localWidgetKey`. */
  local?: true;
}

/**
 * The widgets a room offers: its widget state events, then its local widgets
 * (`AccountDataViewModel.localWidgets` of the room). Every event goes through `resolveWidget`, so
 * a stored local widget with a URL that cannot be embedded is listed disabled like a room widget.
 */
export function roomWidgets(room: Pick<RoomSummary, "widgetEvents"> | undefined, local: StateEvent[] = []): RoomWidget[] {
  const listed = (event: StateEvent, isLocal: boolean): RoomWidget => {
    const key = isLocal ? localWidgetKey(event) : widgetKey(event);
    const name = typeof event.content.name === "string" && event.content.name ? event.content.name : event.state_key;
    const mark = isLocal ? { local: true as const } : {};
    try {
      return { key, name, event, widget: resolveWidget(event, wrapperUrl()), ...mark };
    } catch (e) {
      return { key, name, event, problem: e instanceof Error ? e.message : String(e), ...mark };
    }
  };
  return [...(room?.widgetEvents ?? []).filter(describesWidget).map((e) => listed(e, false)), ...local.filter(describesWidget).map((e) => listed(e, true))];
}

/** The local widgets of a room of the active account. */
export const localWidgetsOf = (m: MainViewModel, roomId: RoomId): StateEvent[] => m.data.localWidgets[roomId] ?? [];

/** The rooms of the active account, or an empty list while they load. */
export const readyRooms = (m: MainViewModel): RoomSummary[] => (m.data.rooms.status === "ready" ? m.data.rooms.value : []);

export const roomOf = (m: MainViewModel, roomId: RoomId): RoomSummary | undefined => readyRooms(m).find((r) => r.id === roomId);

/** "1 widget" / "3 widgets". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A short, one-line summary of an event content: the DevBackendView's event rows, the RoomTimeline's unknown event types. */
export function previewOf(content: Record<string, unknown>): string {
  if (typeof content.body === "string") return `“${content.body}”`;
  if (typeof content.membership === "string") return content.membership;
  const text = JSON.stringify(content);
  return text.length > 80 ? `${text.slice(0, 79)}…` : text;
}
