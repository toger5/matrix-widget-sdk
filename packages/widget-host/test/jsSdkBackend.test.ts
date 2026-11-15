/**
 * The widget host's `MatrixBackend` on matrix-js-sdk (`src/sdk/js/backend`), a foreign trait implemented in
 * TypeScript, behind the real `WidgetHostDriver` wasm. The js-sdk client is faked: the test checks
 * which SDK calls each widget action turns into, and what the SDK's events turn into for the widget.
 */
import { ClientEvent, MatrixError, MatrixEventEvent, RoomStateEvent, type MatrixClient } from "matrix-js-sdk";
import { afterEach, describe, expect, it } from "vitest";

import { JsSdkBackend } from "../src/sdk/js/backend/jsSdkBackend";
import { describeBackendContract } from "./backendContract";
import { X, behindDriver, tick } from "./harness";

const ROOM = "!room:example.org";
const USER = "@alice:example.org";

/** The parts of a js-sdk `MatrixEvent` the backend uses. */
function fakeEvent(raw: { type: string; content: Record<string, unknown>; state_key?: string; event_id?: string; sender?: string }, undecrypted = false) {
  const event = { sender: "@bob:example.org", event_id: `$${Math.random().toString(36).slice(2)}`, origin_server_ts: 1, ...raw };
  return {
    undecrypted,
    getRoomId: () => ROOM,
    getType: () => (undecrypted ? "m.room.encrypted" : event.type),
    getContent: () => event.content,
    getStateKey: () => event.state_key,
    getEffectiveEvent: () => event,
    isBeingDecrypted: () => false,
    isDecryptionFailure: () => false,
  };
}
type FakeEvent = ReturnType<typeof fakeEvent>;

/** A js-sdk client with one room: records the calls the backend makes and lets the test play the sync. */
function fakeClient(overrides: Record<string, unknown> = {}) {
  const calls: unknown[][] = [];
  const listeners = new Map<string, Set<(...args: never[]) => void>>();
  const timeline: FakeEvent[] = [];
  const state = new Map<string, FakeEvent>();
  let failure: unknown;

  const emit = (name: string, ...args: unknown[]) => listeners.get(name)?.forEach((listener) => (listener as (...a: unknown[]) => void)(...args));
  /** Record the call; answer with `result`, or reject while `failSends` is set. */
  const record =
    <T>(name: string, result: T) =>
    async (...args: unknown[]) => {
      calls.push([name, ...args]);
      if (failure) throw failure;
      return result;
    };
  const receive = (event: FakeEvent) => {
    timeline.push(event);
    emit(ClientEvent.Event, event);
  };

  const room = {
    getLiveTimeline: () => ({ getEvents: () => timeline }),
    currentState: {
      getStateEvents: (type: string, stateKey?: string) =>
        stateKey === undefined ? [...state.entries()].filter(([key]) => key.startsWith(`${type}\n`)).map(([, ev]) => ev) : (state.get(`${type}\n${stateKey}`) ?? null),
    },
    getAccountData: (type: string) => (type === "m.tag" ? { getContent: () => ({ tags: {} }) } : undefined),
  };
  const client = {
    on: (name: string, listener: () => void) => void (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(listener),
    off: (name: string, listener: () => void) => void listeners.get(name)?.delete(listener),
    getSafeUserId: () => USER,
    getDeviceId: () => "DEVICE",
    getHomeserverUrl: () => "https://hs.example.org",
    getAccessToken: () => "token-1",
    getProfileInfo: async () => ({ displayname: "Alice", avatar_url: "mxc://example.org/alice" }),
    getRoom: (roomId: string) => (roomId === ROOM ? room : null),
    getTurnServers: () => [{ urls: ["turn:first"], username: "u1", credential: "p1" }],
    // Like the real client: the event comes back through the sync.
    sendEvent: async (roomId: string, type: string, content: Record<string, unknown>) => {
      calls.push(["sendEvent", roomId, type, content]);
      if (failure) throw failure;
      const event = fakeEvent({ type, content, sender: USER, event_id: `$sent-${timeline.length + 1}` });
      receive(event);
      return { event_id: event.getEffectiveEvent().event_id };
    },
    sendStateEvent: record("sendStateEvent", { event_id: "$state" }),
    _unstable_sendStickyEvent: record("_unstable_sendStickyEvent", { event_id: "$sticky" }),
    _unstable_sendDelayedEvent: record("_unstable_sendDelayedEvent", { delay_id: "delay-1" }),
    _unstable_sendDelayedStateEvent: record("_unstable_sendDelayedStateEvent", { delay_id: "delay-2" }),
    _unstable_sendScheduledDelayedEvent: record("_unstable_sendScheduledDelayedEvent", {}),
    _unstable_cancelScheduledDelayedEvent: record("_unstable_cancelScheduledDelayedEvent", {}),
    _unstable_restartScheduledDelayedEvent: record("_unstable_restartScheduledDelayedEvent", {}),
    sendToDevice: record("sendToDevice", {}),
    queueToDevice: record("queueToDevice", undefined),
    getCrypto: () => undefined,
    ...overrides,
  };

  return {
    client: client as unknown as MatrixClient,
    calls,
    emit,
    receive,
    receiveState(type: string, stateKey: string, content: Record<string, unknown>) {
      const event = fakeEvent({ type, state_key: stateKey, content });
      state.set(`${type}\n${stateKey}`, event);
      emit(RoomStateEvent.Events, event);
    },
    failSends: (error: unknown) => void (failure = error),
    listenerCount: () => [...listeners.values()].reduce((sum, set) => sum + set.size, 0),
  };
}

describeBackendContract("JsSdkBackend", async () => {
  const fake = fakeClient();
  const backend = await JsSdkBackend.create(fake.client, ROOM);
  return {
    backend,
    roomId: ROOM,
    userId: USER,
    receiveState: fake.receiveState,
    failSends: (message) => fake.failSends(new Error(message)),
    dispose: () => backend.dispose(),
  };
});

describe("JsSdkBackend behind the driver", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => dispose?.());

  async function setup(overrides: Record<string, unknown> = {}) {
    const fake = fakeClient(overrides);
    const backend = await JsSdkBackend.create(fake.client, ROOM);
    dispose = () => backend.dispose();
    return { ...fake, backend, ...behindDriver(backend) };
  }

  it("takes the identity from the client and its profile", async () => {
    const { backend } = await setup();
    expect([backend.roomId(), backend.ownUserId(), backend.ownDeviceId()]).toEqual([ROOM, USER, "DEVICE"]);
    expect([backend.displayName(), backend.avatarUrl(), backend.baseUrl()]).toEqual(["Alice", "mxc://example.org/alice", "https://hs.example.org"]);
  });

  it("sends state events and delayed events through the SDK", async () => {
    const { ask, grant, calls } = await setup();
    await grant([
      `widget:${X}send_event.state:m.room.topic`,
      `widget:${X}send_event.timeline:m.room.message`,
      `widget:${X}send_event.delayed`,
      "widget:org.matrix.msc4157.update_delayed_event",
    ]);

    expect((await ask(`${X}send_event`, { type: "m.room.topic", state_key: "", content: { topic: "t" } })).event_id).toBe("$state");
    expect((await ask(`${X}send_event`, { type: "m.room.message", content: { body: "later" }, delay: 5000 })).delay_id).toBe("delay-1");
    expect((await ask(`${X}send_event`, { type: "m.room.topic", state_key: "", content: { topic: "later" }, delay: 100 })).delay_id).toBe("delay-2");
    expect(await ask("org.matrix.msc4157.update_delayed_event", { delay_id: "delay-1", action: "send" })).toEqual({});
    expect(await ask("org.matrix.msc4157.update_delayed_event", { delay_id: "delay-1", action: "restart" })).toEqual({});
    expect(await ask("org.matrix.msc4157.update_delayed_event", { delay_id: "delay-1", action: "cancel" })).toEqual({});

    expect(calls).toEqual([
      ["sendStateEvent", ROOM, "m.room.topic", { topic: "t" }, ""],
      ["_unstable_sendDelayedEvent", ROOM, { delay: 5000 }, null, "m.room.message", { body: "later" }],
      ["_unstable_sendDelayedStateEvent", ROOM, { delay: 100 }, "m.room.topic", { topic: "later" }, ""],
      ["_unstable_sendScheduledDelayedEvent", "delay-1"],
      ["_unstable_restartScheduledDelayedEvent", "delay-1"],
      ["_unstable_cancelScheduledDelayedEvent", "delay-1"],
    ]);
  });

  it("passes the homeserver's error code on to the widget", async () => {
    const { ask, grant, failSends } = await setup();
    await grant([`widget:${X}send_event.timeline:m.room.message`]);
    failSends(new MatrixError({ errcode: "M_FORBIDDEN", error: "not allowed" }, 403));
    const response = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } });
    const error = JSON.stringify(response.error);
    expect(error).toContain("M_FORBIDDEN");
    expect(error).toContain("not allowed");
    expect(error).toContain("403");
  });

  it("forwards an encrypted event only once it is decrypted", async () => {
    const { grant, pushed, receive, emit } = await setup();
    await grant([`host:${X}forward_event.timeline:m.room.message`]);
    pushed("");

    const event = fakeEvent({ type: "m.room.message", content: { body: "secret" } }, true);
    receive(event);
    await tick();
    expect(pushed(`${X}forward_event`)).toEqual([]);

    event.getType = () => "m.room.message";
    emit(MatrixEventEvent.Decrypted, event);
    await tick();
    const forwarded = pushed(`${X}forward_event`);
    expect(forwarded).toHaveLength(1);
    expect(JSON.stringify(forwarded[0])).toContain('"body":"secret"');
  });

  it("sends plain to-device messages as one request and leaves `*` to the homeserver", async () => {
    const { ask, grant, calls } = await setup();
    await grant([`widget:${X}send_to_device:org.example.ping`]);
    expect(await ask(`${X}send_to_device`, { type: "org.example.ping", encrypted: false, messages: { "@bob:example.org": { "*": { n: 1 } } } })).toEqual({});
    expect(calls).toEqual([["sendToDevice", "org.example.ping", new Map([["@bob:example.org", new Map([["*", { n: 1 }]])]])]]);
  });

  it("encrypts to-device messages per device, expanding `*` from the device list", async () => {
    const encrypted: unknown[][] = [];
    const crypto = {
      getUserDeviceInfo: async (users: string[]) => new Map(users.map((user) => [user, new Map([["D1", {}], ["D2", {}]])])),
      // No Olm session with D2: the SDK leaves it out of the batch.
      encryptToDeviceMessages: async (eventType: string, devices: { userId: string; deviceId: string }[], payload: unknown) => {
        encrypted.push([eventType, devices, payload]);
        return { eventType: "m.room.encrypted", batch: devices.filter((d) => d.deviceId !== "D2").map((d) => ({ ...d, payload: { ciphertext: "…" } })) };
      },
    };
    const { ask, grant, calls } = await setup({ getCrypto: () => crypto });
    await grant([`widget:${X}send_to_device:org.example.key`]);

    const response = await ask(`${X}send_to_device`, {
      type: "org.example.key",
      encrypted: true,
      messages: { "@bob:example.org": { "*": { k: 1 } }, "@carol:example.org": { C1: { k: 1 } } },
    });
    // The driver reports the device that could not be reached to the widget.
    expect((response.error as { message: string }).message).toContain("@bob:example.org/D2");
    expect(encrypted).toEqual([
      [
        "org.example.key",
        // One payload for all three devices, in the order the driver hands the recipients over.
        [
          { userId: "@carol:example.org", deviceId: "C1" },
          { userId: "@bob:example.org", deviceId: "D1" },
          { userId: "@bob:example.org", deviceId: "D2" },
        ],
        { k: 1 },
      ],
    ]);
    expect(calls.map(([name]) => name)).toEqual(["queueToDevice"]);
    expect((calls[0][1] as { batch: unknown[] }).batch).toHaveLength(2);
  });

  it("forwards to-device messages and TURN servers from the SDK", async () => {
    const { ask, grant, pushed, emit } = await setup();
    await grant([`host:${X}forward_to_device:org.example.ping`, `host:${X}update_turn_servers`]);
    pushed("");

    const message = { type: "org.example.ping", sender: "@bob:example.org", content: { n: 2 } };
    emit(ClientEvent.ReceivedToDeviceMessage, { message, encryptionInfo: { sender: "@bob:example.org" } });
    emit(ClientEvent.ReceivedToDeviceMessage, { message: { ...message, type: "org.example.other" }, encryptionInfo: null });
    await tick();
    expect(pushed(`${X}forward_to_device`)).toEqual([{ type: "org.example.ping", sender: "@bob:example.org", content: { n: 2 }, encrypted: true }]);

    expect(await ask(`${X}watch_turn_servers`)).toEqual({});
    await tick();
    emit(ClientEvent.TurnServers, [{ urls: ["turn:second"], username: "u2", credential: "p2" }]);
    await tick();
    expect(pushed(`${X}update_turn_servers`)).toEqual([
      { uris: ["turn:first"], username: "u1", password: "p1" },
      { uris: ["turn:second"], username: "u2", password: "p2" },
    ]);
  });

  it("stops listening to the client when it is disposed", async () => {
    const { backend, grant, listenerCount } = await setup();
    await grant([`host:${X}forward_event.timeline:m.room.message`, `host:${X}update_state:m.room.topic`, `host:${X}forward_to_device:org.example.ping`]);
    expect(listenerCount()).toBeGreaterThan(0);
    backend.dispose();
    expect(listenerCount()).toBe(0);
  });
});
