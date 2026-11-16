import { type MatrixClient, type MatrixEvent, type Room } from "matrix-js-sdk";

import type { AccountInfo, RawEvent, RoomDetails, RoomExport, RoomMember } from "../../session";

/**
 * What the AccountView, the RoomOverview and "Copy to DevBackend" read from a matrix-js-sdk
 * client. Functions of the client, apart from the session, so they can be tested with a faked one.
 * Everything a request fails for (the session may be suspended or offline) falls back to what the
 * client has locally.
 */

/** How many members `roomDetails` returns. */
export const MEMBER_LIMIT = 30;
/** Up to this many joined members, `roomDetails` loads the whole member list from the homeserver. */
export const LOAD_MEMBERS_UP_TO = 500;
/** How many events one pagination request of `exportRoom` asks for. */
const EXPORT_PAGE_SIZE = 100;
/** How many pagination requests `exportRoom` makes at most. */
const EXPORT_MAX_PAGES = 20;

export function roleFor(powerLevel: number): string | undefined {
  if (powerLevel >= 100) return "Admin";
  if (powerLevel >= 50) return "Moderator";
  return undefined;
}

function knownRoom(client: MatrixClient, roomId: string): Room {
  const room = client.getRoom(roomId);
  if (!room) throw new Error(`unknown room ${roomId}`);
  return room;
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
  // TODO-FINDING room-details-member-loading - showing the "first 30" members sorted by role needs the whole member list, one /members request that is large in big rooms. Options: always load, never load (show whoever the lazy-loading sync delivered), load up to a size. Done: load when the room has at most LOAD_MEMBERS_UP_TO (500) joined members, else show the locally known ones.
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
// TODO-FINDING export-decrypted-events - exportRoom hands out timeline events decrypted (type and content in the clear, as widgets see them); an event that could not be decrypted stays `m.room.encrypted`. The alternative is the events as the homeserver has them. Done: decrypted, because the DevBackend room is not encrypted.
const raw = (event: MatrixEvent): RawEvent => ({ ...event.getEffectiveEvent() }) as unknown as RawEvent;

export async function exportRoom(client: MatrixClient, roomId: string, lastEvents: number): Promise<RoomExport> {
  const room = knownRoom(client, roomId);

  // The whole state from the homeserver: the lazy-loading sync leaves most member events out.
  let state: RawEvent[];
  try {
    state = (await client.roomState(roomId)) as unknown as RawEvent[];
  } catch (e) {
    console.warn("reading the room state from the homeserver failed, exporting the local copy", e);
    state = [...room.currentState.events.values()].flatMap((byStateKey) => [...byStateKey.values()]).map(raw);
  }

  const timeline = room.getLiveTimeline();
  // Not the local echo of something still being sent.
  const events = () => timeline.getEvents().filter((event) => !event.status);
  try {
    for (let page = 0; events().length < lastEvents && page < EXPORT_MAX_PAGES; page++) {
      const more = await client.paginateEventTimeline(timeline, { backwards: true, limit: Math.min(EXPORT_PAGE_SIZE, lastEvents - events().length) });
      if (!more) break;
    }
  } catch (e) {
    console.warn("loading older events failed, exporting the ones at hand", e);
  }

  return { roomId, name: room.name || roomId, state, timeline: lastEvents > 0 ? events().slice(-lastEvents).map(raw) : [] };
}
