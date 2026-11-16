/** Derivations the views share. Pure functions of the view model; nothing here holds state. */
import type { MainViewModel, RoomId, WidgetKey } from "../appViewModel";
import type { RoomSummary } from "../session";
import { describesWidget, resolveWidget, widgetKey, type ResolvedWidget, type StateEvent } from "../widgetStateEvent";

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
}

/** The widgets a room offers, from its widget state events. */
export function roomWidgets(room: Pick<RoomSummary, "widgetEvents"> | undefined): RoomWidget[] {
  return (room?.widgetEvents ?? []).filter(describesWidget).map((event) => {
    const key = widgetKey(event);
    const name = typeof event.content.name === "string" && event.content.name ? event.content.name : event.state_key;
    try {
      return { key, name, event, widget: resolveWidget(event, wrapperUrl()) };
    } catch (e) {
      return { key, name, event, problem: e instanceof Error ? e.message : String(e) };
    }
  });
}

/** The rooms of the active account, or an empty list while they load. */
export const readyRooms = (m: MainViewModel): RoomSummary[] => (m.data.rooms.status === "ready" ? m.data.rooms.value : []);

export const roomOf = (m: MainViewModel, roomId: RoomId): RoomSummary | undefined => readyRooms(m).find((r) => r.id === roomId);

/** "1 widget" / "3 widgets". */
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
