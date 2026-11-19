import { EventTimeline, MatrixEventEvent, RoomEvent, type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

import type { AccountInfo, RawEvent, RoomDetails, RoomExport, RoomMember } from "../../session";
import { EXPORT_MAX_PAGES, EXPORT_PAGE_SIZE, LOAD_MEMBERS_UP_TO, MEMBER_LIMIT, roleFor } from "../shared";

/**
 * What the views read from a matrix-js-sdk client (`LiveSession`), as free functions so tests can
 * fake the client. A failed request (suspended, offline) falls back to what the client has locally.
 */

function knownRoom(client: MatrixClient, roomId: string): Room {
  const room = client.getRoom(roomId);
  if (!room) throw new Error(`unknown room ${roomId}`);
  return room;
}

/**
 * Paginate `limit` older events into `timeline`. Resolves whether there may be more. Once the start
 * is reached the SDK drops the token, and a pagination without one would ask for the newest events.
 */
function paginateBack(client: MatrixClient, timeline: EventTimeline, limit: number): Promise<boolean> {
  if (timeline.getPaginationToken(EventTimeline.BACKWARDS) === null) return Promise.resolve(false);
  return client.paginateEventTimeline(timeline, { backwards: true, limit });
}

export async function accountInfo(client: MatrixClient): Promise<AccountInfo> {
  const userId = client.getSafeUserId();
  const [profile, auth] = await Promise.all([
    client.getProfileInfo(userId).catch(() => undefined),
    // Rejects when the homeserver has no OAuth 2.0 authorization server (a password login): no account page then.
    client.getAuthMetadata().catch(() => undefined),
  ]);
  // What the sync has told about the own user, when the profile cannot be asked for.
  const user = profile ? undefined : client.getUser(userId);
  return {
    userId,
    displayName: profile?.displayname ?? user?.displayName ?? undefined,
    avatarUrl: profile?.avatar_url ?? user?.avatarUrl ?? undefined,
    homeserver: client.getHomeserverUrl(),
    deviceId: client.getDeviceId() ?? undefined,
    manageUrl: auth?.account_management_uri,
  };
}

export async function roomDetails(client: MatrixClient, roomId: string): Promise<RoomDetails> {
  const room = knownRoom(client, roomId);
  const memberCount = room.getJoinedMemberCount();
  // The client syncs with lazy loading: without this it only knows the members who wrote recently.
  if (memberCount <= LOAD_MEMBERS_UP_TO) await room.loadMembersIfNeeded().catch((e: unknown) => console.warn("loading the room members failed", e));

  const members: RoomMember[] = room
    .getJoinedMembers()
    .sort((a, b) => b.powerLevel - a.powerLevel || a.name.localeCompare(b.name))
    .slice(0, MEMBER_LIMIT)
    .map((member) => ({
      userId: member.userId,
      // Without a display name the SDK puts the user id there.
      displayName: member.rawDisplayName && member.rawDisplayName !== member.userId ? member.rawDisplayName : undefined,
      avatarUrl: member.getMxcAvatarUrl() ?? undefined,
      role: roleFor(member.powerLevel),
    }));

  const topic: unknown = room.currentState.getStateEvents("m.room.topic", "")?.getContent().topic;
  return { topic: typeof topic === "string" && topic ? topic : undefined, encrypted: room.hasEncryptionStateEvent(), memberCount, members };
}

/** The event as JSON: decrypted where the client could decrypt it. */
// TODO-FINDING export-decrypted-events - exported events are decrypted (the DevBackend room is not encrypted); an undecryptable one stays `m.room.encrypted`.
const raw = (event: MatrixEvent): RawEvent => ({ ...event.getEffectiveEvent() }) as unknown as RawEvent;

/**
 * The whole current state of a room (the Dev tools, "Copy to DevBackend"): from the homeserver, as
 * the lazy-loading sync leaves most member events out; the local copy if that fails (while
 * suspended, `./fetchGate` refuses the request).
 */
export async function roomState(client: MatrixClient, roomId: string): Promise<RawEvent[]> {
  const room = knownRoom(client, roomId);
  try {
    return (await client.roomState(roomId)) as unknown as RawEvent[];
  } catch (e) {
    console.warn("reading the room state from the homeserver failed, using the local copy", e);
    return [...room.currentState.events.values()].flatMap((byStateKey) => [...byStateKey.values()]).map(raw);
  }
}

export async function exportRoom(client: MatrixClient, roomId: string, lastEvents: number): Promise<RoomExport> {
  const room = knownRoom(client, roomId);
  const state = await roomState(client, roomId);

  const timeline = room.getLiveTimeline();
  // Not the local echo of something still being sent.
  const events = () => timeline.getEvents().filter((event) => !event.status);
  try {
    for (let page = 0; events().length < lastEvents && page < EXPORT_MAX_PAGES; page++) {
      const more = await paginateBack(client, timeline, Math.min(EXPORT_PAGE_SIZE, lastEvents - events().length));
      if (!more) break;
    }
  } catch (e) {
    console.warn("loading older events failed, exporting the ones at hand", e);
  }

  return { roomId, name: room.name || roomId, state, timeline: lastEvents > 0 ? events().slice(-lastEvents).map(raw) : [] };
}

/** An event of the RoomTimeline: decrypted where the client could; one it could not decrypt as it arrived (`m.room.encrypted`), not the SDK's "Unable to decrypt" message. */
const timelineRaw = (event: MatrixEvent): RawEvent => (event.isDecryptionFailure() ? ({ ...event.event } as unknown as RawEvent) : raw(event));

/** The events of a room's live timeline, oldest first (the RoomTimeline); no local echoes of what is still being sent. */
export function timelineEvents(client: MatrixClient, roomId: string): RawEvent[] {
  return knownRoom(client, roomId)
    .getLiveTimeline()
    .getEvents()
    .filter((event) => !event.status)
    .map(timelineRaw);
}

/** Load up to `count` older events into the live timeline. Resolves whether the start of the room is reached. */
export async function loadOlderEvents(client: MatrixClient, roomId: string, count: number): Promise<boolean> {
  return !(await paginateBack(client, knownRoom(client, roomId).getLiveTimeline(), count));
}

/**
 * Call `listener` whenever `timelineEvents(roomId)` may have changed: an event was added (also by
 * a pagination), redacted, decrypted, or a local echo was sent; `reset` when a gap in the sync
 * replaced the live timeline (the older events are gone).
 */
export function onTimelineChanged(client: MatrixClient, roomId: string, listener: (reset?: boolean) => void): () => void {
  const ofRoom = (room: Room | undefined) => {
    if (room?.roomId === roomId) listener();
  };
  const onEvent = (event: MatrixEvent) => {
    if (event.getRoomId() === roomId) listener();
  };
  const onReset = (room: Room | undefined) => {
    if (room?.roomId === roomId) listener(true);
  };
  const onTimeline = (_event: MatrixEvent, room: Room | undefined) => ofRoom(room);
  const onRoomEvent = (_event: MatrixEvent, room: Room) => ofRoom(room);
  client.on(RoomEvent.Timeline, onTimeline);
  client.on(RoomEvent.Redaction, onRoomEvent);
  client.on(RoomEvent.LocalEchoUpdated, onRoomEvent);
  client.on(RoomEvent.TimelineReset, onReset);
  client.on(MatrixEventEvent.Decrypted, onEvent);
  return () => {
    client.off(RoomEvent.Timeline, onTimeline);
    client.off(RoomEvent.Redaction, onRoomEvent);
    client.off(RoomEvent.LocalEchoUpdated, onRoomEvent);
    client.off(RoomEvent.TimelineReset, onReset);
    client.off(MatrixEventEvent.Decrypted, onEvent);
  };
}
