import { EncryptionState, MembershipState_Tags, PowerLevel_Tags, stateEventTypeFromString, type ClientLike, type RoomLike, type RoomMember as SdkRoomMember } from "matrix-sdk-uniffi-js";

import type { AccountInfo, RawEvent, RoomDetails, RoomExport, RoomMember } from "../../session";
import { WIDGET_EVENT_TYPES } from "../../widgetStateEvent";

/**
 * What the AccountView, the RoomOverview, the RoomTimeline and "Copy to DevBackend" read from a matrix-rust-sdk
 * client. Functions of the client and the room, apart from the session, so they can be tested
 * with faked ones. `online: false` (the session is suspended) keeps them to what the SDK has in
 * its store, as far as the bindings say which calls make a request.
 */

/** How many members `roomDetails` returns. */
export const MEMBER_LIMIT = 30;
/** Up to this many joined members, `roomDetails` loads the whole member list from the homeserver. */
export const LOAD_MEMBERS_UP_TO = 500;
const MEMBER_CHUNK = 500;
/** How many events one pagination of `exportRoom` asks for, and how many it makes at most. */
const EXPORT_PAGE_SIZE = 100;
const EXPORT_MAX_PAGES = 20;

/**
 * The state event types `exportRoom` reads from the SDK's store when the homeserver cannot be
 * asked for the whole state: the store can only be read by type.
 */
export const KNOWN_STATE_TYPES = [
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

export function roleFor(powerLevel: number): string | undefined {
  if (powerLevel >= 100) return "Admin";
  if (powerLevel >= 50) return "Moderator";
  return undefined;
}

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

  // TODO-FINDING room-details-member-loading - showing the "first 30" members sorted by role needs the whole member list, one /members request that is large in big rooms. Options: always load, never load (show whoever the SDK has stored), load up to a size. Done: load when the room has at most LOAD_MEMBERS_UP_TO (500) joined members, else show the stored ones.
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
 * Call `listener` when a sync adds events to the room. The SDK reports nothing else (a pagination
 * resolves `loadOlderEvents`); a redaction arrives as an event, so it is seen too.
 */
// TODO-FINDING rust-late-decryption-not-reported - `subscribeToEventsRaw` reports the events a sync appends, not an event the event cache replaces in place (decrypted late, when its room key arrives after the event; or redacted). The RoomTimeline shows such an event as it was until the next sync of the room adds an event. Options: an SDK addition that also reports replaced events, or re-reading the timeline on a timer. Not verified against a homeserver: when the SDK decrypts late, and whether a redaction redacts the cached event before the redaction event is reported.
export function onTimelineChanged(room: RoomLike, listener: () => void): () => void {
  const handle = room.subscribeToEventsRaw({ onEvents: () => listener() });
  return () => handle.cancel();
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

  // TODO-FINDING rust-export-state - the bindings read state by event type only (`Room::state_events`), there is no "all current state". Options: (a) ask the homeserver directly with the session's access token (`GET /rooms/{id}/state`, like the TURN request in backend/turnServer.ts; bypasses the SDK, so an expired token is not refreshed), (b) read a fixed list of types from the store (incomplete: unknown custom types are missed, and rooms without the full-state subscription have little state stored), (c) add `Room::state_raw` to the Rust patches. Done: (a), and (b) plus the state types seen in the exported timeline when the request fails or the session is suspended.
  let state: RawEvent[] | undefined;
  if (online) {
    state = await fetchState(client, roomId).catch((e: unknown) => {
      console.warn("reading the room state from the homeserver failed, exporting what the SDK has stored", e);
      return undefined;
    });
  }
  state ??= await storedState(room, [...KNOWN_STATE_TYPES, ...timeline.filter((event) => typeof event.state_key === "string").map((event) => event.type)]);

  return { roomId, name: room.displayName() ?? roomId, state, timeline };
}
