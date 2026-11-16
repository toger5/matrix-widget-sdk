/** Derivations the views share. Pure functions of the view model; nothing here holds state. */
import type { MainViewModel, RoomId, WidgetKey } from "../appViewModel";
import type { RoomSummary } from "../session";
import { localWidgetKey, widgetKey, type ResolvedWidget, type StateEvent, type WidgetEventParser } from "../widgetStateEvent";

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
 * (`AccountDataViewModel.localWidgets` of the room), as the driver's parser reads them (`parser`:
 * `ViewEnv.widgetEvents` in a view). Events that describe no widget (removed ones) are left out; a
 * widget that must not be loaded (also a stored local one) is listed with its `problem`, disabled.
 */
export function roomWidgets(parser: WidgetEventParser, room: Pick<RoomSummary, "widgetEvents"> | undefined, local: StateEvent[] = []): RoomWidget[] {
  const listed = (event: StateEvent, isLocal: boolean): RoomWidget[] => {
    const resolution = parser.resolve(event);
    if (!resolution) return [];
    const key = isLocal ? localWidgetKey(event) : widgetKey(event);
    const { name, widget, problem } = resolution;
    return [{ key, name, event, ...(widget ? { widget } : { problem }), ...(isLocal ? { local: true as const } : {}) }];
  };
  return [...(room?.widgetEvents ?? []).flatMap((e) => listed(e, false)), ...local.flatMap((e) => listed(e, true))];
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
