/**
 * The parts of the matrix-js-sdk session that can run on a faked client: what the AccountView,
 * the RoomOverviewTab and "Copy to DevBackend" read (`src/matrix_session/js/roomData`), and the
 * gate that refuses requests while the session is suspended (`src/matrix_session/js/fetchGate`).
 */
import type { MatrixClient } from "matrix-js-sdk";
import { describe, expect, it, vi } from "vitest";

import { FetchGate, SuspendedError } from "../src/matrix_session/js/fetchGate";
import { accountInfo, exportRoom, LOAD_MEMBERS_UP_TO, MEMBER_LIMIT, roomDetails } from "../src/matrix_session/js/roomData";

const ROOM = "!room:example.org";
const USER = "@alice:example.org";

const event = (raw: Record<string, unknown>, status: string | null = null) => ({ status, getEffectiveEvent: () => raw, getContent: () => raw.content });
const member = (userId: string, powerLevel: number, name?: string, avatar?: string) => ({
  userId,
  powerLevel,
  name: name ?? userId,
  rawDisplayName: name ?? userId,
  getMxcAvatarUrl: () => avatar ?? null,
});

function fakeClient(options: { members?: ReturnType<typeof member>[]; joinedCount?: number; offline?: boolean; older?: Record<string, unknown>[][] } = {}) {
  const offline = () => Promise.reject(new Error("offline"));
  const members = options.members ?? [member(USER, 100, "Alice", "mxc://example.org/alice"), member("@bob:example.org", 50, "Bob"), member("@carol:example.org", 0)];
  const calls: string[] = [];
  const localState = [
    { type: "m.room.topic", state_key: "", content: { topic: "About widgets" }, sender: USER, event_id: "$topic" },
    { type: "m.room.member", state_key: USER, content: { membership: "join" }, sender: USER, event_id: "$alice" },
  ];
  const serverState = [...localState, { type: "m.room.member", state_key: "@bob:example.org", content: { membership: "join" }, sender: "@bob:example.org", event_id: "$bob", room_id: ROOM }];
  const timeline = [event({ type: "m.room.message", content: { body: "3" }, event_id: "$3" }), event({ type: "m.room.message", content: { body: "echo" } }, "sending")];
  const older = [...(options.older ?? [])];
  const liveTimeline = { getEvents: () => timeline };
  const room = {
    name: "Widgets",
    getJoinedMemberCount: () => options.joinedCount ?? members.length,
    loadMembersIfNeeded: async () => (calls.push("loadMembersIfNeeded"), true),
    getJoinedMembers: () => [...members],
    hasEncryptionStateEvent: () => true,
    getLiveTimeline: () => liveTimeline,
    currentState: {
      getStateEvents: (type: string, stateKey: string) => {
        const found = localState.find((ev) => ev.type === type && ev.state_key === stateKey);
        return found ? event(found) : null;
      },
      events: new Map([
        ["m.room.topic", new Map([["", event(localState[0]!)]])],
        ["m.room.member", new Map([[USER, event(localState[1]!)]])],
      ]),
    },
  };
  const client = {
    getSafeUserId: () => USER,
    getDeviceId: () => "DEVICE",
    getHomeserverUrl: () => "https://hs.example.org",
    getProfileInfo: () => (options.offline ? offline() : Promise.resolve({ displayname: "Alice", avatar_url: "mxc://example.org/alice" })),
    getAuthMetadata: () => (options.offline ? offline() : Promise.resolve({ account_management_uri: "https://auth.example.org/account" })),
    getUser: () => ({ displayName: "Alice (synced)", avatarUrl: undefined }),
    getRoom: (roomId: string) => (roomId === ROOM ? room : null),
    roomState: () => (options.offline ? offline() : Promise.resolve(serverState)),
    paginateEventTimeline: async (_timeline: unknown, opts: { backwards: boolean; limit: number }) => {
      calls.push(`paginate ${opts.limit}`);
      if (options.offline) throw new Error("offline");
      const page = older.shift();
      if (!page) return false;
      timeline.unshift(...page.map((raw) => event(raw)));
      return older.length > 0;
    },
  };
  return { client: client as unknown as MatrixClient, calls, serverState, localState };
}

describe("matrix-js-sdk session data", () => {
  it("account: profile, homeserver, device and the account page of the authorization server", async () => {
    expect(await accountInfo(fakeClient().client)).toEqual({
      userId: USER,
      displayName: "Alice",
      avatarUrl: "mxc://example.org/alice",
      homeserver: "https://hs.example.org",
      deviceId: "DEVICE",
      manageUrl: "https://auth.example.org/account",
    });
  });

  it("account: falls back to what the client knows when the homeserver does not answer", async () => {
    expect(await accountInfo(fakeClient({ offline: true }).client)).toEqual({
      userId: USER,
      displayName: "Alice (synced)",
      avatarUrl: undefined,
      homeserver: "https://hs.example.org",
      deviceId: "DEVICE",
      manageUrl: undefined,
    });
  });

  it("roomDetails: topic, encryption, member count and the members with their roles", async () => {
    const { client, calls } = fakeClient();
    expect(await roomDetails(client, ROOM)).toEqual({
      topic: "About widgets",
      encrypted: true,
      memberCount: 3,
      members: [
        { userId: USER, displayName: "Alice", avatarUrl: "mxc://example.org/alice", role: "Admin" },
        { userId: "@bob:example.org", displayName: "Bob", avatarUrl: undefined, role: "Moderator" },
        { userId: "@carol:example.org", displayName: undefined, avatarUrl: undefined, role: undefined },
      ],
    });
    expect(calls).toEqual(["loadMembersIfNeeded"]);
    await expect(roomDetails(client, "!other:example.org")).rejects.toThrow(/unknown room/);
  });

  it("roomDetails: caps the member list, the highest power levels first, and does not load the members of a big room", async () => {
    const members = Array.from({ length: 40 }, (_, i) => member(`@user${String(i).padStart(2, "0")}:example.org`, i === 39 ? 100 : 0));
    const { client, calls } = fakeClient({ members, joinedCount: LOAD_MEMBERS_UP_TO + 1 });
    const details = await roomDetails(client, ROOM);
    expect(details.memberCount).toBe(LOAD_MEMBERS_UP_TO + 1);
    expect(details.members).toHaveLength(MEMBER_LIMIT);
    expect(details.members![0]).toMatchObject({ userId: "@user39:example.org", role: "Admin" });
    expect(details.members![1]!.userId).toBe("@user00:example.org");
    expect(calls).toEqual([]);
  });

  it("exportRoom: the whole state from the homeserver and the last events, oldest first, without local echoes", async () => {
    const older = [[{ type: "m.room.message", content: { body: "1" }, event_id: "$1" }, { type: "m.room.message", content: { body: "2" }, event_id: "$2" }]];
    const { client, serverState, calls } = fakeClient({ older });
    const exported = await exportRoom(client, ROOM, 2);
    expect(exported.roomId).toBe(ROOM);
    expect(exported.name).toBe("Widgets");
    expect(exported.state).toEqual(serverState);
    expect(exported.timeline.map((ev) => ev.event_id)).toEqual(["$2", "$3"]);
    expect(calls).toEqual(["paginate 1"]);
  });

  it("exportRoom: exports the local copy when the homeserver does not answer", async () => {
    const { client, localState } = fakeClient({ offline: true });
    const exported = await exportRoom(client, ROOM, 10);
    expect(exported.state).toEqual(localState);
    expect(exported.timeline.map((ev) => ev.event_id)).toEqual(["$3"]);
    expect((await exportRoom(client, ROOM, 0)).timeline).toEqual([]);
  });
});

describe("FetchGate", () => {
  /** A `fetch` whose requests stay open until answered or aborted. */
  function network() {
    const open: { url: string; answer: () => void; aborted: boolean }[] = [];
    const inner = vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const request = { url: String(input), answer: () => resolve(new Response("{}")), aborted: false };
          open.push(request);
          init?.signal?.addEventListener("abort", () => {
            request.aborted = true;
            reject(new DOMException("aborted", "AbortError"));
          });
        }),
    );
    return { open, inner };
  }
  const SYNC = "https://hs.example.org/_matrix/client/v3/sync?timeout=30000";
  const SEND = "https://hs.example.org/_matrix/client/v3/rooms/!r/send/m.room.message/1";

  it("passes requests through until suspended, then refuses them without touching the network", async () => {
    const { open, inner } = network();
    const gate = new FetchGate(inner);
    const first = gate.fetch(SEND);
    open[0]!.answer();
    expect((await first).ok).toBe(true);

    gate.suspend();
    gate.suspend();
    expect(gate.suspended).toBe(true);
    await expect(gate.fetch(SEND)).rejects.toBeInstanceOf(SuspendedError);
    await expect(gate.fetch(SYNC)).rejects.toBeInstanceOf(SuspendedError);
    expect(inner).toHaveBeenCalledTimes(1);

    gate.resume();
    gate.resume();
    const again = gate.fetch(SYNC);
    open[1]!.answer();
    expect((await again).ok).toBe(true);
  });

  it("ends the sync long poll on suspend, as a lost connection, and lets a send in flight finish", async () => {
    const { open, inner } = network();
    const gate = new FetchGate(inner);
    const sync = gate.fetch(SYNC);
    const send = gate.fetch(SEND);
    gate.suspend();

    const failure = await sync.catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(SuspendedError);
    // Not an abort: the SDK would take that for its own doing.
    expect((failure as Error).name).not.toBe("AbortError");
    expect(open[0]!.aborted).toBe(true);
    expect(open[1]!.aborted).toBe(false);
    open[1]!.answer();
    expect((await send).ok).toBe(true);
  });

  it("still lets the SDK abort its own long poll", async () => {
    const { inner } = network();
    const gate = new FetchGate(inner);
    const controller = new AbortController();
    const sync = gate.fetch(SYNC, { signal: controller.signal });
    controller.abort();
    await expect(sync).rejects.toMatchObject({ name: "AbortError" });
  });
});
