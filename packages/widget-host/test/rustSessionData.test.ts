/**
 * What the AccountView, the RoomOverviewTab and "Copy to DevBackend" read from a matrix-rust-sdk
 * client (`src/matrix_session/rust/roomData`), and the device verification
 * (`src/matrix_session/rust/verification`), on a faked client and room. The SDK's wasm module
 * is loaded because its enums and event type conversions live there.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClientError,
  EncryptionState,
  MembershipState,
  RecoveryError,
  PowerLevel,
  SessionVerificationData,
  VerificationState,
  type ClientLike,
  type RoomLike,
  type RoomMember,
  type RoomStateEvent,
  type SessionVerificationControllerDelegate,
  type VerificationStateListener,
} from "matrix-sdk-uniffi-js";

import initSdkWasm from "../../matrix-sdk-uniffi-js/src/generated/wasm-bindgen/index.js";
import * as sdkFfi from "../../matrix-sdk-uniffi-js/src/generated/matrix_sdk_ffi";
import * as rumaEvents from "../../matrix-sdk-uniffi-js/src/generated/ruma_events";
import { accountInfo, exportRoom, LOAD_MEMBERS_UP_TO, roomDetails } from "../src/matrix_session/rust/roomData";
import { needsVerification, onVerificationChanged, startEmojiVerification, verifyWithRecoveryKey } from "../src/matrix_session/rust/verification";

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

/** A client whose encryption and session verification controller the test drives. */
function fakeVerifyingClient() {
  let state = VerificationState.Unverified;
  let delegate: SessionVerificationControllerDelegate | undefined;
  let listener: VerificationStateListener | undefined;
  const calls: string[] = [];
  const handle = { cancel: vi.fn(), isFinished: () => false };
  const encryption = {
    waitForE2eeInitializationTasks: async () => void calls.push("waitForE2eeInitializationTasks"),
    verificationState: () => state,
    verificationStateListener: (l: VerificationStateListener) => ((listener = l), handle),
    recover: async (key: string) => {
      calls.push(`recover ${key}`);
      // As the bindings throw it: the text is in `inner`, the message is only "RecoveryError.SecretStorage".
      if (key !== "EsTc") throw new RecoveryError.SecretStorage({ errorMessage: "The MAC check for the secret storage key failed" });
      state = VerificationState.Verified;
    },
  };
  const controller = {
    setDelegate: (d: SessionVerificationControllerDelegate) => (delegate = d),
    requestDeviceVerification: async () => void calls.push("requestDeviceVerification"),
    startSasVerification: vi.fn(async () => void calls.push("startSasVerification")),
    approveVerification: async () => void calls.push("approveVerification"),
    declineVerification: async () => void calls.push("declineVerification"),
    cancelVerification: async () => void calls.push("cancelVerification"),
    requestCancelInfo: () => ({ reason: "timed out", cancelCode: "m.timeout", cancelledByUs: false }),
    sasCancelInfo: (): { reason: string; cancelCode: string; cancelledByUs: boolean } | undefined => undefined,
  };
  const client = { encryption: () => encryption, getSessionVerificationController: async () => controller } as unknown as ClientLike;
  return {
    client,
    calls,
    controller,
    handle,
    delegate: () => delegate!,
    listener: () => listener!,
    setState: (value: VerificationState) => (state = value),
  };
}

const SAS = new SessionVerificationData.Emojis({
  emojis: [
    { symbol: () => "🐶", description: () => "Dog" },
    { symbol: () => "🔑", description: () => "Key" },
  ],
  indices: new ArrayBuffer(0),
});

describe("matrix-rust-sdk device verification", () => {
  it("needsVerification: once the SDK knows the cross-signing state, only an unverified device needs it", async () => {
    const fake = fakeVerifyingClient();
    expect(await needsVerification(fake.client)).toBe(true);
    expect(fake.calls).toEqual(["waitForE2eeInitializationTasks"]);
    fake.setState(VerificationState.Verified);
    expect(await needsVerification(fake.client)).toBe(false);
    fake.setState(VerificationState.Unknown);
    expect(await needsVerification(fake.client)).toBe(false);
  });

  it("onVerificationChanged: the SDK's verification state listener calls it; unsubscribing cancels its task", () => {
    const fake = fakeVerifyingClient();
    const changed = vi.fn();
    const unsubscribe = onVerificationChanged(fake.client, changed);
    fake.listener().onUpdate(VerificationState.Verified);
    expect(changed).toHaveBeenCalledOnce();
    unsubscribe();
    expect(fake.handle.cancel).toHaveBeenCalledOnce();
  });

  it("verifyWithRecoveryKey: recovers with the trimmed key; a refused key rejects with the SDK's error", async () => {
    const fake = fakeVerifyingClient();
    await expect(verifyWithRecoveryKey(fake.client, "wrong")).rejects.toThrow(/^The MAC check for the secret storage key failed$/);
    await verifyWithRecoveryKey(fake.client, "  EsTc \n");
    expect(fake.calls).toContain("recover EsTc");
  });

  it("emoji: request, the other device accepts, SAS, emoji, both confirm, the signature arrives", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client, { pollMs: 1 });
    expect(fake.calls).toEqual(["requestDeviceVerification"]);
    fake.delegate().didAcceptVerificationRequest();
    await Promise.resolve();
    expect(fake.calls).toContain("startSasVerification");
    fake.delegate().didReceiveVerificationData(SAS);
    expect(await verification.emoji).toEqual([
      { symbol: "🐶", name: "Dog" },
      { symbol: "🔑", name: "Key" },
    ]);

    const confirmed = verification.confirm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.calls).toContain("approveVerification");
    fake.delegate().didFinish();
    setTimeout(() => fake.setState(VerificationState.Verified), 5);
    await confirmed;
    // Over: nothing left to cancel.
    verification.cancel();
    expect(fake.calls).not.toContain("cancelVerification");
  });

  it("emoji: the other device cancelling ends it with the reason of its cancel code", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client);
    fake.delegate().didCancel();
    await expect(verification.ended).rejects.toThrow("The verification timed out.");
    await expect(verification.emoji).rejects.toThrow("The verification timed out.");
    verification.cancel();
    expect(fake.calls).not.toContain("cancelVerification");
  });

  it("emoji: a cancel once the emoji are shown takes its reason from the SAS, not from an earlier request", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client);
    fake.delegate().didAcceptVerificationRequest();
    fake.delegate().didStartSasVerification();
    fake.delegate().didReceiveVerificationData(SAS);
    await verification.emoji;
    // The request info still holds the cancel of an earlier verification ("m.timeout").
    fake.controller.sasCancelInfo = () => ({ reason: "mismatch", cancelCode: "m.mismatched_sas", cancelledByUs: false });
    fake.delegate().didCancel();
    await expect(verification.ended).rejects.toThrow("The other device says the emoji did not match.");
  });

  it("emoji: an SDK error carries its text, not the name of its type", async () => {
    const fake = fakeVerifyingClient();
    fake.controller.startSasVerification.mockRejectedValueOnce(new ClientError.Generic({ msg: "Verification request missing." }));
    const verification = await startEmojiVerification(fake.client);
    fake.delegate().didAcceptVerificationRequest();
    await expect(verification.ended).rejects.toThrow(/^Verification request missing\.$/);
    expect(fake.calls).toContain("cancelVerification");
  });

  it("emoji: × while waiting for the signature stops waiting", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client, { pollMs: 1 });
    fake.delegate().didReceiveVerificationData(SAS);
    const confirmed = verification.confirm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.delegate().didFinish();
    await new Promise((resolve) => setTimeout(resolve, 5));
    verification.cancel();
    await expect(confirmed).rejects.toThrow("The verification was cancelled.");
    expect(fake.calls).not.toContain("cancelVerification");
  });

  it("emoji: “They don't match” declines once; × cancels", async () => {
    const fake = fakeVerifyingClient();
    const mismatch = await startEmojiVerification(fake.client);
    mismatch.cancel(true);
    mismatch.cancel(true);
    expect(fake.calls.filter((c) => c === "declineVerification")).toHaveLength(1);

    const cancelled = await startEmojiVerification(fake.client);
    cancelled.cancel();
    expect(fake.calls).toContain("cancelVerification");
  });
});
