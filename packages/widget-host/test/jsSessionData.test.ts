/**
 * The parts of the matrix-js-sdk session that can run on a faked client: what the AccountView,
 * the RoomOverview, the RoomTimeline and "Copy to DevBackend" read (`src/matrix_session/js/roomData`), the
 * device verification (`src/matrix_session/js/verification`), and the gate that refuses requests
 * while the session is suspended (`src/matrix_session/js/fetchGate`).
 */
import { EventEmitter } from "node:events";

import { MatrixEventEvent, RoomEvent, type MatrixClient } from "matrix-js-sdk";
import { CryptoEvent, encodeRecoveryKey, VerificationPhase, VerificationRequestEvent } from "matrix-js-sdk/lib/crypto-api";
import { SECRET_STORAGE_ALGORITHM_V1_AES, ServerSideSecretStorageImpl } from "matrix-js-sdk/lib/secret-storage";
import { describe, expect, it, vi } from "vitest";

import { FetchGate, SuspendedError } from "../src/matrix_session/js/fetchGate";
import { accountInfo, exportRoom, loadOlderEvents, LOAD_MEMBERS_UP_TO, MEMBER_LIMIT, onTimelineChanged, roomDetails, timelineEvents } from "../src/matrix_session/js/roomData";
import { needsVerification, onVerificationChanged, RecoveryKeySlot, startEmojiVerification, verifyWithRecoveryKey } from "../src/matrix_session/js/verification";

const ROOM = "!room:example.org";
const USER = "@alice:example.org";

const event = (raw: Record<string, unknown>, status: string | null = null) => ({ status, event: raw, isDecryptionFailure: () => false, getEffectiveEvent: () => raw, getContent: () => raw.content });
/** An event the client could not decrypt: the SDK puts its "Unable to decrypt" message in place of the content. */
const undecryptable = (raw: Record<string, unknown>) => ({
  ...event(raw),
  isDecryptionFailure: () => true,
  getEffectiveEvent: () => ({ ...raw, type: "m.room.message", content: { msgtype: "m.bad.encrypted", body: "** Unable to decrypt **" } }),
});
const member = (userId: string, powerLevel: number, name?: string, avatar?: string) => ({
  userId,
  powerLevel,
  name: name ?? userId,
  rawDisplayName: name ?? userId,
  getMxcAvatarUrl: () => avatar ?? null,
});

function fakeClient(options: { members?: ReturnType<typeof member>[]; joinedCount?: number; offline?: boolean; older?: Record<string, unknown>[][]; undecryptable?: Record<string, unknown> } = {}) {
  const offline = () => Promise.reject(new Error("offline"));
  const members = options.members ?? [member(USER, 100, "Alice", "mxc://example.org/alice"), member("@bob:example.org", 50, "Bob"), member("@carol:example.org", 0)];
  const calls: string[] = [];
  const localState = [
    { type: "m.room.topic", state_key: "", content: { topic: "About widgets" }, sender: USER, event_id: "$topic" },
    { type: "m.room.member", state_key: USER, content: { membership: "join" }, sender: USER, event_id: "$alice" },
  ];
  const serverState = [...localState, { type: "m.room.member", state_key: "@bob:example.org", content: { membership: "join" }, sender: "@bob:example.org", event_id: "$bob", room_id: ROOM }];
  const timeline = [
    ...(options.undecryptable ? [undecryptable(options.undecryptable)] : []),
    event({ type: "m.room.message", content: { body: "3" }, event_id: "$3" }),
    event({ type: "m.room.message", content: { body: "echo" } }, "sending"),
  ];
  const older = [...(options.older ?? [])];
  /** The SDK drops the token of the live timeline once a pagination reached the start of the room. */
  let backwardToken: string | null = "older";
  const liveTimeline = { getEvents: () => timeline, getPaginationToken: () => backwardToken };
  const room = {
    roomId: ROOM,
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
  const emitter = new EventEmitter();
  const client = {
    on: (name: string, listener: (...args: unknown[]) => void) => emitter.on(name, listener),
    off: (name: string, listener: (...args: unknown[]) => void) => emitter.off(name, listener),
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
      if (older.length === 0) backwardToken = null;
      if (!page) return false;
      timeline.unshift(...page.map((raw) => event(raw)));
      return older.length > 0;
    },
  };
  return { client: client as unknown as MatrixClient, calls, serverState, localState, room, emitter };
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

describe("matrix-js-sdk RoomTimeline", () => {
  it("the live timeline, oldest first, without local echoes; an event the client could not decrypt as it arrived", () => {
    const encrypted = { type: "m.room.encrypted", content: { algorithm: "m.megolm.v1.aes-sha2", ciphertext: "x" }, event_id: "$2", sender: USER };
    const { client } = fakeClient({ undecryptable: encrypted });
    expect(timelineEvents(client, ROOM)).toEqual([encrypted, { type: "m.room.message", content: { body: "3" }, event_id: "$3" }]);
    expect(() => timelineEvents(client, "!other:example.org")).toThrow(/unknown room/);
  });

  it("older events are paginated into the live timeline, until the start of the room", async () => {
    const { client, calls } = fakeClient({ older: [[{ type: "m.room.message", content: { body: "2" }, event_id: "$2" }], [{ type: "m.room.create", state_key: "", content: {}, event_id: "$1" }]] });
    expect(await loadOlderEvents(client, ROOM, 50)).toBe(false);
    expect(await loadOlderEvents(client, ROOM, 50)).toBe(true);
    // At the start the SDK has no token left: no request (without one it would ask for the newest events).
    expect(await loadOlderEvents(client, ROOM, 50)).toBe(true);
    expect(calls).toEqual(["paginate 50", "paginate 50"]);
    expect(timelineEvents(client, ROOM).map((ev) => ev.event_id)).toEqual(["$1", "$2", "$3"]);
    await expect(loadOlderEvents(fakeClient({ offline: true }).client, ROOM, 50)).rejects.toThrow("offline");
  });

  it("onTimelineChanged: new, deleted, sent and decrypted events of the room call it, other rooms' do not; a timeline reset says so; unsubscribing stops it", () => {
    const { client, room, emitter } = fakeClient();
    const other = { roomId: "!other:example.org" };
    const ofRoom = { getRoomId: () => ROOM };
    const calls: (boolean | undefined)[] = [];
    const stop = onTimelineChanged(client, ROOM, (reset) => calls.push(reset));
    emitter.emit(RoomEvent.Timeline, ofRoom, other);
    emitter.emit(RoomEvent.Redaction, ofRoom, other);
    emitter.emit(MatrixEventEvent.Decrypted, { getRoomId: () => other.roomId });
    emitter.emit(RoomEvent.TimelineReset, other);
    expect(calls).toEqual([]);
    emitter.emit(RoomEvent.Timeline, ofRoom, room);
    emitter.emit(RoomEvent.Redaction, ofRoom, room);
    emitter.emit(RoomEvent.LocalEchoUpdated, ofRoom, room);
    emitter.emit(MatrixEventEvent.Decrypted, ofRoom);
    emitter.emit(RoomEvent.TimelineReset, room);
    expect(calls).toEqual([undefined, undefined, undefined, undefined, true]);
    stop();
    emitter.emit(RoomEvent.Timeline, ofRoom, room);
    expect(calls).toHaveLength(5);
    expect(emitter.eventNames()).toEqual([]);
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

/** The fakes' account: its secret storage has one key, the default "k", whose recovery key is this. */
const KEY_ID = "k";
const KEY_BYTES = new Uint8Array(32).fill(7);
const RECOVERY_KEY = encodeRecoveryKey(KEY_BYTES)!;

/** The SDK's own secret storage on faked account data: `getDefaultKeyId`, `getKey`, `checkKey` are the real ones. */
async function fakeSecretStorage(): Promise<ServerSideSecretStorageImpl> {
  const accountData = new Map<string, unknown>();
  const adapter = Object.assign(new EventEmitter(), {
    getAccountDataFromServer: async (type: string) => accountData.get(type) ?? null,
    setAccountData: async (type: string, content: unknown) => (accountData.set(type, content), {}),
  });
  const storage = new ServerSideSecretStorageImpl(adapter as never, {});
  await storage.addKey(SECRET_STORAGE_ALGORITHM_V1_AES, { key: KEY_BYTES }, KEY_ID);
  accountData.set("m.secret_storage.default_key", { key: KEY_ID });
  return storage;
}
const SECRET_STORAGE = await fakeSecretStorage();

/** A client with a crypto module and an own-user verification request the test drives. */
function fakeVerifyingClient() {
  let verified = false;
  const calls: string[] = [];
  const sas = { sas: { emoji: [["🐶", "Dog"], ["🔑", "Key"]] }, confirm: vi.fn(async () => void calls.push("confirm")), mismatch: vi.fn(), cancel: vi.fn() };
  let finishVerify!: () => void;
  const verifier = Object.assign(new EventEmitter(), {
    getShowSasCallbacks: () => sas,
    verify: () => new Promise<void>((resolve) => (finishVerify = resolve)),
  });
  const request = Object.assign(new EventEmitter(), {
    phase: VerificationPhase.Requested,
    cancellationCode: null as string | null,
    verifier: undefined as typeof verifier | undefined,
    startVerification: async () => verifier,
    cancel: vi.fn(async () => void calls.push("request.cancel")),
    /** The other device moves the request on. */
    move(phase: VerificationPhase, cancellationCode: string | null = null) {
      this.phase = phase;
      this.cancellationCode = cancellationCode;
      this.emit(VerificationRequestEvent.Change);
    },
  });
  const crypto = {
    /** For the own user the SDK downloads the keys again on every call. */
    userHasCrossSigningKeys: vi.fn(async () => true),
    getDeviceVerificationStatus: vi.fn(async () => ({ crossSigningVerified: verified })),
    requestOwnUserVerification: async () => request,
    getCrossSigningStatus: vi.fn(async () => ({ publicKeysOnDevice: true, privateKeysInSecretStorage: true, privateKeysCachedLocally: { masterKey: false, selfSigningKey: false, userSigningKey: false } })),
    bootstrapCrossSigning: vi.fn(async () => {
      // The SDK asks the client's crypto callback for the secret storage key while it bootstraps.
      const answer = await slot.getSecretStorageKey({ keys: { [KEY_ID]: {} as never } }, "m.cross_signing.master");
      if (answer) handedOut.push(answer[1]);
      calls.push(`key held: ${String(answer !== null)}`);
      // A secret encrypted for another key only: the callback has no key for it.
      calls.push(`for another key: ${String(await slot.getSecretStorageKey({ keys: { old: {} as never } }, "m.megolm_backup.v1"))}`);
      verified = true;
    }),
    loadSessionBackupPrivateKeyFromSecretStorage: async () => undefined,
    checkKeyBackupAndEnable: vi.fn(async () => void calls.push("checkKeyBackupAndEnable")),
  };
  /** The keys the crypto callback handed to the SDK. */
  const handedOut: Uint8Array[] = [];
  const slot = new RecoveryKeySlot();
  const client = Object.assign(new EventEmitter(), { getCrypto: () => crypto, getDeviceId: () => "DEVICE", getSafeUserId: () => USER, secretStorage: SECRET_STORAGE }) as unknown as MatrixClient;
  return { client, crypto, request, sas, slot, calls, handedOut, finishVerify: () => finishVerify(), setVerified: (value: boolean) => (verified = value) };
}

describe("matrix-js-sdk device verification", () => {
  it("needsVerification: only when the account has cross-signing keys and this device is not signed by them", async () => {
    const fake = fakeVerifyingClient();
    expect(await needsVerification(fake.client)).toBe(true);
    fake.setVerified(true);
    expect(await needsVerification(fake.client)).toBe(false);
    fake.crypto.userHasCrossSigningKeys.mockResolvedValue(false);
    fake.setVerified(false);
    expect(await needsVerification(fake.client)).toBe(false);
  });

  it("onVerificationChanged: trust, key and device changes of the own user call it, other users' do not; unsubscribing stops it", () => {
    const fake = fakeVerifyingClient();
    const emitter = fake.client as unknown as EventEmitter;
    const changed = vi.fn();
    const unsubscribe = onVerificationChanged(fake.client, changed);
    emitter.emit(CryptoEvent.UserTrustStatusChanged, "@bob:example.org", {});
    emitter.emit(CryptoEvent.DevicesUpdated, ["@bob:example.org"], false);
    expect(changed).not.toHaveBeenCalled();
    emitter.emit(CryptoEvent.UserTrustStatusChanged, USER, {});
    emitter.emit(CryptoEvent.KeysChanged, {});
    emitter.emit(CryptoEvent.DevicesUpdated, ["@bob:example.org", USER], false);
    expect(changed).toHaveBeenCalledTimes(3);

    unsubscribe();
    emitter.emit(CryptoEvent.UserTrustStatusChanged, USER, {});
    expect(changed).toHaveBeenCalledTimes(3);
    expect(emitter.listenerCount(CryptoEvent.KeysChanged)).toBe(0);
  });

  it("verifyWithRecoveryKey: the decoded key is held only while the SDK bootstraps, only for the default key; a malformed key is refused before", async () => {
    const fake = fakeVerifyingClient();
    await expect(verifyWithRecoveryKey(fake.client, fake.slot, "EsTc LW2K")).rejects.toThrow();
    expect(fake.crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(fake.slot.holds).toBe(false);

    await verifyWithRecoveryKey(fake.client, fake.slot, ` ${RECOVERY_KEY} `);
    expect(fake.calls).toEqual(["key held: true", "for another key: null", "checkKeyBackupAndEnable"]);
    expect(fake.slot.holds).toBe(false);
    expect(await fake.slot.getSecretStorageKey({ keys: { [KEY_ID]: {} as never } }, "m.cross_signing.master")).toBeNull();
    // The callback handed out the decoded key; its bytes are overwritten afterwards.
    expect(fake.handedOut).toHaveLength(1);
    expect(fake.handedOut[0]).toEqual(new Uint8Array(32));
  });

  it("verifyWithRecoveryKey: a well-formed key that is not the account's default secret storage key is refused before anything is read", async () => {
    const fake = fakeVerifyingClient();
    await expect(verifyWithRecoveryKey(fake.client, fake.slot, encodeRecoveryKey(new Uint8Array(32).fill(9))!)).rejects.toThrow(/^This is not the recovery key of this account\.$/);
    expect(fake.crypto.getCrossSigningStatus).not.toHaveBeenCalled();
    expect(fake.crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(fake.slot.holds).toBe(false);
  });

  it("verifyWithRecoveryKey: refused before the SDK bootstraps when the secret storage does not hold the cross-signing keys (it would create new ones)", async () => {
    const fake = fakeVerifyingClient();
    fake.crypto.getCrossSigningStatus.mockResolvedValueOnce({ publicKeysOnDevice: true, privateKeysInSecretStorage: false, privateKeysCachedLocally: { masterKey: false, selfSigningKey: false, userSigningKey: false } });
    await expect(verifyWithRecoveryKey(fake.client, fake.slot, RECOVERY_KEY)).rejects.toThrow("does not hold its cross-signing keys");
    expect(fake.crypto.bootstrapCrossSigning).not.toHaveBeenCalled();
    expect(fake.slot.holds).toBe(false);
  });

  it("verifyWithRecoveryKey: a failing backup check does not fail a verification that went through", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeVerifyingClient();
    fake.crypto.checkKeyBackupAndEnable.mockRejectedValueOnce(new Error("offline"));
    await verifyWithRecoveryKey(fake.client, fake.slot, RECOVERY_KEY);
    expect(await needsVerification(fake.client)).toBe(false);
    vi.restoreAllMocks();
  });

  it("verifyWithRecoveryKey: a check the user cancelled does not take the key of the next one away", async () => {
    const fake = fakeVerifyingClient();
    let releaseFirst!: () => void;
    fake.crypto.bootstrapCrossSigning.mockImplementationOnce(() => new Promise<void>((resolve) => (releaseFirst = resolve)));
    const first = verifyWithRecoveryKey(fake.client, fake.slot, RECOVERY_KEY);
    await vi.waitFor(() => expect(releaseFirst).toBeDefined());
    let releaseSecond!: () => void;
    fake.crypto.bootstrapCrossSigning.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => (releaseSecond = resolve));
      const answer = await fake.slot.getSecretStorageKey({ keys: { [KEY_ID]: {} as never } }, "m.cross_signing.master");
      fake.calls.push(`second sees key: ${String(answer?.[1][0])}`);
    });
    const second = verifyWithRecoveryKey(fake.client, fake.slot, RECOVERY_KEY).catch(() => undefined);
    await vi.waitFor(() => expect(releaseSecond).toBeDefined());
    releaseFirst();
    await first.catch(() => undefined);
    releaseSecond();
    await second;
    expect(fake.calls).toContain("second sees key: 7");
    expect(fake.slot.holds).toBe(false);
  });

  it("emoji: the other device accepts, both compare and confirm, the signature arrives, the backup is checked", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client, { pollMs: 1 });
    fake.request.move(VerificationPhase.Ready);
    expect(await verification.emoji).toEqual([
      { symbol: "🐶", name: "Dog" },
      { symbol: "🔑", name: "Key" },
    ]);

    const confirmed = verification.confirm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(fake.sas.confirm).toHaveBeenCalledOnce();
    fake.finishVerify();
    setTimeout(() => fake.setVerified(true), 5);
    await confirmed;
    expect(fake.calls).toEqual(["confirm", "checkKeyBackupAndEnable"]);
    // The wait for the signature reads the client's stored devices: no key download per poll.
    expect(fake.crypto.getDeviceVerificationStatus.mock.calls.length).toBeGreaterThan(1);
    expect(fake.crypto.userHasCrossSigningKeys).not.toHaveBeenCalled();
  });

  it("emoji: × while waiting for the signature stops waiting", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client, { pollMs: 1 });
    fake.request.move(VerificationPhase.Ready);
    await verification.emoji;
    const confirmed = verification.confirm();
    await new Promise((resolve) => setTimeout(resolve, 0));
    fake.finishVerify();
    fake.request.move(VerificationPhase.Done);
    await new Promise((resolve) => setTimeout(resolve, 5));
    verification.cancel();
    await expect(confirmed).rejects.toThrow("The verification was cancelled.");
    expect(fake.request.cancel).not.toHaveBeenCalled();
  });

  it("emoji: a cancel by the other device ends it with the reason of its code, at any step", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client);
    fake.request.move(VerificationPhase.Cancelled, "m.user");
    await expect(verification.ended).rejects.toThrow("The verification was cancelled on the other device.");
    await expect(verification.emoji).rejects.toThrow("The verification was cancelled on the other device.");
    verification.cancel();
    expect(fake.request.cancel).not.toHaveBeenCalled();
  });

  it("emoji: “They don't match” reports the mismatch once; × cancels the request", async () => {
    const fake = fakeVerifyingClient();
    const verification = await startEmojiVerification(fake.client);
    fake.request.move(VerificationPhase.Ready);
    await verification.emoji;
    verification.cancel(true);
    verification.cancel(true);
    expect(fake.sas.mismatch).toHaveBeenCalledOnce();

    const other = fakeVerifyingClient();
    const waiting = await startEmojiVerification(other.client);
    waiting.cancel();
    expect(other.request.cancel).toHaveBeenCalledOnce();
  });
});
