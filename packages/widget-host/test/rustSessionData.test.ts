/**
 * What the AccountView, the RoomOverviewTab and "Copy to DevBackend" read from a matrix-rust-sdk
 * client (`src/matrix_session/rust/roomData`), on a faked client and room. The SDK's wasm module
 * is loaded because its enums and event type conversions live there.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EncryptionState, MembershipState, PowerLevel, type ClientLike, type RoomLike, type RoomMember, type RoomStateEvent } from "matrix-sdk-uniffi-js";

import initSdkWasm from "../../matrix-sdk-uniffi-js/src/generated/wasm-bindgen/index.js";
import * as sdkFfi from "../../matrix-sdk-uniffi-js/src/generated/matrix_sdk_ffi";
import * as rumaEvents from "../../matrix-sdk-uniffi-js/src/generated/ruma_events";
import { accountInfo, exportRoom, LOAD_MEMBERS_UP_TO, roomDetails } from "../src/matrix_session/rust/roomData";

const require = createRequire(import.meta.url);
await initSdkWasm({ module_or_path: readFileSync(require.resolve("../../matrix-sdk-uniffi-js/src/generated/wasm-bindgen/index_bg.wasm")) });
rumaEvents.default.initialize();
sdkFfi.default.initialize();

const ROOM = "!room:example.org";
const USER = "@alice:example.org";

const member = (userId: string, power: bigint | "infinite", displayName?: string, joined = true): RoomMember =>
  ({
    userId,
    displayName,
    avatarUrl: displayName ? `mxc://example.org/${displayName}` : undefined,
    membership: joined ? new MembershipState.Join() : new MembershipState.Leave(),
    powerLevel: power === "infinite" ? new PowerLevel.Infinite() : new PowerLevel.Value({ value: power }),
  }) as unknown as RoomMember;

const stored = (type: string, stateKey: string, content: unknown, eventId?: string): RoomStateEvent => ({
  eventType: rumaEvents.stateEventTypeFromString(type),
  stateKey,
  sender: USER,
  contentJson: JSON.stringify(content),
  eventId,
  timestamp: eventId ? 7n : undefined,
});

function fakeSdk(options: { joinedCount?: number; encryption?: EncryptionState; events?: Record<string, unknown>[]; older?: Record<string, unknown>[] } = {}) {
  const calls: string[] = [];
  const members = [member("@carol:example.org", 0n), member(USER, "infinite", "Alice"), member("@bob:example.org", 50n, "Bob"), member("@gone:example.org", 100n, "Gone", false)];
  const iterator = () => {
    let done = false;
    return { len: () => members.length, nextChunk: () => (done ? undefined : ((done = true), members)) };
  };
  const cached = (options.events ?? []).map((ev) => JSON.stringify(ev));
  const state = new Map<string, RoomStateEvent[]>([
    ["m.room.name", [stored("m.room.name", "", { name: "Widgets" }, "$name")]],
    ["m.policy.rule.user", [stored("m.policy.rule.user", "key", { a: 1 })]],
  ]);
  const room = {
    id: () => ROOM,
    displayName: () => "Widgets",
    topic: () => "About widgets",
    joinedMembersCount: () => BigInt(options.joinedCount ?? 3),
    encryptionState: () => options.encryption ?? EncryptionState.Encrypted,
    latestEncryptionState: async () => (calls.push("latestEncryptionState"), EncryptionState.NotEncrypted),
    members: async () => (calls.push("members"), iterator()),
    membersNoSync: async () => (calls.push("membersNoSync"), iterator()),
    eventsRaw: async () => cached,
    paginateEventsRawBackwards: async (count: number) => {
      calls.push(`paginate ${count}`);
      cached.unshift(...(options.older ?? []).map((ev) => JSON.stringify(ev)));
      return true;
    },
    // By the enum tag of the type, like the SDK's store: this fake has no state of custom types.
    stateEvents: async (type: rumaEvents.StateEventType) => (type.tag === "Custom" ? [] : ([...state.entries()].find(([key]) => rumaEvents.stateEventTypeFromString(key).tag === type.tag)?.[1] ?? [])),
  } as unknown as RoomLike;
  const client = {
    userId: () => USER,
    deviceId: () => "DEVICE",
    homeserver: () => "https://hs.example.org/",
    session: () => ({ accessToken: "token-1" }),
    displayName: async () => (calls.push("displayName"), "Alice"),
    avatarUrl: async () => (calls.push("avatarUrl"), "mxc://example.org/alice"),
    cachedAvatarUrl: async () => "mxc://example.org/cached",
    accountUrl: async () => (calls.push("accountUrl"), "https://auth.example.org/account"),
  } as unknown as ClientLike;
  return { client, room, calls };
}

afterEach(() => vi.unstubAllGlobals());

describe("matrix-rust-sdk session data", () => {
  it("account: profile, homeserver, device and the account page", async () => {
    const { client } = fakeSdk();
    expect(await accountInfo(client)).toEqual({
      userId: USER,
      displayName: "Alice",
      avatarUrl: "mxc://example.org/alice",
      homeserver: "https://hs.example.org/",
      deviceId: "DEVICE",
      manageUrl: "https://auth.example.org/account",
    });
  });

  it("account: makes no request while suspended", async () => {
    const { client, calls } = fakeSdk();
    expect(await accountInfo(client, false)).toEqual({
      userId: USER,
      displayName: undefined,
      avatarUrl: "mxc://example.org/cached",
      homeserver: "https://hs.example.org/",
      deviceId: "DEVICE",
      manageUrl: undefined,
    });
    expect(calls).toEqual([]);
  });

  it("roomDetails: topic, encryption, member count and the joined members with their roles", async () => {
    const { room, calls } = fakeSdk();
    expect(await roomDetails(room)).toEqual({
      topic: "About widgets",
      encrypted: true,
      memberCount: 3,
      members: [
        { userId: USER, displayName: "Alice", avatarUrl: "mxc://example.org/Alice", role: "Admin" },
        { userId: "@bob:example.org", displayName: "Bob", avatarUrl: "mxc://example.org/Bob", role: "Moderator" },
        { userId: "@carol:example.org", displayName: undefined, avatarUrl: undefined, role: undefined },
      ],
    });
    expect(calls).toEqual(["members"]);
  });

  it("roomDetails: reads only the store for a big room or while suspended, and leaves an unknown encryption state unknown", async () => {
    const big = fakeSdk({ joinedCount: LOAD_MEMBERS_UP_TO + 1, encryption: EncryptionState.Unknown });
    expect((await roomDetails(big.room)).encrypted).toBe(false);
    expect(big.calls).toEqual(["latestEncryptionState", "membersNoSync"]);

    const suspended = fakeSdk({ encryption: EncryptionState.Unknown });
    expect((await roomDetails(suspended.room, false)).encrypted).toBeUndefined();
    expect(suspended.calls).toEqual(["membersNoSync"]);
  });

  it("exportRoom: the whole state from the homeserver and the last events, oldest first", async () => {
    const serverState = [{ type: "m.room.name", state_key: "", content: { name: "Widgets" }, sender: USER, event_id: "$name" }];
    const requests: { url: string; authorization: string | null }[] = [];
    vi.stubGlobal("fetch", async (input: URL | string, init: RequestInit = {}) => {
      requests.push({ url: String(input), authorization: new Headers(init.headers).get("Authorization") });
      return new Response(JSON.stringify(serverState));
    });
    const { client, room, calls } = fakeSdk({
      events: [{ type: "m.room.message", event_id: "$3", content: {} }],
      older: [{ type: "m.room.message", event_id: "$1", content: {} }, { type: "m.room.message", event_id: "$2", content: {} }],
    });

    const exported = await exportRoom(client, room, 2);
    expect(exported).toMatchObject({ roomId: ROOM, name: "Widgets", state: serverState });
    expect(exported.timeline.map((ev) => ev.event_id)).toEqual(["$2", "$3"]);
    expect(calls).toEqual(["paginate 1"]);
    expect(requests).toEqual([{ url: `https://hs.example.org/_matrix/client/v3/rooms/${encodeURIComponent(ROOM)}/state`, authorization: "Bearer token-1" }]);
  });

  it("exportRoom: while suspended, the stored state of the known types and of those in the timeline, and no request", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    const { client, room, calls } = fakeSdk({ events: [{ type: "m.policy.rule.user", state_key: "key", event_id: "$c", content: { a: 1 } }] });

    const exported = await exportRoom(client, room, 5, false);
    expect(exported.state).toEqual([
      { type: "m.room.name", state_key: "", sender: USER, content: { name: "Widgets" }, event_id: "$name", origin_server_ts: 7 },
      { type: "m.policy.rule.user", state_key: "key", sender: USER, content: { a: 1 } },
    ]);
    expect(exported.timeline.map((ev) => ev.event_id)).toEqual(["$c"]);
    expect(fetched).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });
});
