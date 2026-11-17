/**
 * The widget host's `MatrixBackend` on matrix-rust-sdk (`src/matrix_session/rust/backend`), a foreign trait
 * implemented in TypeScript, behind the real `WidgetHostDriver` wasm. The SDK client is faked: the
 * test checks which SDK calls each widget action turns into, and what the SDK's sync turns into
 * for the widget. The SDK's wasm module is loaded too, because its enums and event type
 * conversions live there.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ClientError,
  DelayedEventUpdateAction,
  ErrorKind,
  type ClientLike,
  type RawRoomEventsListener,
  type RawTimelineChangesListener,
  type RoomLike,
  type RoomStateEvent,
  type RoomStateEventsListener,
  type ToDeviceMessageListener,
} from "matrix-sdk-uniffi-js";

import initSdkWasm from "../../matrix-sdk-uniffi-js/src/generated/wasm-bindgen/index.js";
import * as sdkFfi from "../../matrix-sdk-uniffi-js/src/generated/matrix_sdk_ffi";
import * as rumaEvents from "../../matrix-sdk-uniffi-js/src/generated/ruma_events";
import { RustSdkBackend } from "../src/matrix_session/rust/backend/rustSdkBackend";
import { describeBackendContract } from "./backendContract";
import { X, behindDriver, tick } from "./harness";

const require = createRequire(import.meta.url);
await initSdkWasm({ module_or_path: readFileSync(require.resolve("../../matrix-sdk-uniffi-js/src/generated/wasm-bindgen/index_bg.wasm")) });
rumaEvents.default.initialize();
sdkFfi.default.initialize();

const ROOM = "!room:example.org";
const USER = "@alice:example.org";
const HS = "https://hs.example.org";

/** An event as the SDK hands it out raw: the JSON of the sync, which has no `room_id`. */
const rawEvent = (type: string, extra: Record<string, unknown>) => JSON.stringify({ type, sender: "@bob:example.org", origin_server_ts: 1, content: {}, ...extra });

const stateEvent = (type: string, eventId: string, content: unknown, stateKey = ""): RoomStateEvent => ({
  eventType: rumaEvents.stateEventTypeFromString(type),
  stateKey,
  sender: "@bob:example.org",
  contentJson: JSON.stringify(content),
  eventId,
  timestamp: 1n,
});

/** The SDK's listeners of the fake room and client, state ones by the event type's enum tag, so a test can play the sync. */
interface Listeners {
  state: Map<string, RoomStateEventsListener>;
  events?: RawRoomEventsListener;
  /** Every subscriber of the event cache's changes (the backend subscribes twice: RoomTimelines and the late decryptions). */
  changes: Set<RawTimelineChangesListener>;
  toDevice?: ToDeviceMessageListener;
}

/**
 * An SDK client with one room that behaves like a synced one: what is sent comes back through the
 * event cache and its feed, and state set with `receiveState` is in the store and reported to the
 * state listeners. `sdk` replaces single methods.
 */
function fakeSdk(sdk: { room?: Record<string, unknown>; client?: Record<string, unknown> } = {}) {
  const sdkCalls: unknown[][] = [];
  const listeners: Listeners = { state: new Map(), changes: new Set() };
  const handle = { cancel: () => {} };
  const cached: string[] = [];
  const state = new Map<string, RoomStateEvent[]>();
  let sendFailure: Error | undefined;
  let n = 0;
  /** The running `paginateEventsRawBackwards`, ended by `resolvePagination`. */
  let finishPagination: ((events: string[], startReached: boolean) => void) | undefined;
  const record =
    (name: string, result: unknown) =>
    async (...args: unknown[]) => (sdkCalls.push([name, ...args]), result);

  const room = {
    id: () => ROOM,
    sendRaw: async (type: string, content: string, ...rest: unknown[]) => {
      sdkCalls.push(["sendRaw", type, content, ...rest]);
      if (sendFailure) throw sendFailure;
      const eventId = `$sent${++n}`;
      const json = JSON.stringify({ type, sender: USER, event_id: eventId, origin_server_ts: n, content: JSON.parse(content) });
      cached.push(json);
      listeners.events?.onEvents([json]);
      return eventId;
    },
    sendStateEventRaw: record("sendStateEventRaw", "$state"),
    sendDelayedEvent: record("sendDelayedEvent", "delay-1"),
    eventsRaw: async () => cached,
    // Like the SDK: the older events are in the event cache when the promise resolves (whether the start is reached).
    paginateEventsRawBackwards: (count: number) => {
      sdkCalls.push(["paginateEventsRawBackwards", count]);
      return new Promise<boolean>((resolve) => {
        finishPagination = (events, startReached) => {
          cached.unshift(...events);
          resolve(startReached);
        };
      });
    },
    stateEvents: async (type: rumaEvents.StateEventType) => state.get(type.tag) ?? [],
    subscribeToStateEvents: (type: rumaEvents.StateEventType, listener: RoomStateEventsListener) => {
      listeners.state.set(type.tag, listener);
      // The SDK reports the current state right away.
      queueMicrotask(() => listener.onUpdate(state.get(type.tag) ?? []));
      return handle;
    },
    subscribeToEventsRaw: (listener: RawRoomEventsListener) => ((listeners.events = listener), handle),
    subscribeToTimelineChangesRaw: (listener: RawTimelineChangesListener) => (listeners.changes.add(listener), { cancel: () => listeners.changes.delete(listener) }),
    ...sdk.room,
  } as unknown as RoomLike;
  const client = {
    userId: () => USER,
    deviceId: () => "DEVICE",
    homeserver: () => `${HS}/`,
    session: () => ({ accessToken: "token-1" }),
    displayName: async () => "Alice",
    avatarUrl: async () => undefined,
    getRoom: () => room,
    requestOpenidToken: async () => ({ accessToken: "oid", tokenType: "Bearer", matrixServerName: "example.org", expiresInSeconds: 3600n }),
    updateDelayedEvent: record("updateDelayedEvent", undefined),
    subscribeToCustomToDeviceMessages: (_types: string[], listener: ToDeviceMessageListener) => ((listeners.toDevice = listener), handle),
    ...sdk.client,
  } as unknown as ClientLike;

  return {
    client,
    room,
    sdkCalls,
    listeners,
    /** A state event arrives in the room, as a sync would deliver it. */
    receiveState(type: string, stateKey: string, content: Record<string, unknown>) {
      const event = stateEvent(type, `$state${++n}`, content, stateKey);
      const tag = event.eventType.tag;
      const events = [...(state.get(tag) ?? []).filter((ev) => ev.stateKey !== stateKey), event];
      state.set(tag, events);
      listeners.state.get(tag)?.onUpdate(events);
    },
    failSends: (error: Error) => (sendFailure = error),
    /** End the running pagination with `events` (oldest first). */
    resolvePagination(events: { type: string; content: Record<string, unknown> }[], startReached: boolean) {
      if (!finishPagination) throw new Error("no pagination runs");
      finishPagination(events.map((ev) => rawEvent(ev.type, { event_id: `$old${++n}`, content: ev.content })), startReached);
      finishPagination = undefined;
    },
  };
}

/** The backend on a fake SDK, behind the driver. No request may reach a homeserver: `fetch` fails the test. */
async function setup(sdk: Parameters<typeof fakeSdk>[0] = {}) {
  const fake = fakeSdk(sdk);
  const backend = await RustSdkBackend.create(fake.client, fake.room);
  return { ...fake, backend, ...behindDriver(backend) };
}

/** Record every request made with `fetch`. The backend talks to the homeserver through the SDK, so there should be none. */
function watchFetch() {
  const calls: { method: string; url: string }[] = [];
  vi.stubGlobal("fetch", async (input: URL | string, init: RequestInit = {}) => {
    calls.push({ method: init.method ?? "GET", url: String(input) });
    return new Response(JSON.stringify({ errcode: "M_UNRECOGNIZED" }), { status: 404 });
  });
  return calls;
}

describeBackendContract("RustSdkBackend", async () => {
  const fake = fakeSdk();
  const backend = await RustSdkBackend.create(fake.client, fake.room);
  return {
    backend,
    roomId: ROOM,
    userId: USER,
    receiveState: fake.receiveState,
    failSends: (message) => fake.failSends(new Error(message)),
    resolvePagination: async (events, startReached) => {
      fake.resolvePagination(events, startReached);
      await tick();
    },
    dispose: () => backend.dispose(),
  };
});

describe("RustSdkBackend behind the driver", () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    dispose = undefined;
    vi.unstubAllGlobals();
  });

  it("reports the identity the SDK client has", async () => {
    watchFetch();
    const { backend, ask, grant } = await setup();
    dispose = () => backend.dispose();
    await grant([`widget:${X}get_matrix_context`]);
    const context = await ask(`${X}get_matrix_context`);
    expect(context.user_id).toBe("@alice:example.org");
    expect(context.room_id).toBe(ROOM);
    expect(backend.baseUrl()).toBe(HS);
    expect(backend.displayName()).toBe("Alice");
  });

  it("sends timeline and state events through the SDK, never over HTTP", async () => {
    const calls = watchFetch();
    const { backend, ask, grant, sdkCalls } = await setup();
    dispose = () => backend.dispose();
    await grant([`widget:${X}send_event.timeline:m.room.message`, `widget:${X}send_event.state:m.room.topic`]);

    const sentEvent = await ask(`${X}send_event`, { type: "m.room.message", content: { msgtype: "m.text", body: "hi" } });
    expect(sentEvent.event_id).toBe("$sent1");
    const state = await ask(`${X}send_event`, { type: "m.room.topic", state_key: "", content: { topic: "t" } });
    expect(state.event_id).toBe("$state");

    const [sendRaw, sendState] = sdkCalls;
    expect(sendRaw.slice(0, 2)).toEqual(["sendRaw", "m.room.message"]);
    expect(JSON.parse(sendRaw[2] as string)).toEqual({ msgtype: "m.text", body: "hi" });
    expect(sendState).toEqual(["sendStateEventRaw", "m.room.topic", "", JSON.stringify({ topic: "t" }), undefined]);
    expect(calls.filter((c) => c.method !== "GET")).toHaveLength(0);
  });

  it("reports the homeserver's error code when an SDK call fails", async () => {
    watchFetch();
    const forbidden = new ClientError.MatrixApi({ kind: new ErrorKind.Forbidden(), code: "M_FORBIDDEN", msg: "not allowed", details: undefined });
    const { backend, ask, grant } = await setup({ room: { sendRaw: async () => Promise.reject(forbidden) } });
    dispose = () => backend.dispose();
    await grant([`widget:${X}send_event.timeline:m.room.message`]);
    const response = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } });
    expect(JSON.stringify(response.error)).toContain("M_FORBIDDEN");
  });

  it("schedules and updates delayed events through the SDK", async () => {
    watchFetch();
    const { backend, ask, grant, sdkCalls } = await setup();
    dispose = () => backend.dispose();
    await grant([`widget:${X}send_event.timeline:m.room.message`, `widget:${X}send_event.delayed`, "widget:org.matrix.msc4157.update_delayed_event"]);

    const delayed = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "later" }, delay: 5000 });
    expect(delayed.delay_id).toBe("delay-1");
    expect(await ask("org.matrix.msc4157.update_delayed_event", { delay_id: "delay-1", action: "send" })).toEqual({});
    expect(sdkCalls).toEqual([
      ["sendDelayedEvent", "m.room.message", JSON.stringify({ body: "later" }), 5000n, undefined],
      ["updateDelayedEvent", "delay-1", DelayedEventUpdateAction.Send, undefined],
    ]);
  });

  it("encrypts to-device messages with the SDK and reports the devices it could not reach", async () => {
    watchFetch();
    const encrypted: unknown[][] = [];
    const sendEncryptedToDeviceMessage = async (type: string, recipients: Map<string, string[]>, content: string) => {
      encrypted.push([type, Object.fromEntries(recipients), content]);
      return { failures: new Map([["@bob:example.org", ["GONE"]]]) };
    };
    const { backend, ask, grant } = await setup({ client: { sendEncryptedToDeviceMessage } });
    dispose = () => backend.dispose();
    await grant([`widget:${X}send_to_device:org.example.key`]);

    const response = await ask(`${X}send_to_device`, {
      type: "org.example.key",
      encrypted: true,
      messages: { "@bob:example.org": { OK: { key: 1 }, GONE: { key: 1 } } },
    });
    expect(encrypted).toHaveLength(1);
    expect(encrypted[0][0]).toBe("org.example.key");
    expect((encrypted[0][1] as Record<string, string[]>)["@bob:example.org"].sort()).toEqual(["GONE", "OK"]);
    expect(encrypted[0][2]).toBe(JSON.stringify({ key: 1 }));
    expect(JSON.stringify(response)).toContain("GONE");
  });

  it("refuses to send a to-device message unencrypted", async () => {
    const calls = watchFetch();
    const { backend, ask, grant } = await setup();
    dispose = () => backend.dispose();
    await grant([`widget:${X}send_to_device:org.example.key`]);
    const response = await ask(`${X}send_to_device`, { type: "org.example.key", encrypted: false, messages: { "@bob:example.org": { OK: { key: 1 } } } });
    expect(JSON.stringify(response.error)).toContain("encrypted");
    expect(calls.filter((c) => c.method === "PUT")).toHaveLength(0);
  });

  it("forwards the to-device messages the SDK decrypted", async () => {
    watchFetch();
    const { backend, grant, sent, listeners } = await setup();
    dispose = () => backend.dispose();
    await grant([`host:${X}forward_to_device:org.example.key`]);

    listeners.toDevice!.onMessage({ eventType: "org.example.key", senderId: "@bob:example.org", content: JSON.stringify({ key: 2 }), encryptionInfo: undefined });
    await tick();
    const forwarded = sent.find((m) => m.action === `${X}forward_to_device`);
    expect(forwarded?.request).toMatchObject({ type: "org.example.key", sender: "@bob:example.org", content: { key: 2 }, encrypted: false });
  });

  it("reads the SDK's event cache newest first, never paginating by itself; an undecryptable event is skipped but is a cursor", async () => {
    const calls = watchFetch();
    const cached = [
      rawEvent("m.room.message", { event_id: "$1" }),
      rawEvent("m.reaction", { event_id: "$r" }),
      rawEvent("m.room.encrypted", { event_id: "$utd" }),
      rawEvent("m.room.message", { event_id: "$2" }),
    ];
    const { backend, ask, grant, sdkCalls } = await setup({ room: { eventsRaw: async () => cached } });
    dispose = () => backend.dispose();
    await grant([`widget:${X}read_timeline:m.room.message`]);

    const newest = await ask(`${X}read_timeline`, { limit: 10 });
    expect((newest.events as { event_id: string; room_id: string }[]).map((e) => [e.event_id, e.room_id])).toEqual([
      ["$2", ROOM],
      ["$1", ROOM],
    ]);
    expect(newest.pagination).toBe("idle");
    expect(((await ask(`${X}read_timeline`, { from: "$utd", limit: 10 })).events as { event_id: string }[]).map((e) => e.event_id)).toEqual(["$1"]);
    expect(sdkCalls.filter(([name]) => name === "paginateEventsRawBackwards")).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("reports late decryptions and resets of the event cache (subscribeToTimelineChangesRaw)", async () => {
    const { backend, ask, grant, pushed, listeners } = await setup();
    dispose = () => backend.dispose();
    await grant([`widget:${X}read_timeline:m.room.message`, `host:${X}notify_timeline_update`]);
    pushed("");
    const decrypted = [
      rawEvent("m.room.message", { event_id: "$late", content: { body: "secret" } }),
      rawEvent("org.example.secret", { event_id: "$other" }),
      // A redaction applied in place is no decryption.
      rawEvent("m.room.message", { event_id: "$redacted", unsigned: { redacted_because: { type: "m.room.redaction" } } }),
    ];
    listeners.changes.forEach((listener) => listener.onDecrypted(decrypted));
    await tick();
    expect(pushed(`${X}notify_timeline_update`)).toEqual([{ decrypted: ["$late"] }]);
    listeners.changes.forEach((listener) => listener.onReset());
    await tick();
    expect(pushed(`${X}notify_timeline_update`)).toEqual([{ reset: true }]);
    expect((await ask(`${X}read_timeline`, { limit: 1 })).pagination).toBe("idle");
    backend.dispose();
    expect(listeners.changes.size).toBe(0);
  });

  it("delivers state and live events of any type from the SDK's sync", async () => {
    const calls = watchFetch();
    const { backend, grant, sent, listeners } = await setup();
    dispose = () => backend.dispose();
    await grant([`host:${X}update_state:m.room.topic`, `host:${X}forward_event.timeline:org.example.custom`]);

    // The SDK calls a state listener with the current set right away, then after every change.
    listeners.state.get("RoomTopic")!.onUpdate([stateEvent("m.room.topic", "$topic", { topic: "first" })]);
    await tick();
    const updates = () => sent.filter((m) => m.action === `${X}update_state`).map((m) => JSON.stringify(m.request));
    expect(updates().at(-1)).toContain("$topic");
    listeners.state.get("RoomTopic")!.onUpdate([stateEvent("m.room.topic", "$topic2", { topic: "second" })]);
    await tick();
    expect(updates().at(-1)).toContain("$topic2");

    listeners.events!.onEvents([rawEvent("m.room.message", { event_id: "$other" }), rawEvent("org.example.custom", { event_id: "$live" })]);
    await tick();
    const forwarded = sent.filter((m) => m.action === `${X}forward_event`).map((m) => JSON.stringify(m.request));
    expect(forwarded).toHaveLength(1);
    expect(forwarded[0]).toContain("$live");
    expect(calls).toHaveLength(0);
  });
});
