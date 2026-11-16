/**
 * Pure parts of the Dev tools (`RoomToolsViewModel`): which state events sent to a real room ask
 * first, and the delayed events a Matrix account scheduled from here. No effects; unit tested in
 * `test/roomTools.test.ts`.
 */
import { ROOM_CONFIGURATION_TYPES, type AccountId, type MockedStateEvent, type RoomId, type RoomToolsViewModel, type ScheduledEvent, type WidgetHostBehavior } from "../appViewModel";
import { WIDGET_EVENT_TYPES, describesWidget, type StateEvent } from "../widgetStateEvent";

/** How the host answers widgets in the DevBackend until the Client Backend Tool changes it. */
export const DEFAULT_DEV_BEHAVIOR: WidgetHostBehavior = { autoApproveCapabilities: false, autoApproveOpenId: false, rememberCapabilities: false };

export const defaultRoomToolsVm = (): RoomToolsViewModel => ({
  selectedRoomIds: {},
  // "widgetHostBehavior" is a section of the Client Backend Tool: open once the tool is opened.
  openSections: ["state", "timeline", "widgetHostBehavior"],
  sendForm: "message",
  stateForm: "widget",
  tools: { open: null, heightShare: 0.5 },
  behavior: DEFAULT_DEV_BEHAVIOR,
  scheduled: {},
});

/** What a configuration type changes, for the confirmation: its title (`{room}` is the room's name) and what the event does. */
const CONFIGURATION: Record<string, { title: string; changes: string; note?: string }> = {
  "m.room.power_levels": { title: "Change the power levels of {room}?", changes: "changes who may do what in it", note: "Some changes cannot be undone, for example lowering your own level." },
  "m.room.join_rules": { title: "Change who may join {room}?", changes: "changes who may join it" },
  "m.room.encryption": { title: "Change the encryption of {room}?", changes: "changes how its messages are encrypted", note: "Encryption cannot be turned off again." },
  "m.room.history_visibility": { title: "Change who may read the history of {room}?", changes: "changes who may read its history" },
  "m.room.guest_access": { title: "Change the guest access of {room}?", changes: "changes whether guests may join it" },
  "m.room.server_acl": { title: "Change the server ACL of {room}?", changes: "changes which servers may take part in it", note: "A wrong list can lock out your own server." },
  "m.room.tombstone": { title: "Mark {room} as replaced?", changes: "sends its members to another room", note: "It cannot be undone." },
  "m.room.create": { title: "Send a create event to {room}?", changes: "would change how the room was created", note: "The homeserver is expected to refuse it." },
  "m.room.canonical_alias": { title: "Change the address of {room}?", changes: "changes its published address" },
};

/**
 * Whether a state event the Dev tools send to a real room asks first, and with which title and
 * text: a type of `ROOM_CONFIGURATION_TYPES`, another user's `m.room.member`, and a widget event
 * that replaces a widget of the room (`widgetEvents` unknown: it may). `undefined`: sent at once.
 * leaf roomtools/confirm
 */
export function roomChangeConfirmation(event: MockedStateEvent, room: { userId: string; name: string; widgetEvents?: StateEvent[] }): { title: string; body: string } | undefined {
  const sentAs = `This ${event.type} event is sent to the room as ${room.userId} and`;
  const configuration = ROOM_CONFIGURATION_TYPES.includes(event.type) ? CONFIGURATION[event.type] : undefined;
  if (configuration) {
    return { title: configuration.title.replace("{room}", room.name), body: `${sentAs} ${configuration.changes}, for everyone.${configuration.note ? ` ${configuration.note}` : ""}` };
  }
  if (event.type === "m.room.member" && event.stateKey !== room.userId) {
    return { title: `Change the membership of ${event.stateKey} in ${room.name}?`, body: `${sentAs} changes the membership of another user (an invite, a kick or a ban), for everyone.` };
  }
  if (WIDGET_EVENT_TYPES.includes(event.type)) {
    if (!room.widgetEvents) return { title: `Replace a widget in ${room.name}?`, body: "The widgets of the room are still loading, so this may replace one of them. Everyone in the room gets the new one instead." };
    const existing = room.widgetEvents.find((e) => e.type === event.type && e.state_key === event.stateKey && describesWidget(e));
    if (existing) {
      const name = typeof existing.content.name === "string" && existing.content.name ? existing.content.name : existing.state_key;
      return { title: `Replace ${name} in ${room.name}?`, body: "The room already has a widget with this type and ID. Everyone in the room gets the new one instead." };
    }
  }
  return undefined;
}

/** Change the delayed events an account scheduled in a room from the Dev tools (`RoomToolsViewModel.scheduled`). An empty list is dropped. */
export function changeScheduled(vm: RoomToolsViewModel, accountId: AccountId, roomId: RoomId, change: (scheduled: ScheduledEvent[]) => ScheduledEvent[]): RoomToolsViewModel {
  const { [accountId]: rooms = {}, ...accounts } = vm.scheduled;
  const { [roomId]: list = [], ...others } = rooms;
  const changed = change(list);
  const nextRooms = changed.length ? { ...others, [roomId]: changed } : others;
  return { ...vm, scheduled: Object.keys(nextRooms).length ? { ...accounts, [accountId]: nextRooms } : accounts };
}

/** An account was logged out (or its login is gone): its picked room and what it scheduled are forgotten. */
export function withoutAccount(vm: RoomToolsViewModel, accountId: AccountId): RoomToolsViewModel {
  const { [accountId]: _picked, ...selectedRoomIds } = vm.selectedRoomIds;
  const { [accountId]: _scheduled, ...scheduled } = vm.scheduled;
  return { ...vm, selectedRoomIds, scheduled };
}

/** A delayed event was restarted: its delay counts from `now` again. */
export const restartScheduled = (list: ScheduledEvent[], delayId: string, now: number): ScheduledEvent[] =>
  list.map((s) => (s.delayId === delayId ? { ...s, restarts: s.restarts + 1, scheduledAt: now } : s));

/** Sent, cancelled, or its delay has passed (`scheduledAt` given: only if it was not restarted since). */
export const dropScheduled = (list: ScheduledEvent[], delayId: string, scheduledAt?: number): ScheduledEvent[] =>
  list.filter((s) => s.delayId !== delayId || (scheduledAt !== undefined && s.scheduledAt !== scheduledAt));
