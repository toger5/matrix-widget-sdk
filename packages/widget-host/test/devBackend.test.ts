/** The DevBackend: each mocked room behaves like any other backend; rooms, widgets, media and to-device messages around them. */
import { readFileSync } from "node:fs";

import { afterEach, describe, expect, it, vi } from "vitest";

import { EXAMPLE_LEGACY, EXAMPLE_NEW } from "../src/exampleWidgets";
import { DevBackend, seedDemoMedia, validateSeed, type DevBackendSeed } from "../src/matrix_session/memory/devBackend";
import type { RawEvent } from "../src/session";
import { describeBackendContract } from "./backendContract";
import { X, behindDriver, tick } from "./harness";

const bytes = (text: string) => new TextEncoder().encode(text).buffer as ArrayBuffer;
const text = (data: ArrayBuffer) => new TextDecoder().decode(data);
const seedFile = (name: string): unknown => JSON.parse(readFileSync(new URL(`../e2e/seeds/${name}`, import.meta.url), "utf8"));

/** `demoMedia` and `url` media are fetched: answer with the URL as the file's content. */
function stubFetch() {
  const fetched: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    fetched.push(url);
    if (url.includes("missing")) return new Response("", { status: 404 });
    return new Response(`content of ${url}`, { headers: { "content-type": "text/plain; charset=utf-8" } });
  });
  return fetched;
}

afterEach(() => vi.unstubAllGlobals());

describeBackendContract("InMemoryBackend (a room of the DevBackend)", async () => {
  const dev = new DevBackend();
  dev.addRoom({ name: "Other room" });
  const roomId = dev.addRoom({ id: "!contract:dev.local" });
  const backend = await dev.backendFor(roomId);
  return {
    backend,
    roomId,
    userId: dev.userId,
    receiveState: (type, stateKey, content) => void dev.sendState(roomId, { type, stateKey, content }),
    failSends: (message) => dev.store(roomId).failSends(message),
    dispose: () => backend.dispose(),
  };
});

describe("DevBackend: rooms", () => {
  it("starts empty and is the devBackend account", async () => {
    const dev = new DevBackend();
    expect(dev.accountId).toBe("devBackend");
    expect(dev.userId).toBe("@alice:dev.local");
    expect(dev.rooms()).toEqual([]);
    expect(dev.snapshot()).toEqual({ rooms: [], userId: "@alice:dev.local", scheduled: [], toDevice: [], failSends: false, media: [] });
    expect((await dev.account()).userId).toBe("@alice:dev.local");
    expect(await dev.needsVerification()).toBe(false);
    expect(await dev.widgets("!nope:dev.local")).toEqual([]);
    await expect(dev.backendFor("!nope:dev.local")).rejects.toThrow("unknown room");
    await dev.suspend();
    await dev.resume();
  });

  it("adds rooms with a create event, a name and the user as member, sorted by name", async () => {
    const dev = new DevBackend();
    const changed = vi.fn();
    dev.onRoomsChanged(changed);

    const b = dev.addRoom({ name: "Beta" });
    const a = dev.addRoom({ id: "!a:dev.local", name: "Alpha" });
    expect(b).toBe("!room1:dev.local");
    expect(changed).toHaveBeenCalledTimes(2);
    expect(dev.rooms()).toEqual([
      { id: a, name: "Alpha", widgetEvents: [], memberCount: 1 },
      { id: b, name: "Beta", widgetEvents: [], memberCount: 1 },
    ]);
    expect((await dev.roomState(a)).map((e) => `${e.type}|${e.state_key}`)).toEqual(["m.room.create|", "m.room.member|@alice:dev.local", "m.room.name|"]);
    expect(dev.snapshot().rooms.map((r) => r.id)).toEqual([b, a]); // in the order they were added
    expect(() => dev.addRoom({ id: a })).toThrow("exists already");

    // The backend reports the room and the user to a widget.
    const backend = await dev.backendFor(a);
    expect(backend.roomId()).toBe(a);
    expect(backend.ownUserId()).toBe("@alice:dev.local");

    dev.removeRoom(b);
    expect(dev.rooms().map((r) => r.id)).toEqual([a]);
    expect(() => dev.removeRoom(b)).toThrow("unknown room");
  });

  it("takes name, topic, members and encryption from the state", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom({ name: "Old name" });
    await dev.sendState(room, { type: "m.room.name", stateKey: "", content: { name: "New name" } });
    await dev.sendState(room, { type: "m.room.topic", stateKey: "", content: { topic: "About things" } });
    await dev.sendState(room, { type: "m.room.member", stateKey: "@bob:dev.local", content: { membership: "join", displayname: "Bob" } });
    await dev.sendState(room, { type: "m.room.member", stateKey: "@gone:dev.local", content: { membership: "leave" } });
    await dev.sendState(room, { type: "m.room.power_levels", stateKey: "", content: { users: { "@bob:dev.local": 100 } } });

    expect(dev.rooms()).toEqual([{ id: room, name: "New name", widgetEvents: [], memberCount: 2 }]);
    expect(await dev.roomDetails(room)).toEqual({
      topic: "About things",
      encrypted: false,
      memberCount: 2,
      members: [{ userId: "@alice:dev.local" }, { userId: "@bob:dev.local", displayName: "Bob", role: "Admin" }],
    });
    await dev.sendState(room, { type: "m.room.encryption", stateKey: "", content: { algorithm: "m.megolm.v1.aes-sha2" } });
    expect((await dev.roomDetails(room)).encrypted).toBe(true);
    await expect(dev.sendState(room, { type: "m.room.name" } as never)).rejects.toThrow("stateKey");
  });

  it("clears a room but keeps it recognisable", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom({ name: "Lab" });
    await dev.sendState(room, { type: EXAMPLE_NEW.type, stateKey: EXAMPLE_NEW.state_key, content: EXAMPLE_NEW.content });
    await dev.sendEvent(room, { type: "m.room.message", content: { body: "hi" } });
    await dev.sendEvent(room, { type: "m.room.message", content: { body: "later" } }, 1000);

    dev.clearRoom(room);
    expect((await dev.timeline(room)).events).toHaveLength(3);
    expect(dev.snapshot(room).scheduled).toEqual([]);
    expect(dev.rooms()).toEqual([{ id: room, name: "Lab", widgetEvents: [], memberCount: 1 }]);
  });

  it("drops everything on logout", async () => {
    const dev = new DevBackend();
    dev.addRoom();
    dev.addMedia([{ data: bytes("x") }]);
    dev.sendToDevice({ type: "t", userId: "@bob:dev.local", deviceId: "B", encrypted: false, content: {} });
    dev.setFailSends(true);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const notified = vi.fn();
    dev.subscribe(notified);

    await dev.logout();
    expect(notified).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(dev.snapshot()).toEqual({ rooms: [], userId: "@alice:dev.local", scheduled: [], toDevice: [], failSends: false, media: [] });
    revoke.mockRestore();
  });
});

describe("DevBackend: widgets from the room state", () => {
  it("adds, replaces and removes widgets by state events, telling the room view each time", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom();
    const other = dev.addRoom();
    const changed = vi.fn();
    const otherChanged = vi.fn();
    const stop = dev.onWidgetsChanged(room, changed);
    dev.onWidgetsChanged(other, otherChanged);
    const send = (event: { type: string; state_key: string; content: Record<string, unknown> }) =>
      dev.sendState(room, { type: event.type, stateKey: event.state_key, content: event.content });

    await send(EXAMPLE_NEW);
    await send(EXAMPLE_LEGACY);
    expect(await dev.widgets(room)).toEqual([EXAMPLE_NEW, EXAMPLE_LEGACY]);
    expect(dev.rooms().find((r) => r.id === room)?.widgetEvents).toEqual([EXAMPLE_NEW, EXAMPLE_LEGACY]);
    expect(await dev.widgets(other)).toEqual([]);

    // Editing a widget keeps its place.
    const renamed = { ...EXAMPLE_NEW, content: { ...EXAMPLE_NEW.content, name: "Renamed" } };
    await send(renamed);
    expect(await dev.widgets(room)).toEqual([renamed, EXAMPLE_LEGACY]);

    // Removing a widget leaves an event without `url` behind.
    await send({ ...EXAMPLE_NEW, content: {} });
    expect(await dev.widgets(room)).toEqual([EXAMPLE_LEGACY]);
    expect(dev.rooms().find((r) => r.id === room)?.widgetEvents).toHaveLength(2);

    expect(changed).toHaveBeenCalledTimes(4);
    expect(otherChanged).not.toHaveBeenCalled();
    await dev.sendEvent(room, { type: "m.room.message", content: { body: "not a widget" } });
    expect(changed).toHaveBeenCalledTimes(4);
    stop();
    await send(EXAMPLE_NEW);
    expect(changed).toHaveBeenCalledTimes(4);
  });

  it("sees a widget that a widget added, once refreshed", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom();
    const { ask, grant } = behindDriver(await dev.backendFor(room));
    await grant([`widget:${X}send_event.state:m.widget`]);
    await ask(`${X}send_event`, { type: "m.widget", state_key: "added", content: { url: "https://widget.example/", name: "Added" } });

    expect(await dev.widgets(room)).toEqual([]);
    expect(dev.refresh()).toBe(true);
    expect(await dev.widgets(room)).toEqual([{ type: "m.widget", state_key: "added", content: { url: "https://widget.example/", name: "Added" } }]);
    expect(dev.refresh()).toBe(false);
  });
});

describe("DevBackend: events", () => {
  it("injects timeline events with an id, the time and a default sender", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom();
    const before = Date.now();
    const first = await dev.sendEvent(room, { type: "m.room.message", content: { body: "one" } });
    await dev.sendEvent(room, { type: "m.room.message", sender: "@bob:dev.local", content: { body: "two" } });

    const [one, two] = (await dev.timeline(room)).events.slice(-2);
    expect(two).toMatchObject({ type: "m.room.message", sender: "@bob:dev.local", content: { body: "two" } });
    expect(one).toMatchObject({ event_id: first, sender: "@alice:dev.local", content: { body: "one" } });
    expect(one.origin_server_ts).toBeGreaterThanOrEqual(before);
    expect(two.event_id).not.toBe(one.event_id);
    await expect(dev.sendEvent(room, { type: "", content: {} })).rejects.toThrow("type");
    await expect(dev.sendEvent("!nope:dev.local", { type: "m.room.message", content: {} })).rejects.toThrow("unknown room");
  });

  it("gives an event a widget sent the time it was first seen", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom();
    const { ask, grant } = behindDriver(await dev.backendFor(room));
    await grant([`widget:${X}send_event.timeline:m.room.message`]);
    const before = Date.now();
    const sent = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "from the widget" } });
    dev.refresh();

    const newest = (await dev.timeline(room)).events.at(-1)!;
    expect(newest.event_id).toBe(sent.event_id);
    expect(newest.origin_server_ts).toBeGreaterThanOrEqual(before);
    const exported = await dev.exportRoom(room, 1);
    expect(exported.timeline).toEqual([expect.objectContaining({ event_id: sent.event_id, origin_server_ts: newest.origin_server_ts, room_id: room })]);
  });

  it("has the RoomTimeline of a room: every event oldest first, the start always reached; its listeners hear what refresh() finds in that room", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom({ name: "Lab" });
    const other = dev.addRoom();
    const changed = vi.fn();
    const otherChanged = vi.fn();
    const stop = dev.onTimelineChanged(room, changed);
    dev.onTimelineChanged(other, otherChanged);

    const start = await dev.timeline(room);
    expect(start.atStart).toBe(true);
    expect(start.loadingOlder).toBe(false);
    expect(start.events.map((ev) => ev.type)).toEqual(["m.room.create", "m.room.name", "m.room.member"]);
    // Unchanged, the same list: the view renders nothing again.
    expect((await dev.timeline(room)).events).toBe(start.events);

    await dev.sendEvent(room, { type: "m.room.message", content: { body: "one" } });
    expect(changed).toHaveBeenCalledTimes(1);
    expect((await dev.timeline(room)).events.at(-1)).toMatchObject({ type: "m.room.message", sender: "@alice:dev.local", content: { body: "one" }, room_id: room });

    // A widget's event, once refreshed.
    const { ask, grant } = behindDriver(await dev.backendFor(room));
    await grant([`widget:${X}send_event.timeline:org.example.ping`]);
    const sent = await ask(`${X}send_event`, { type: "org.example.ping", content: { seq: 1 } });
    expect(changed).toHaveBeenCalledTimes(1);
    dev.refresh();
    expect(changed).toHaveBeenCalledTimes(2);
    expect((await dev.timeline(room)).events.at(-1)).toMatchObject({ event_id: sent.event_id, type: "org.example.ping" });
    dev.refresh();
    expect(changed).toHaveBeenCalledTimes(2);

    await dev.loadOlderEvents();
    expect(otherChanged).not.toHaveBeenCalled();
    stop();
    await dev.sendEvent(room, { type: "m.room.message", content: { body: "two" } });
    expect(changed).toHaveBeenCalledTimes(2);
    await expect(dev.timeline("!nope:dev.local")).rejects.toThrow("unknown room");
  });

  it("schedules delayed events in the backend, next to the ones a widget scheduled", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom();
    const { ask, grant } = behindDriver(await dev.backendFor(room));
    await grant([`widget:org.matrix.msc4157.send_delayed_event.timeline:m.room.message`, `widget:org.matrix.msc4157.update_delayed_event`]);

    const before = Date.now();
    const hostTimeline = await dev.sendEvent(room, { type: "m.room.message", content: { body: "later" } }, 5000);
    const hostState = await dev.sendState(room, { type: "m.room.topic", stateKey: "", content: { topic: "later" } }, 7000);
    expect(dev.snapshot(room).scheduled).toEqual([
      { delayId: hostTimeline, type: "m.room.message", delayMs: 5000, restarts: 0, scheduledAt: expect.any(Number) },
      { delayId: hostState, type: "m.room.topic", stateKey: "", delayMs: 7000, restarts: 0, scheduledAt: expect.any(Number) },
    ]);
    expect(dev.snapshot(room).scheduled[0].scheduledAt).toBeGreaterThanOrEqual(before);
    await expect(dev.sendEvent(room, { type: "m.room.message", sender: "@bob:dev.local", content: {} }, 10)).rejects.toThrow("always sent by");

    await dev.updateScheduled(room, hostTimeline, "restart");
    expect(dev.snapshot(room).scheduled[0].restarts).toBe(1);
    await dev.updateScheduled(room, hostTimeline, "cancel");
    expect(dev.snapshot(room).scheduled.map((s) => s.delayId)).toEqual([hostState]);

    await dev.updateScheduled(room, hostState, "send");
    expect(dev.snapshot(room).scheduled).toEqual([]);
    expect((await dev.roomDetails(room)).topic).toBe("later");
    await expect(dev.updateScheduled(room, hostState, "send")).rejects.toThrow();
  });

  it("makes the widgets' sends fail, not the host's", async () => {
    const dev = new DevBackend();
    const room = dev.addRoom();
    const { ask, grant } = behindDriver(await dev.backendFor(room));
    await grant([`widget:${X}send_event.timeline:m.room.message`]);

    dev.setFailSends(true);
    expect(dev.failSends()).toBe(true);
    expect(dev.snapshot().failSends).toBe(true);
    const failed = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } });
    expect((failed.error as { message: string }).message).toContain("simulated failure");

    await dev.sendEvent(room, { type: "m.room.message", content: { body: "from the host" } });
    const delayId = await dev.sendEvent(room, { type: "m.room.message", content: { body: "later" } }, 100);
    await dev.fireDelayedEvent(room, delayId);
    expect((await dev.timeline(room)).events.slice(-2).map((e) => e.content.body)).toEqual(["from the host", "later"]);
    // Still on for the widget.
    expect((await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } })).error).toBeDefined();

    dev.setFailSends(false);
    expect((await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } })).event_id).toBeDefined();
  });

  it("fails the widgets' sends in every room, also in rooms added later", async () => {
    const dev = new DevBackend();
    const before = dev.addRoom();
    dev.setFailSends(true);
    const after = dev.addRoom();
    for (const room of [before, after]) {
      const { ask, grant } = behindDriver(await dev.backendFor(room));
      await grant([`widget:${X}send_event.timeline:m.room.message`]);
      expect((await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } })).error).toBeDefined();
    }
  });
});

describe("DevBackend: what the rooms share", () => {
  it("has host uploads in every room, also in rooms added later", async () => {
    const dev = new DevBackend();
    const a = dev.addRoom();
    const [named, generated] = dev.addMedia([
      { mxcUri: "mxc://dev.local/notes", name: "notes.txt", mimetype: "text/plain", data: bytes("notes") },
      { data: bytes("anonymous") },
    ]);
    const b = dev.addRoom();
    expect(named).toBe("mxc://dev.local/notes");
    expect(generated).toMatch(/^mxc:\/\/dev\.local\/upload-\d+$/);

    for (const room of [a, b]) {
      const backend = await dev.backendFor(room);
      expect(text((await backend.downloadMedia(named)).data)).toBe("notes");
      expect(text((await backend.downloadMedia(generated)).data)).toBe("anonymous");
    }
    expect(dev.snapshot().media).toEqual([
      { mxcUri: named, bytes: 5, mimetype: "text/plain", name: "notes.txt", url: expect.stringMatching(/^blob:/) },
      { mxcUri: generated, bytes: 9, url: expect.stringMatching(/^blob:/) },
    ]);
    expect(() => dev.addMedia([{ mxcUri: "https://example.org/x", data: bytes("x") }])).toThrow("mxc://");
  });

  it("mirrors what a widget uploaded in one room to the others on refresh", async () => {
    const dev = new DevBackend();
    const a = dev.addRoom();
    const b = dev.addRoom();
    const inA = await dev.backendFor(a);
    const inB = await dev.backendFor(b);

    const uri = await inA.uploadMedia({ data: bytes("from a widget"), mimetype: "text/plain" });
    await expect(inB.downloadMedia(uri)).rejects.toThrow();
    expect(dev.refresh("!a|m.widget/w")).toBe(true);
    expect(text((await inB.downloadMedia(uri)).data)).toBe("from a widget");

    const media = dev.snapshot().media;
    expect(media).toEqual([{ mxcUri: uri, bytes: 13, mimetype: "text/plain", uploadedBy: "!a|m.widget/w", url: expect.stringMatching(/^blob:/) }]);
    // The object URL is created once per file.
    expect(dev.refresh()).toBe(false);
    expect(dev.snapshot().media).toBe(media);

    // Replacing a file gives it a new URL and releases the old one.
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    dev.addMedia([{ mxcUri: uri, data: bytes("replaced") }]);
    expect(revoke).toHaveBeenCalledWith(media[0].url);
    expect(text((await inA.downloadMedia(uri)).data)).toBe("replaced");
    expect(dev.snapshot().media[0].url).not.toBe(media[0].url);
    revoke.mockRestore();
  });

  it("delivers a to-device message in every room and lists both directions", async () => {
    const dev = new DevBackend();
    const a = dev.addRoom();
    const b = dev.addRoom();
    const widgetA = behindDriver(await dev.backendFor(a));
    const widgetB = behindDriver(await dev.backendFor(b));
    const capabilities = [`widget:${X}send_to_device:org.example.ping`, `host:${X}forward_to_device:org.example.ping`];
    await widgetA.grant(capabilities);
    await widgetB.grant(capabilities);
    widgetA.pushed("");
    widgetB.pushed("");

    dev.sendToDevice({ type: "org.example.ping", userId: "@bob:dev.local", deviceId: "BOB", encrypted: false, content: { n: 1 }, timestamp: 5 });
    await tick();
    for (const widget of [widgetA, widgetB]) {
      const forwarded = widget.pushed(`${X}forward_to_device`);
      expect(forwarded).toHaveLength(1);
      expect(forwarded[0]).toMatchObject({ type: "org.example.ping", sender: "@bob:dev.local", content: { n: 1 } });
    }

    const before = Date.now();
    await widgetA.ask(`${X}send_to_device`, { type: "org.example.ping", encrypted: false, messages: { "@bob:dev.local": { BOB: { n: 2 } } } });
    await widgetB.ask(`${X}send_to_device`, { type: "org.example.ping", encrypted: false, messages: { "@carol:dev.local": { CAROL: { n: 3 } } } });
    expect(dev.refresh()).toBe(true);

    const { toDevice } = dev.snapshot();
    // Newest first.
    expect(toDevice).toEqual([
      { direction: "fromWidget", timestamp: expect.any(Number), type: "org.example.ping", userId: "@carol:dev.local", deviceId: "CAROL", encrypted: false, content: { n: 3 } },
      { direction: "fromWidget", timestamp: expect.any(Number), type: "org.example.ping", userId: "@bob:dev.local", deviceId: "BOB", encrypted: false, content: { n: 2 } },
      { direction: "toWidget", timestamp: 5, type: "org.example.ping", userId: "@bob:dev.local", deviceId: "BOB", encrypted: false, content: { n: 1 } },
    ]);
    expect(toDevice[0].timestamp).toBeGreaterThanOrEqual(before);

    // The log is the account's: it outlives a cleared and a removed room, and timestamps stay.
    dev.clearRoom(a);
    dev.removeRoom(b);
    expect(dev.snapshot().toDevice).toEqual(toDevice);
    expect(() => dev.sendToDevice({ userId: "@bob:dev.local" } as never)).toThrow("type");
  });

  it("gives TURN credentials and RTC transports to every room, also to rooms added later", async () => {
    const dev = new DevBackend();
    const a = dev.addRoom();
    dev.setRtcTransports([{ type: "livekit", livekit_service_url: "https://livekit.example.org" }]);
    dev.setTurnServer({ uris: ["turn:turn.example.org"], username: "u", password: "p" });
    dev.setRoomAccountData(a, "m.tag", { tags: {} });
    const b = dev.addRoom();

    for (const room of [a, b]) {
      const backend = await dev.backendFor(room);
      expect(await backend.rtcTransports()).toEqual([{ type: "livekit", livekit_service_url: "https://livekit.example.org" }]);
      // A widget that starts watching gets the current credentials at once.
      const { ask, grant, pushed } = behindDriver(backend);
      await grant([`host:${X}update_turn_servers`]);
      await ask(`${X}watch_turn_servers`);
      expect(pushed(`${X}update_turn_servers`)).toEqual([{ uris: ["turn:turn.example.org"], username: "u", password: "p" }]);
    }
    expect(await dev.store(a).readRoomAccountData(a, "m.tag")).toHaveLength(1);
    expect(await dev.store(b).readRoomAccountData(b, "m.tag")).toHaveLength(0);
  });
});

describe("DevBackend: snapshot", () => {
  it("is the same object until something changes, and keeps the parts that did not change", async () => {
    const dev = new DevBackend();
    const a = dev.addRoom({ name: "A" });
    const b = dev.addRoom({ name: "B" });
    dev.addMedia([{ data: bytes("x") }]);
    const notified = vi.fn();
    const stop = dev.subscribe(notified);

    const first = dev.snapshot(a);
    expect(dev.snapshot(a)).toBe(first);
    expect(dev.refresh()).toBe(false);
    expect(dev.snapshot(a)).toBe(first);
    expect(dev.snapshot(b)).not.toBe(first);
    expect(dev.snapshot(b).rooms).toBe(first.rooms);
    expect(dev.snapshot("!nope:dev.local").scheduled).toEqual([]);
    const stateA = await dev.roomState(a);
    const eventsA = (await dev.timeline(a)).events;
    expect(notified).not.toHaveBeenCalled();

    // A change in room B: room A's lists, the rooms and the media keep their identity.
    await dev.sendEvent(b, { type: "m.room.message", content: { body: "hi" } });
    expect(notified).toHaveBeenCalledTimes(1);
    const second = dev.snapshot(a);
    expect(second).not.toBe(first);
    expect(second.scheduled).toBe(first.scheduled);
    expect(await dev.roomState(a)).toBe(stateA);
    expect((await dev.timeline(a)).events).toBe(eventsA);
    expect(second.rooms).toBe(first.rooms);
    expect(second.media).toBe(first.media);
    expect(second.toDevice).toBe(first.toDevice);
    expect((await dev.timeline(b)).events.at(-1)!.content).toEqual({ body: "hi" });

    // A widget's write is only seen by refresh().
    await (await dev.backendFor(a)).sendRoomEvent(a, "m.room.message", { body: "from a widget" });
    expect(dev.snapshot(a)).toBe(second);
    expect(dev.refresh()).toBe(true);
    expect(notified).toHaveBeenCalledTimes(2);
    expect((await dev.timeline(a)).events).toHaveLength(eventsA.length + 1);

    await dev.sendState(a, { type: "m.room.name", stateKey: "", content: { name: "A2" } });
    expect(dev.snapshot(a).rooms).toEqual([{ id: a, name: "A2" }, { id: b, name: "B" }]);

    stop();
    dev.addRoom();
    expect(notified).toHaveBeenCalledTimes(3);
  });
});

describe("DevBackend: seeds", () => {
  const seed: DevBackendSeed = {
    userId: "@dev:seed.local",
    rooms: [
      {
        id: "!one:seed.local",
        name: "One",
        topic: "The first",
        members: [{ userId: "@bob:seed.local", displayName: "Bob" }, { userId: "@carol:seed.local" }],
        widgets: [EXAMPLE_NEW, EXAMPLE_LEGACY],
        state: [{ type: "m.room.join_rules", stateKey: "", content: { join_rule: "invite" } }],
        timeline: [
          { type: "m.room.message", sender: "@bob:seed.local", content: { msgtype: "m.text", body: "hi" } },
          { type: "m.room.message", content: { msgtype: "m.text", body: "hello" } },
        ],
      },
      { id: "!two:seed.local", name: "Two" },
    ],
    media: [
      { mxcUri: "mxc://seed.local/notes", name: "notes.txt", mimetype: "text/plain", text: "some notes" },
      { mxcUri: "mxc://seed.local/bin", mimetype: "application/octet-stream", base64: "AAECAwQ=" },
    ],
    failSends: true,
  };

  it("builds the rooms, widgets, members, messages and media of a seed", async () => {
    const dev = await DevBackend.fromSeed(seed);
    expect(dev.userId).toBe("@dev:seed.local");
    expect(dev.rooms()).toEqual([
      { id: "!one:seed.local", name: "One", widgetEvents: [EXAMPLE_NEW, EXAMPLE_LEGACY], memberCount: 3 },
      { id: "!two:seed.local", name: "Two", widgetEvents: [], memberCount: 1 },
    ]);
    expect(await dev.roomDetails("!one:seed.local")).toMatchObject({ topic: "The first", memberCount: 3 });
    expect(dev.failSends()).toBe(true);
    expect((await dev.timeline("!one:seed.local")).events.slice(-2)).toMatchObject([
      { sender: "@bob:seed.local", content: { body: "hi" } },
      { sender: "@dev:seed.local", content: { body: "hello" } },
    ]);
    const backend = await dev.backendFor("!two:seed.local");
    expect(text((await backend.downloadMedia("mxc://seed.local/notes")).data)).toBe("some notes");
    expect(new Uint8Array((await backend.downloadMedia("mxc://seed.local/bin")).data)).toEqual(new Uint8Array([0, 1, 2, 3, 4]));
  });

  it("round-trips through toSeed()", async () => {
    const dev = await DevBackend.fromSeed(seed);
    const exported = dev.toSeed();
    expect(exported).toEqual(seed);
    expect(validateSeed(JSON.parse(JSON.stringify(exported)))).toEqual(seed);
    expect((await DevBackend.fromSeed(exported)).toSeed()).toEqual(seed);
  });

  it("resets an instance to exactly the seed", async () => {
    const dev = new DevBackend();
    dev.addRoom({ name: "Before" });
    dev.addMedia([{ data: bytes("before") }]);
    dev.sendToDevice({ type: "t", userId: "@bob:dev.local", deviceId: "B", encrypted: false, content: {} });
    const notified = vi.fn();
    dev.subscribe(notified);

    await dev.populate(seed);
    expect(notified).toHaveBeenCalledTimes(1);
    expect(dev.toSeed()).toEqual(seed);
    expect(dev.snapshot().toDevice).toEqual([]);

    // An invalid seed changes nothing.
    await expect(dev.populate({ rooms: [{ name: 1 }] } as never)).rejects.toThrow("seed.rooms[0].name");
    expect(dev.toSeed()).toEqual(seed);
    await dev.populate({});
    expect(dev.toSeed()).toEqual({});
  });

  it("explains what is wrong with a seed", () => {
    const error = (json: unknown) => {
      try {
        validateSeed(json);
      } catch (e) {
        return (e as Error).message;
      }
      return "valid";
    };
    expect(error([])).toBe("Invalid DevBackend seed: seed: expected an object, got an array");
    expect(error({ room: [] })).toBe("Invalid DevBackend seed: seed.room: unknown field (known: userId, rooms, media, demoMedia, failSends)");
    expect(error({ userId: "alice" })).toContain("seed.userId: expected a user id like @alice:dev.local");
    expect(error({ rooms: [{ id: "!a:b", name: "A" }, { id: "!a:b", name: "B" }] })).toContain("seed.rooms[1].id: !a:b is used by an earlier room");
    expect(error({ rooms: [{}] })).toContain("seed.rooms[0].name: expected a string, got a undefined");
    expect(error({ rooms: [{ name: "A", widgets: [{ type: "m.widget", stateKey: "w", content: {} }] }] })).toContain("seed.rooms[0].widgets[0].stateKey: unknown field");
    expect(error({ rooms: [{ name: "A", timeline: [{ type: "m.room.message", content: "hi" }] }] })).toContain("seed.rooms[0].timeline[0].content: expected an object, got a string");
    expect(error({ media: [{ mxcUri: "mxc://a/b" }] })).toContain("seed.media[0]: expected exactly one of base64, text and url, got none");
    expect(error({ media: [{ text: "a", url: "b" }] })).toContain("got text and url");
    expect(error({ media: [{ base64: "%%%" }] })).toContain("seed.media[0].base64: not valid base64");
    expect(error({ demoMedia: "yes" })).toContain("seed.demoMedia: expected true or false");
    expect(error({})).toBe("valid");
  });

  it("fetches demo media and media given by URL", async () => {
    const fetched = stubFetch();
    const dev = await DevBackend.fromSeed({ demoMedia: true, media: [{ url: "files/readme.txt?v=1" }] });
    expect(fetched).toEqual(["demo/landscape.png", "demo/tiles.png", "demo/notes.txt", "files/readme.txt?v=1"]);
    expect(dev.snapshot().media.map(({ mxcUri, name, mimetype }) => ({ mxcUri, name, mimetype }))).toEqual([
      { mxcUri: "mxc://example.org/demo-landscape", name: "landscape.png", mimetype: "image/png" },
      { mxcUri: "mxc://example.org/demo-tiles", name: "tiles.png", mimetype: "image/png" },
      { mxcUri: "mxc://example.org/demo-notes", name: "notes.txt", mimetype: "text/plain" },
      { mxcUri: expect.stringMatching(/^mxc:\/\/dev\.local\/upload-/), name: "readme.txt", mimetype: "text/plain" },
    ]);
    expect(await seedDemoMedia(dev)).toHaveLength(3);
    expect(dev.snapshot().media).toHaveLength(4);
    await expect(DevBackend.fromSeed({ media: [{ url: "missing.png" }] })).rejects.toThrow("could not load missing.png: HTTP 404");
  });

  it("reads the example seeds of the end-to-end tests", async () => {
    stubFetch();
    const lab = await DevBackend.fromSeed(validateSeed(seedFile("lab.json")));
    expect(lab.rooms()).toEqual([{ id: "!lab:dev.local", name: "Widget lab", widgetEvents: [EXAMPLE_NEW, EXAMPLE_LEGACY], memberCount: 3 }]);
    expect((await lab.timeline("!lab:dev.local")).events.filter((e) => e.type === "m.room.message")).toHaveLength(3);
    expect(lab.snapshot().media).toHaveLength(3);

    const two = await DevBackend.fromSeed(validateSeed(seedFile("two-rooms.json")));
    expect(two.rooms().map((r) => [r.id, r.name, r.widgetEvents?.length, r.memberCount])).toEqual([
      ["!standup:dev.local", "Standup", 1, 2],
      ["!lab:dev.local", "Widget lab", 2, 3],
    ]);
  });
});

describe("DevBackend: copy to DevBackend", () => {
  const exported = {
    roomId: "!real:example.org",
    name: "Real room",
    state: [
      { type: "m.room.create", state_key: "", sender: "@bob:example.org", event_id: "$create", origin_server_ts: 1_700_000_000_000, content: { room_version: "11" } },
      { type: "m.room.name", state_key: "", sender: "@bob:example.org", event_id: "$name2", origin_server_ts: 1_700_000_003_000, content: { name: "Real room" } },
      { type: "m.room.member", state_key: "@bob:example.org", sender: "@bob:example.org", event_id: "$bob", origin_server_ts: 1_700_000_001_000, content: { membership: "join", displayname: "Bob" } },
      { type: "m.widget", state_key: "w", sender: "@bob:example.org", event_id: "$widget", origin_server_ts: 1_700_000_004_000, content: { url: "https://widget.example/", name: "W" } },
    ],
    timeline: [
      // Superseded and current state events of the timeline are not stored a second time.
      { type: "m.room.name", state_key: "", sender: "@bob:example.org", event_id: "$name1", origin_server_ts: 1_700_000_002_000, content: { name: "Old name" } },
      { type: "m.room.name", state_key: "", sender: "@bob:example.org", event_id: "$name2", origin_server_ts: 1_700_000_003_000, content: { name: "Real room" } },
      { type: "m.room.message", sender: "@bob:example.org", event_id: "$msg", origin_server_ts: 1_700_000_005_000, content: { msgtype: "m.text", body: "hello" }, unsigned: { age: 5 } },
    ],
  };

  it("creates a mocked room from the copy of a real one", async () => {
    const dev = new DevBackend();
    const copiedFrom = { accountId: "account-1", roomId: "!real:example.org" };
    const room = dev.importRoom(exported, copiedFrom);

    expect(room).toBe("!copy1:dev.local");
    expect(dev.snapshot().rooms).toEqual([{ id: room, name: "Real room", copiedFrom }]);
    expect(dev.rooms()).toEqual([
      { id: room, name: "Real room", widgetEvents: [{ type: "m.widget", state_key: "w", content: { url: "https://widget.example/", name: "W" } }], memberCount: 2 },
    ]);
    expect(await dev.roomDetails(room)).toMatchObject({ members: [{ userId: "@alice:dev.local" }, { userId: "@bob:example.org", displayName: "Bob" }] });

    const { events } = await dev.timeline(room);
    expect(events.at(-2)).toEqual({ type: "m.room.message", sender: "@bob:example.org", event_id: "$msg", room_id: room, origin_server_ts: 1_700_000_005_000, content: { msgtype: "m.text", body: "hello" }, unsigned: { age: 5 } });
    expect(events.map((e) => e.event_id)).not.toContain("$name1");
    expect(events.filter((e) => e.event_id === "$name2")).toHaveLength(1);

    // A widget reads the copy under the new room id.
    const { ask, grant } = behindDriver(await dev.backendFor(room));
    await grant(["widget:org.matrix.msc2876.read_events.timeline:m.room.message"]);
    const read = await ask("org.matrix.msc2876.read_events", { type: "m.room.message", limit: 10 });
    expect(read.events).toEqual([expect.objectContaining({ event_id: "$msg", room_id: room, unsigned: { age: 5 } })]);

    // A second copy is a second room.
    expect(dev.importRoom(exported)).toBe("!copy2:dev.local");
    expect(dev.snapshot().rooms[1]).toEqual({ id: "!copy2:dev.local", name: "Real room" });
  });

  it("names a room without a name event, and copies what exportRoom gives", async () => {
    const dev = new DevBackend();
    const dm = dev.importRoom({ roomId: "!dm:example.org", name: "Bob", state: [], timeline: [] });
    expect(dev.rooms()).toEqual([{ id: dm, name: "Bob", widgetEvents: [], memberCount: 1 }]);

    await dev.sendEvent(dm, { type: "m.room.message", content: { body: "one" } });
    await dev.sendEvent(dm, { type: "m.room.message", content: { body: "two" } });
    const again = await dev.exportRoom(dm, 1);
    expect(again.timeline.map((e) => e.content.body)).toEqual(["two"]);
    expect(again.state).toHaveLength(2);
    const copy = dev.importRoom(again, { accountId: dev.accountId, roomId: dm });
    // The same events, but for the room id.
    const inRoom = ({ room_id: _, ...event }: RawEvent) => event;
    const content = ({ type, state_key, content }: RawEvent) => ({ type, state_key, content });
    expect((await dev.roomState(copy)).map(content)).toEqual((await dev.roomState(dm)).map(content));
    expect(inRoom((await dev.timeline(copy)).events.at(-1)!)).toEqual(inRoom((await dev.timeline(dm)).events.at(-1)!));
  });
});
