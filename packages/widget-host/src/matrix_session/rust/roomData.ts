import { EncryptionState, MembershipState_Tags, PowerLevel_Tags, stateEventTypeFromString, type ClientLike, type RoomLike, type RoomMember as SdkRoomMember } from "matrix-sdk-uniffi-js";

import type { AccountInfo, RawEvent, RoomDetails, RoomExport, RoomMember } from "../../session";
import { WIDGET_EVENT_TYPES } from "../../widgetStateEvent";
import { EXPORT_MAX_PAGES, EXPORT_PAGE_SIZE, LOAD_MEMBERS_UP_TO, MEMBER_LIMIT, roleFor } from "../shared";

/**
 * What the views read from a matrix-rust-sdk client (`LiveSession`), as free functions so tests can
 * fake the client. `online: false` (suspended) keeps them to the SDK's store, as far as the
 * bindings say which calls make a request.
 */

const MEMBER_CHUNK = 500;

/**
 * The state event types `roomState` reads from the SDK's store when the homeserver cannot be
 * asked for the whole state: the store can only be read by type.
 */
const KNOWN_STATE_TYPES = [
  "m.room.create",
  "m.room.member",
  "m.room.power_levels",
  "m.room.join_rules",
  "m.room.history_visibility",
  "m.room.guest_access",
  "m.room.name",
  "m.room.topic",
  "m.room.avatar",
  "m.room.canonical_alias",
  "m.room.encryption",
  "m.room.pinned_events",
  "m.room.server_acl",
  "m.room.tombstone",
  "m.room.third_party_invite",
  "m.space.child",
  "m.space.parent",
  "org.matrix.msc3401.call.member",
  ...WIDGET_EVENT_TYPES,
];

/** A room creator of room version 12 has infinite power. */
const powerOf = (member: SdkRoomMember): number => (member.powerLevel.tag === PowerLevel_Tags.Value ? Number(member.powerLevel.inner.value) : Infinity);

const orUndefined = <T>(promise: Promise<T>): Promise<T | undefined> => promise.catch(() => undefined);

export async function accountInfo(client: ClientLike, online = true): Promise<AccountInfo> {
  const [displayName, avatarUrl, manageUrl] = await Promise.all([
    online ? orUndefined(client.displayName()) : undefined,
    online ? orUndefined(client.avatarUrl()).then((url) => url ?? orUndefined(client.cachedAvatarUrl())) : orUndefined(client.cachedAvatarUrl()),
    // The account page of the OAuth 2.0 authorization server; none (or an error) for a password login.
    online ? orUndefined(client.accountUrl(undefined)) : undefined,
  ]);
  let deviceId: string | undefined;
  try {
    deviceId = client.deviceId();
  } catch {
    // Unknown.
  }
  return { userId: client.userId(), displayName: displayName || undefined, avatarUrl, homeserver: client.homeserver(), deviceId, manageUrl };
}

export async function roomDetails(room: RoomLike, online = true): Promise<RoomDetails> {
  const memberCount = Number(room.joinedMembersCount());

  let encryption = room.encryptionState();
  // Not known until the SDK has asked the homeserver once.
  if (encryption === EncryptionState.Unknown && online) encryption = await room.latestEncryptionState().catch(() => EncryptionState.Unknown);

  const iterator = await (online && memberCount <= LOAD_MEMBERS_UP_TO ? room.members().catch(() => room.membersNoSync()) : room.membersNoSync()).catch((e: unknown) => {
    console.warn("reading the room members failed", e);
    return undefined;
  });
  const joined: SdkRoomMember[] = [];
  for (let chunk = iterator?.nextChunk(MEMBER_CHUNK); chunk && chunk.length > 0; chunk = iterator?.nextChunk(MEMBER_CHUNK)) {
    joined.push(...chunk.filter((member) => member.membership.tag === MembershipState_Tags.Join));
  }
  const members: RoomMember[] = joined
    .sort((a, b) => powerOf(b) - powerOf(a) || (a.displayName ?? a.userId).localeCompare(b.displayName ?? b.userId))
    .slice(0, MEMBER_LIMIT)
    .map((member) => ({ userId: member.userId, displayName: member.displayName, avatarUrl: member.avatarUrl, role: roleFor(powerOf(member)) }));

  return {
    topic: room.topic() || undefined,
    encrypted: encryption === EncryptionState.Unknown ? undefined : encryption === EncryptionState.Encrypted,
    memberCount,
    members: iterator ? members : undefined,
  };
}

/**
 * The events the SDK's event cache holds of a room, oldest first (the RoomTimeline): every kind,
 * state events included, decrypted where it could; one it could not decrypt stays `m.room.encrypted`.
 */
export async function timelineEvents(room: RoomLike): Promise<RawEvent[]> {
  return (await room.eventsRaw()).map((json) => JSON.parse(json) as RawEvent);
}

/** Load up to `count` older events into the event cache (from its store or the homeserver). Resolves whether the start of the room is reached. */
export function loadOlderEvents(room: RoomLike, count: number): Promise<boolean> {
  return room.paginateEventsRawBackwards(count);
}

/**
 * Call `listener` when a sync adds events to the room, when the event cache replaces events it
 * decrypted late, and with `reset` when it dropped its events (`subscribeToTimelineChangesRaw`, an
 * addition to the ffi). A pagination resolves `loadOlderEvents` instead.
 */
// TODO-FINDING rust-late-decryption-not-reported - a redaction the event cache applies in place is not reported.
export function onTimelineChanged(room: RoomLike, listener: (reset?: boolean) => void): () => void {
  const events = room.subscribeToEventsRaw({ onEvents: () => listener() });
  const changes = room.subscribeToTimelineChangesRaw({ onReset: () => listener(true), onDecrypted: () => listener() });
  return () => {
    changes.cancel();
    events.cancel();
  };
}

/** The whole current state of a room, as the homeserver answers `GET /rooms/{roomId}/state`. */
async function fetchState(client: ClientLike, roomId: string): Promise<RawEvent[]> {
  const url = `${client.homeserver().replace(/\/+$/, "")}/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/state`;
  const response = await fetch(url, { headers: { Authorization: `Bearer ${client.session().accessToken}` } });
  if (!response.ok) throw new Error(`the homeserver answered ${response.status}`);
  const state: unknown = await response.json();
  if (!Array.isArray(state)) throw new Error("the homeserver did not answer with a list of events");
  return state as RawEvent[];
}

/** The state the SDK has stored of the given types. Without the full-state subscription of the room that is only what the room list needs. */
async function storedState(room: RoomLike, types: Iterable<string>): Promise<RawEvent[]> {
  const perType = await Promise.all(
    Array.from(new Set(types), async (type) =>
      (await room.stateEvents(stateEventTypeFromString(type)).catch(() => [])).map(
        (event): RawEvent => ({
          type,
          state_key: event.stateKey,
          sender: event.sender,
          content: JSON.parse(event.contentJson) as Record<string, unknown>,
          // Only missing for a room we are invited to.
          ...(event.eventId === undefined ? {} : { event_id: event.eventId }),
          ...(event.timestamp === undefined ? {} : { origin_server_ts: Number(event.timestamp) }),
        }),
      ),
    ),
  );
  return perType.flat();
}

/**
 * The whole current state of a room (the Dev tools, "Copy to DevBackend"): from the homeserver, or
 * (suspended, or the request failed) what the SDK has stored of `KNOWN_STATE_TYPES` and of the
 * state types among the events of its event cache.
 */
export async function roomState(client: ClientLike, room: RoomLike, online = true): Promise<RawEvent[]> {
  // TODO-FINDING rust-export-state - the bindings read state by type only; `/state` is asked directly (no token refresh), the store is the fallback.
  if (online) {
    const state = await fetchState(client, room.id()).catch((e: unknown) => {
      console.warn("reading the room state from the homeserver failed, using what the SDK has stored", e);
      return undefined;
    });
    if (state) return state;
  }
  const cached = await timelineEvents(room).catch(() => [] as RawEvent[]);
  return storedState(room, [...KNOWN_STATE_TYPES, ...cached.filter((event) => typeof event.state_key === "string").map((event) => event.type)]);
}

export async function exportRoom(client: ClientLike, room: RoomLike, lastEvents: number, online = true): Promise<RoomExport> {
  const roomId = room.id();

  // The event cache: decrypted events, oldest first; an event that could not be decrypted stays `m.room.encrypted`.
  let cached = await room.eventsRaw().catch(() => [] as string[]);
  if (online) {
    try {
      for (let page = 0; cached.length < lastEvents && page < EXPORT_MAX_PAGES; page++) {
        const reachedStart = await room.paginateEventsRawBackwards(Math.min(EXPORT_PAGE_SIZE, lastEvents - cached.length));
        cached = await room.eventsRaw();
        if (reachedStart) break;
      }
    } catch (e) {
      console.warn("loading older events failed, exporting the ones at hand", e);
    }
  }
  const timeline = lastEvents > 0 ? cached.slice(-lastEvents).map((json) => JSON.parse(json) as RawEvent) : [];
  return { roomId, name: room.displayName() ?? roomId, state: await roomState(client, room, online), timeline };
}
