/**
 * The DevBackend: an in-memory stand-in for a logged-in client, with any number of mocked rooms.
 * It implements `LiveSession`, so it is one more account and the host's views work on it
 * unchanged; on top of that it has the editing API behind the DevBackendView and an observable
 * snapshot (`subscribe` / `snapshot`) of its content. Nothing leaves the page.
 *
 * Every mocked room is one `InMemoryBackend` of the Rust crate (that type is exactly one room).
 * What is account-scoped on a real homeserver (media, to-device messages, TURN credentials, RTC
 * transports) is kept in sync across the rooms' backends here.
 */
import { InMemoryBackend, PaginationStatus, type InMemoryBackendLike, type MatrixEvent, type TurnServer } from "@matrix-widget-sdk/host";

import type { MockedPagination, MockedRoomData, MockedStateEvent, MockedTimelineEvent, ScheduledEvent, ToDeviceMessage } from "../../appViewModel";
import { describesWidget } from "../../lib/widgetEvents";
import type { AccountInfo, LiveSession, RawEvent, RoomBackend, RoomDetails, RoomExport, RoomMember, RoomSummary, RoomTimeline } from "../../session";
import { WIDGET_EVENT_TYPES, type StateEvent } from "../../widgetStateEvent";
import { base64ToBytes, bytesToBase64, validateSeed, type DevBackendSeed, type SeedMedia, type SeedRoom } from "./seed";
import { rawTimelineViewModel } from "../timelineViewModel";

export type { DevBackendSeed } from "./seed";
export { validateSeed } from "./seed";

/** The `LiveSession.accountId` of the DevBackend: there is one per browser tab. */
export const DEV_BACKEND_ACCOUNT_ID = "devBackend";
const DEFAULT_USER_ID = "@alice:dev.local";
const DEVICE_ID = "DEVBACKEND";
const BASE_URL = "https://matrix.dev.local";
const FAIL_MESSAGE = "simulated failure (fail sends is on)";

/** A file for the media repository, as the host adds it. */
export interface MediaUpload {
  name?: string;
  mimetype?: string;
  data: ArrayBuffer;
  /** Default: a generated URI. An existing file under the same URI is replaced. */
  mxcUri?: string;
}

/**
 * Demo files (served from `public/demo/`), so a widget has something to `download_file`. The
 * first one is the test widgets' default URI.
 */
const DEMO_MEDIA = [
  { mxcUri: "mxc://example.org/demo-landscape", path: "demo/landscape.png", mimetype: "image/png" },
  { mxcUri: "mxc://example.org/demo-tiles", path: "demo/tiles.png", mimetype: "image/png" },
  { mxcUri: "mxc://example.org/demo-notes", path: "demo/notes.txt", mimetype: "text/plain" },
];

async function fetchBytes(url: string): Promise<{ data: ArrayBuffer; mimetype?: string }> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`could not load ${url}: HTTP ${response.status}`);
  return { data: await response.arrayBuffer(), mimetype: response.headers.get("content-type")?.split(";")[0] || undefined };
}

async function loadDemoMedia(): Promise<MediaUpload[]> {
  return Promise.all(
    DEMO_MEDIA.map(async ({ mxcUri, path, mimetype }) => ({ mxcUri, mimetype, name: path.split("/").pop(), data: (await fetchBytes(path)).data })),
  );
}

/** Put the demo files into the DevBackend's media repository. Returns their `mxc://` URIs. */
export async function seedDemoMedia(backend: DevBackend): Promise<string[]> {
  return backend.addMedia(await loadDemoMedia());
}

interface Member extends RoomMember {
  joined: boolean;
}

/** What is derived from one room's backend. Rebuilt (as new objects) only when the room changed. */
interface RoomContent {
  name: string;
  avatarUrl?: string;
  topic?: string;
  encrypted: boolean;
  members: Member[];
  /** Every state event of a widget event type, in the order the widgets were first added. */
  widgetEvents: StateEvent[];
  /** For `toSeed()`. */
  state: MockedStateEvent[];
  scheduled: ScheduledEvent[];
  /** The pagination of the timeline cache (widgets' `paginate_timeline`). */
  pagination: MockedPagination;
  /** Oldest first, as plain Matrix JSON: what `roomState()` and `timeline()` hand out. */
  raw: { state: RawEvent[]; timeline: RawEvent[] };
}

interface Room {
  id: string;
  store: InMemoryBackendLike;
  copiedFrom?: { accountId: string; roomId: string };
  /** Cheap fingerprint of the backend's content at the last `refresh()`. */
  stamp: string;
  content: RoomContent;
  /** When each scheduled event was scheduled or last restarted. */
  scheduledAt: Map<string, { at: number; restarts: number }>;
  /** When an event sent by a widget was first seen (its `origin_server_ts` is a counter). */
  firstSeen: Map<string, number>;
  /** How many entries of the backend's `toDeviceSent()` are in the account's log already. */
  toDeviceSeen: number;
  /** What the listeners of `onRoomsChanged` / `onWidgetsChanged` were last told about, as JSON. */
  summaryJson: string;
  widgetsJson: string;
}

interface StoredFile {
  mxcUri: string;
  data: ArrayBuffer;
  mimetype?: string;
  name?: string;
  uploadedBy?: string;
  /** An object URL; revoked when the file is replaced and on logout. */
  url?: string;
}

const EMPTY_CONTENT: RoomContent = {
  name: "",
  encrypted: false,
  members: [],
  widgetEvents: [],
  state: [],
  scheduled: [],
  pagination: { status: "idle" },
  raw: { state: [], timeline: [] },
};
const NO_SCHEDULED: ScheduledEvent[] = [];
/** The most messages "Resolve" (the pagination request of the room dev tools) generates at once. */
export const MAX_GENERATED_EVENTS = 1000;
const GREETINGS = ["Hi all,", "Quick note:", "Reminder:", "FYI", "Hm,", "Agreed.", "Back from lunch;", "Ok so"] as const;
const TOPICS = ["the build is green again", "who has the slides?", "standup moved to 10:30", "the widget loads now", "let's call later", "see the thread above", "nice work!", "the room key arrived"] as const;
const PAGINATION_STATUS: Record<PaginationStatus, MockedPagination["status"]> = {
  [PaginationStatus.Idle]: "idle",
  [PaginationStatus.Paginating]: "paginating",
  [PaginationStatus.StartReached]: "start_reached",
};

const asObject = (value: unknown): Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asString = (value: unknown): string | undefined => (typeof value === "string" && value !== "" ? value : undefined);
const serverOf = (id: string) => id.slice(id.indexOf(":") + 1) || "dev.local";

/** Add a listener to the set of a room. Returns the unsubscribe function. */
function listen(listeners: Map<string, Set<() => void>>, roomId: string, listener: () => void): () => void {
  const ofRoom = listeners.get(roomId) ?? new Set<() => void>();
  listeners.set(roomId, ofRoom);
  ofRoom.add(listener);
  return () => ofRoom.delete(listener);
}

function checkEvent(event: { type?: unknown; stateKey?: unknown; content?: unknown }, state: boolean): void {
  if (typeof event?.type !== "string" || event.type === "") throw new Error("an event needs a `type`");
  if (state && typeof event.stateKey !== "string") throw new Error("a state event needs a `stateKey` (it may be empty)");
  if (typeof event.content !== "object" || event.content === null || Array.isArray(event.content)) {
    throw new Error("an event needs a `content` object");
  }
}

export class DevBackend implements LiveSession {
  readonly accountId = DEV_BACKEND_ACCOUNT_ID;

  private user: string;
  /** In the order the rooms were added. */
  private readonly mocked = new Map<string, Room>();
  /** The account's media repository: host uploads and everything a widget uploaded in any room. */
  private readonly files = new Map<string, StoredFile>();
  /** Both directions, oldest first. */
  private toDeviceLog: ToDeviceMessage[] = [];
  /** "Fail sends": account-wide, so every room's backend fails a widget's sends, also a room added later. */
  private sendsFail = false;
  private turnServer?: TurnServer;
  private rtcTransports?: unknown;
  /** For generated ids. Never reset, so an id is not used twice in the lifetime of the page. */
  private counter = 0;

  /** Set by everything that changes something `refresh()` cannot see in the backends. */
  private dirty = false;
  private mediaDirty = false;
  private roomsData: MockedRoomData["rooms"] = [];
  private roomsJson = "[]";
  private toDeviceData: ToDeviceMessage[] = [];
  private mediaData: MockedRoomData["media"] = [];
  private readonly snapshots = new Map<string, MockedRoomData>();

  private readonly listeners = new Set<() => void>();
  private readonly roomListeners = new Set<() => void>();
  private readonly widgetListeners = new Map<string, Set<() => void>>();
  private readonly timelineListeners = new Map<string, Set<() => void>>();

  constructor(options: { userId?: string } = {}) {
    this.user = options.userId ?? DEFAULT_USER_ID;
  }

  /** A DevBackend with the content of `seed`. */
  static async fromSeed(seed: DevBackendSeed): Promise<DevBackend> {
    const backend = new DevBackend();
    await backend.populate(seed);
    return backend;
  }

  /** The user every mocked room is seen as (and the default sender of the send forms). */
  get userId(): string {
    return this.user;
  }

  // -------------------------------------------------------------------------------------------
  // LiveSession

  async account(): Promise<AccountInfo> {
    return { userId: this.user, displayName: "DevBackend", homeserver: "in-memory", deviceId: DEVICE_ID };
  }

  rooms(): RoomSummary[] {
    return [...this.mocked.values()]
      .map(({ id, content }) => ({
        id,
        name: content.name,
        ...(content.avatarUrl ? { avatarUrl: content.avatarUrl } : {}),
        widgetEvents: content.widgetEvents,
        memberCount: content.members.filter((m) => m.joined).length,
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  onRoomsChanged(listener: () => void): () => void {
    this.roomListeners.add(listener);
    return () => this.roomListeners.delete(listener);
  }

  /** A room avatar is shown if its `mxc://` URI is a file of the media repository. */
  async avatar(mxcUrl: string): Promise<string | undefined> {
    return this.files.get(mxcUrl)?.url;
  }

  async widgets(roomId: string): Promise<StateEvent[]> {
    return (this.mocked.get(roomId)?.content.widgetEvents ?? []).filter(describesWidget);
  }

  onWidgetsChanged(roomId: string, listener: () => void): () => void {
    return listen(this.widgetListeners, roomId, listener);
  }

  /** Every event of a mocked room, oldest first: the start of the room is always there. */
  async timeline(roomId: string): Promise<RoomTimeline> {
    return { events: this.room(roomId).content.raw.timeline, atStart: true, loadingOlder: false };
  }

  /** There is nothing older: `timeline()` has every event. */
  async loadOlderEvents(): Promise<void> {}

  /** Told by `refresh()` when the room's backend changed. */
  onTimelineChanged(roomId: string, listener: () => void): () => void {
    return listen(this.timelineListeners, roomId, listener);
  }

  timelineViewModel(roomId: string) {
    return rawTimelineViewModel(this, roomId);
  }

  /** Every widget of the room shares the room's backend. It lives as long as the room, so `dispose` does nothing. */
  async backendFor(roomId: string): Promise<RoomBackend> {
    return Object.assign(this.room(roomId).store.asBackend(), { dispose() {} });
  }

  async roomDetails(roomId: string): Promise<RoomDetails> {
    const { topic, encrypted, members } = this.room(roomId).content;
    const joined = members.filter((m) => m.joined).map(({ joined: _, ...member }) => member);
    return { ...(topic === undefined ? {} : { topic }), encrypted, memberCount: joined.length, members: joined };
  }

  async exportRoom(roomId: string, lastEvents: number): Promise<RoomExport> {
    const { name, raw } = this.room(roomId).content;
    return { roomId, name, state: await this.roomState(roomId), timeline: lastEvents > 0 ? raw.timeline.slice(-lastEvents) : [] };
  }

  /** The whole state of a mocked room. The same array until the room changes (`refresh()`). */
  async roomState(roomId: string): Promise<RawEvent[]> {
    return this.room(roomId).content.raw.state;
  }

  /** Nothing to stop: the DevBackend never talks to a homeserver. */
  async suspend(): Promise<void> {}
  async resume(): Promise<void> {}

  async needsVerification(): Promise<boolean> {
    return false;
  }

  /** Its device is always verified: nothing to listen to. */
  onVerificationChanged(): () => void {
    return () => {};
  }

  async verifyWithRecoveryKey(): Promise<void> {}

  async startEmojiVerification(): Promise<never> {
    throw new Error("The DevBackend has no devices to verify.");
  }

  /** Leaving for good: every room, the media and the to-device log are dropped. */
  async logout(): Promise<void> {
    this.reset();
    this.refresh();
  }

  // -------------------------------------------------------------------------------------------
  // Observation

  /** Call `listener` whenever `snapshot()` returns something new. For `useSyncExternalStore`. */
  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /**
   * The content of the DevBackend, with the `scheduled` events of `selectedRoomId` (its state and
   * timeline are `roomState()` and `timeline()`, as of any session). The same object is returned
   * until `refresh()` finds a change; its parts (`rooms`, `media`, `toDevice`, `scheduled`) keep
   * their identity as long as they did not change themselves.
   */
  readonly snapshot = (selectedRoomId?: string): MockedRoomData => {
    const key = selectedRoomId ?? "";
    let snapshot = this.snapshots.get(key);
    if (!snapshot) {
      const content = this.mocked.get(key)?.content;
      snapshot = {
        rooms: this.roomsData,
        userId: this.user,
        scheduled: content?.scheduled ?? NO_SCHEDULED,
        ...(content ? { pagination: content.pagination } : {}),
        toDevice: this.toDeviceData,
        failSends: this.sendsFail,
        media: this.mediaData,
      };
      this.snapshots.set(key, snapshot);
    }
    return snapshot;
  };

  /**
   * Re-read the backends and tell the listeners if something changed. Returns whether it did.
   * The editing methods below call it themselves; whoever runs widgets calls it after every
   * widget message, naming the widget (`causedBy`) so that what it uploaded is attributed to it.
   *
   * TODO-FINDING devbackend-no-change-notification - `InMemoryBackend` cannot tell its host that a
   * widget wrote something, so the host has to guess when to look (after every widget message)
   * and then read everything: `timeline()`, `state()`, `delayedEvents()`, `toDeviceSent()` and
   * `media()` (which copies every file's bytes out of the wasm memory) of every room. A change
   * callback, or at least a version counter per section, in the Rust type would remove both.
   */
  refresh(causedBy?: string): boolean {
    const now = Date.now();
    let changed = this.dirty;
    this.dirty = false;

    let toDeviceChanged = this.toDeviceData.length !== this.toDeviceLog.length;
    const widgetsChanged: string[] = [];
    const timelinesChanged: string[] = [];
    const inStore = new Map<Room, Set<string>>();

    for (const room of this.mocked.values()) {
      const timeline = room.store.timeline();
      const delayed = room.store.delayedEvents();
      // Every write to the state also appends to the timeline, so the timeline stands for both. A
      // resolved pagination adds older events (the length), a widget's request changes the status.
      const pending = room.store.pendingPagination();
      const pagination = `${room.store.paginationStatus()} ${pending ? (pending.limit ?? "any") : "-"}`;
      const stamp = `${timeline.length} ${timeline.at(-1)?.eventId ?? ""} ${delayed.map((d) => `${d.delayId}:${d.restarts}`).join(",")} ${pagination}`;
      if (stamp !== room.stamp) {
        room.stamp = stamp;
        room.content = this.read(room, timeline, delayed, now);
        timelinesChanged.push(room.id);
        changed = true;
      }

      const summaryJson = JSON.stringify([room.content.name, room.content.avatarUrl, room.content.members.filter((m) => m.joined).length, room.copiedFrom]);
      const widgetsJson = JSON.stringify(room.content.widgetEvents);
      if (widgetsJson !== room.widgetsJson) widgetsChanged.push(room.id);
      if (summaryJson !== room.summaryJson || widgetsJson !== room.widgetsJson) changed = true;
      room.summaryJson = summaryJson;
      room.widgetsJson = widgetsJson;

      // TODO-FINDING devbackend-shared-account-store - to-device messages and media belong to the
      // account, but `InMemoryBackend` keeps them per room (and one `InMemoryBackend` is one
      // room). So this class keeps the account's view and copies between the rooms' backends:
      // media a widget uploaded in one room is added to all others here, host uploads and
      // injected to-device messages go to every backend, and the sent list is the union. Known
      // holes: every file exists once per room plus once here; a file is only shared once
      // `refresh()` ran; and two rooms can hand out the same `mxc://…/media-<n>` URI for
      // different files (the counter is per backend), in which case the first one seen is the
      // account's file and the other room keeps its own. The clean fix is an account-level store
      // in the Rust crate that several `InMemoryBackend` rooms share.
      const sent = room.store.toDeviceSent();
      if (sent.length < room.toDeviceSeen) room.toDeviceSeen = 0; // the backend was cleared
      for (const message of sent.slice(room.toDeviceSeen)) {
        this.toDeviceLog.push({
          direction: "fromWidget",
          timestamp: now,
          type: message.eventType,
          userId: message.userId,
          deviceId: message.deviceId,
          encrypted: message.encrypted,
          content: asObject(message.content),
        });
        toDeviceChanged = true;
      }
      room.toDeviceSeen = sent.length;

      const uris = new Set<string>();
      for (const { contentUri, file } of room.store.media()) {
        uris.add(contentUri);
        if (this.files.has(contentUri)) continue;
        this.keep({ mxcUri: contentUri, data: file.data, mimetype: file.mimetype, uploadedBy: causedBy });
      }
      inStore.set(room, uris);
    }
    for (const [room, uris] of inStore) {
      for (const file of this.files.values()) {
        if (!uris.has(file.mxcUri)) room.store.addMedia(file.mxcUri, { data: file.data, mimetype: file.mimetype });
      }
    }

    const mediaChanged = this.mediaDirty;
    this.mediaDirty = false;
    if (toDeviceChanged) this.toDeviceData = [...this.toDeviceLog].reverse();
    if (mediaChanged) {
      this.mediaData = [...this.files.values()].map(({ mxcUri, data, mimetype, name, uploadedBy, url }) => ({
        mxcUri,
        bytes: data.byteLength,
        ...(mimetype === undefined ? {} : { mimetype }),
        ...(name === undefined ? {} : { name }),
        ...(uploadedBy === undefined ? {} : { uploadedBy }),
        ...(url === undefined ? {} : { url }),
      }));
    }
    const roomsData = [...this.mocked.values()].map(({ id, content, copiedFrom }) => ({
      id,
      name: content.name,
      ...(content.avatarUrl ? { avatarUrl: content.avatarUrl } : {}),
      ...(copiedFrom ? { copiedFrom } : {}),
    }));
    const roomsJson = JSON.stringify(roomsData);
    if (roomsJson !== this.roomsJson) {
      this.roomsJson = roomsJson;
      this.roomsData = roomsData;
      changed = true;
    }

    if (!changed && !toDeviceChanged && !mediaChanged) return false;
    this.snapshots.clear();
    for (const roomId of widgetsChanged) this.widgetListeners.get(roomId)?.forEach((listener) => listener());
    for (const roomId of timelinesChanged) this.timelineListeners.get(roomId)?.forEach((listener) => listener());
    if (changed) this.roomListeners.forEach((listener) => listener());
    this.listeners.forEach((listener) => listener());
    return true;
  }

  // -------------------------------------------------------------------------------------------
  // Editing: rooms

  /** The ids of the mocked rooms, in the order they were added. */
  roomIds(): string[] {
    return [...this.mocked.keys()];
  }

  /** Add a room with its `m.room.create` event, a name and the user as joined member. Returns its id. */
  addRoom(init: { id?: string; name?: string } = {}): string {
    const room = this.createRoom(init.id, init.name);
    this.refresh();
    return room.id;
  }

  /** Remove a room. Widgets still running on its backend see an empty room. */
  removeRoom(roomId: string): void {
    this.room(roomId).store.clear();
    this.mocked.delete(roomId);
    this.dirty = true;
    this.refresh();
  }

  /**
   * Drop every event, scheduled event and the room account data of a room. Media and the
   * to-device log are the account's and stay.
   *
   * TODO-FINDING devbackend-clear-room-keeps-skeleton - "drops all events" taken literally leaves
   * a room without a name and without the user as member (so the dropdown shows the room id and
   * widgets find themselves outside the room). Options: really empty; or keep the skeleton
   * `addRoom` creates. For now the create event, the name and the user's membership are sent
   * again; the widgets are gone, as they are state.
   */
  clearRoom(roomId: string): void {
    const room = this.room(roomId);
    const { name } = room.content;
    room.store.clear();
    room.scheduledAt.clear();
    room.firstSeen.clear();
    this.skeleton(room, name);
    this.refresh();
  }

  /**
   * "Resolve" (the pagination request of the room dev tools): end the back-pagination a widget asked for (`paginate_timeline`) with
   * `count` random messages (`m.room.message` / `m.text`, random senders and bodies) older than the
   * oldest event of the room, and with "start reached" if `startReached`. The backend tells the
   * widgets (`notify_timeline_update`). Works without a request too: it adds older history.
   */
  resolvePagination(roomId: string, count: number, startReached: boolean): void {
    if (!Number.isInteger(count) || count < 0 || count > MAX_GENERATED_EVENTS) throw new Error(`the number of messages has to be a whole number from 0 to ${MAX_GENERATED_EVENTS}`);
    const room = this.room(roomId);
    const oldest = room.content.raw.timeline[0]?.origin_server_ts;
    const before = typeof oldest === "number" && oldest > 0 ? oldest : Date.now();
    const server = serverOf(this.user);
    const senders = [this.user, ...["bob", "carol", "dave"].map((name) => `@${name}:${server}`)];
    const pick = <T>(list: readonly T[]): T => list[Math.floor(Math.random() * list.length)];
    const events: MatrixEvent[] = Array.from({ length: count }, (_, i) => ({
      eventType: "m.room.message",
      sender: pick(senders),
      eventId: `$dev${++this.counter}`,
      roomId: room.id,
      // Oldest first, a minute apart, ending a minute before the oldest event.
      originServerTs: BigInt(Math.max(0, before - (count - i) * 60_000)),
      stateKey: undefined,
      content: { msgtype: "m.text", body: `${pick(GREETINGS)} ${pick(TOPICS)}` },
      unsigned: undefined,
    }));
    room.store.resolvePagination(events, startReached);
    this.refresh();
  }

  /** Fail the back-pagination a widget asked for: the widgets get `message` as the error. */
  failPagination(roomId: string, message: string): void {
    this.room(roomId).store.failPagination(message);
    this.refresh();
  }

  /** Tell the room's widgets that the timeline cache is no longer continuous (`notify_timeline_update` with `reset`). */
  resetTimeline(roomId: string): void {
    this.room(roomId).store.resetTimeline();
  }

  /**
   * "Copy to DevBackend": a new mocked room with the state and the timeline of a real one.
   * Returns the new (local) room id; `copiedFrom` is kept and shown in `snapshot().rooms`.
   */
  importRoom(exported: RoomExport, copiedFrom?: { accountId: string; roomId: string }): string {
    const id = this.freeId((n) => `!copy${n}:${serverOf(this.user)}`);
    const room = this.createRoom(id, undefined, false);
    room.copiedFrom = copiedFrom;
    const key = (event: RawEvent) => `${event.type}\n${String(event.state_key)}`;
    const current = new Map(exported.state.map((event) => [key(event), event.event_id]));
    // The state first, like an initial sync does. A state event of the timeline is then either the
    // current one (stored already) or a superseded one, which would overwrite the current state
    // (the backend has no "old" events): both are left out of the copied timeline.
    for (const event of exported.state) this.injectRaw(room, event);
    for (const event of exported.timeline) {
      if (typeof event.state_key === "string" && current.has(key(event))) continue;
      this.injectRaw(room, event);
    }
    const state = new Map(room.store.state().map((event) => [`${event.eventType}\n${event.stateKey}`, event]));
    // A room without a name event has a computed name (a DM); as a mocked room it gets that name.
    if (!asString(asObject(state.get("m.room.name\n")?.content).name) && exported.name) {
      this.inject(room, { type: "m.room.name", stateKey: "", content: { name: exported.name } });
    }
    // TODO-FINDING devbackend-copied-room-user - the DevBackend's user is not the account the room
    // was copied from, so in the copy the user would not be a member (widgets that look at their
    // own membership, like a call, break). Options: join the DevBackend's user (done here; the
    // room has one member more than the original), act as the original user in a copied room, or
    // rewrite the original user's events to the DevBackend's user.
    if (asObject(state.get(`m.room.member\n${this.user}`)?.content).membership !== "join") {
      this.inject(room, { type: "m.room.member", stateKey: this.user, content: { membership: "join" } });
    }
    this.refresh();
    return id;
  }

  // -------------------------------------------------------------------------------------------
  // Editing: events

  /**
   * Set a state event, as if it had arrived from sync: widgets following the type are told.
   * A widget event with a `url` adds a widget to the room, one without removes it.
   * With `delayMs` the event is scheduled instead (see `sendEvent`). Resolves to the event id,
   * or the delay id.
   */
  async sendState(roomId: string, event: MockedStateEvent, delayMs?: number): Promise<string> {
    checkEvent(event, true);
    return this.send(this.room(roomId), event, delayMs);
  }

  /**
   * Add a timeline event, as if it had arrived from sync, with a generated event id and the
   * current time. `sender` defaults to the DevBackend's user.
   *
   * With `delayMs` the event is scheduled in the room's backend, through the same
   * `sendDelayedEvent` a widget's request ends in. So host- and widget-scheduled events are one
   * list with one kind of id, and a widget can restart or cancel what the host scheduled. The
   * price: a scheduled event is always sent by the DevBackend's user (`sender` is refused).
   *
   * TODO-FINDING devbackend-delayed-events-do-not-fire - `InMemoryBackend` never fires a scheduled
   * event by itself: its delay is only a number. Options: keep it manual ("send now" in the
   * view, `updateScheduled(…, "send")`: deterministic, what the end-to-end tests want), or let
   * the DevBackend run a timer per scheduled event (realistic: a call widget's delayed leave
   * would really happen; but it needs `refresh()` to notice the event first, and tests would
   * need a switch to turn it off). For now it stays manual, and `scheduled[].scheduledAt` says
   * when the event was scheduled or last restarted, so the view can show when it would be due.
   */
  async sendEvent(roomId: string, event: Pick<MockedTimelineEvent, "type" | "content"> & { sender?: string }, delayMs?: number): Promise<string> {
    checkEvent(event, false);
    return this.send(this.room(roomId), event, delayMs);
  }

  /** Fire ("send"), restart or cancel a scheduled event, whoever scheduled it. */
  async updateScheduled(roomId: string, delayId: string, update: "send" | "restart" | "cancel"): Promise<void> {
    const room = this.room(roomId);
    try {
      if (update === "send") await this.unfailing(room, () => room.store.fireDelayedEvent(delayId));
      else if (update === "restart") await room.store.restartDelayedEvent(roomId, delayId);
      else await room.store.cancelDelayedEvent(roomId, delayId);
    } finally {
      this.refresh();
    }
  }

  /** Fire a scheduled event as if its delay had elapsed. */
  fireDelayedEvent(roomId: string, delayId: string): Promise<void> {
    return this.updateScheduled(roomId, delayId, "send");
  }

  /** Make every send of a widget in every room fail (also uploads and scheduling), or succeed again. Host edits are not affected. */
  setFailSends(on: boolean): void {
    this.sendsFail = on;
    for (const room of this.mocked.values()) room.store.failSends(on ? FAIL_MESSAGE : undefined);
    this.dirty = true;
    this.refresh();
  }

  failSends(): boolean {
    return this.sendsFail;
  }

  // -------------------------------------------------------------------------------------------
  // Editing: what belongs to the account

  /**
   * Deliver a to-device message to the widgets (of every room: a to-device message has no room)
   * that follow its type. `userId` / `deviceId` are the sender's.
   */
  sendToDevice(message: Omit<ToDeviceMessage, "direction">): void {
    if (typeof message?.type !== "string" || message.type === "") throw new Error("a to-device message needs a `type`");
    if (typeof message.userId !== "string" || message.userId === "") throw new Error("a to-device message needs the sender's `userId`");
    const content = asObject(message.content);
    const encrypted = message.encrypted === true;
    for (const { store } of this.mocked.values()) store.injectToDevice({ eventType: message.type, sender: message.userId, content, encrypted });
    this.toDeviceLog.push({
      direction: "toWidget",
      timestamp: message.timestamp ?? Date.now(),
      type: message.type,
      userId: message.userId,
      deviceId: message.deviceId ?? "",
      encrypted,
      content,
    });
    this.refresh();
  }

  /** Put files into the media repository, where every widget of every room can download them. Returns their `mxc://` URIs. */
  addMedia(files: MediaUpload[]): string[] {
    const uris = files.map((file) => this.putMedia(file));
    this.refresh();
    return uris;
  }

  /** Set the TURN credentials (MSC3846) and push them to every widget watching them. */
  setTurnServer(server: TurnServer): void {
    this.turnServer = server;
    for (const { store } of this.mocked.values()) store.setTurnServer(server);
  }

  /** What `get_rtc_transports` answers (MSC4515): a JSON array. */
  setRtcTransports(transports: unknown): void {
    this.rtcTransports = transports;
    for (const { store } of this.mocked.values()) store.setRtcTransports(transports);
  }

  setRoomAccountData(roomId: string, eventType: string, content: unknown): void {
    this.room(roomId).store.setRoomAccountData(eventType, content);
  }

  /**
   * The room's `InMemoryBackend`, for what has no method here (subscriptions, delegated delayed
   * leaves, a custom `failSends` message). Call `refresh()` after writing to it.
   */
  store(roomId: string): InMemoryBackendLike {
    return this.room(roomId).store;
  }

  // -------------------------------------------------------------------------------------------
  // Seeds

  /**
   * Reset this DevBackend to exactly the content of `seed`. The rooms get new backends: widgets
   * running on the old ones have to be restarted. Rejects (and changes nothing) if the seed is
   * invalid or a file cannot be loaded.
   */
  async populate(seed: DevBackendSeed): Promise<void> {
    const { userId, rooms = [], media = [], demoMedia, failSends } = validateSeed(seed);
    const files = [...(demoMedia ? await loadDemoMedia() : []), ...(await Promise.all(media.map(loadSeedMedia)))];

    this.reset();
    this.user = userId ?? DEFAULT_USER_ID;
    this.sendsFail = failSends === true;
    for (const file of files) this.putMedia(file);
    for (const seeded of rooms) {
      const room = this.createRoom(seeded.id, seeded.name);
      if (seeded.topic !== undefined) this.inject(room, { type: "m.room.topic", stateKey: "", content: { topic: seeded.topic } });
      for (const { userId: member, displayName } of seeded.members ?? []) {
        const content = { membership: "join", ...(displayName === undefined ? {} : { displayname: displayName }) };
        this.inject(room, { type: "m.room.member", stateKey: member, sender: member, content });
      }
      for (const widget of seeded.widgets ?? []) this.inject(room, { type: widget.type, stateKey: widget.state_key, content: widget.content });
      for (const event of seeded.state ?? []) this.inject(room, event);
      for (const event of seeded.timeline ?? []) this.inject(room, event);
    }
    this.refresh();
  }

  /**
   * The current content as a seed. `populate(toSeed())` gives the same rooms, state, messages and
   * media; not kept are event ids and timestamps, superseded state events, scheduled events, the
   * to-device log, `copiedFrom`, room account data, TURN credentials and RTC transports.
   */
  toSeed(): DevBackendSeed {
    const rooms = [...this.mocked.values()].map((room): SeedRoom => {
      const { content } = room;
      const members: SeedRoom["members"] = [];
      const widgets: StateEvent[] = [];
      const state: SeedRoom["state"] = [];
      for (const event of content.state) {
        const keys = Object.keys(event.content);
        if (event.type === "m.room.create" && event.stateKey === "") continue;
        if (event.type === "m.room.name" && event.stateKey === "" && keys.join() === "name" && event.content.name === content.name) continue;
        if (event.type === "m.room.topic" && event.stateKey === "" && keys.join() === "topic" && event.content.topic === content.topic) continue;
        if (event.type === "m.room.member" && event.content.membership === "join" && keys.every((k) => k === "membership" || k === "displayname")) {
          const displayName = asString(event.content.displayname);
          // The user is a member of every seeded room anyway.
          if (event.stateKey !== this.user || displayName !== undefined) members.push({ userId: event.stateKey, ...(displayName === undefined ? {} : { displayName }) });
          continue;
        }
        if (WIDGET_EVENT_TYPES.includes(event.type)) continue; // below, in the order they were added
        state.push(event);
      }
      for (const event of content.widgetEvents) {
        if (describesWidget(event)) widgets.push(event);
        else state.push({ type: event.type, stateKey: event.state_key, content: event.content });
      }
      const timeline = content.raw.timeline
        .filter((event) => event.state_key === undefined)
        .map((event) => ({ type: event.type, ...(event.sender === this.user ? {} : { sender: String(event.sender) }), content: event.content }));
      return {
        id: room.id,
        name: content.name,
        ...(content.topic === undefined ? {} : { topic: content.topic }),
        ...(members.length ? { members } : {}),
        ...(widgets.length ? { widgets } : {}),
        ...(state.length ? { state } : {}),
        ...(timeline.length ? { timeline } : {}),
      };
    });
    const media = [...this.files.values()].map(({ mxcUri, name, mimetype, data }): SeedMedia => {
      const text = mimetype?.startsWith("text/") ? decodeText(data) : undefined;
      return {
        mxcUri,
        ...(name === undefined ? {} : { name }),
        ...(mimetype === undefined ? {} : { mimetype }),
        ...(text === undefined ? { base64: bytesToBase64(data) } : { text }),
      };
    });
    return {
      ...(this.user === DEFAULT_USER_ID ? {} : { userId: this.user }),
      ...(rooms.length ? { rooms } : {}),
      ...(media.length ? { media } : {}),
      ...(this.sendsFail ? { failSends: true } : {}),
    };
  }

  // -------------------------------------------------------------------------------------------

  private room(roomId: string): Room {
    const room = this.mocked.get(roomId);
    if (!room) throw new Error(`unknown room ${roomId}`);
    return room;
  }

  /** The first id `make(n)` gives that no room has. */
  private freeId(make: (n: number) => string): string {
    for (let n = 1; ; n++) if (!this.mocked.has(make(n))) return make(n);
  }

  private createRoom(id = this.freeId((n) => `!room${n}:${serverOf(this.user)}`), name?: string, withSkeleton = true): Room {
    if (!id.startsWith("!")) throw new Error(`a room id starts with "!": ${id}`);
    if (this.mocked.has(id)) throw new Error(`room ${id} exists already`);
    const store = InMemoryBackend.withContext(id, this.user, DEVICE_ID, this.user, "", BASE_URL);
    const room: Room = {
      id,
      store,
      stamp: "",
      content: { ...EMPTY_CONTENT, name: id },
      scheduledAt: new Map(),
      firstSeen: new Map(),
      toDeviceSeen: 0,
      summaryJson: "",
      widgetsJson: "[]",
    };
    // What the account has: a room added later starts with it too.
    for (const file of this.files.values()) store.addMedia(file.mxcUri, { data: file.data, mimetype: file.mimetype });
    if (this.turnServer) store.setTurnServer(this.turnServer);
    if (this.rtcTransports !== undefined) store.setRtcTransports(this.rtcTransports);
    if (this.sendsFail) store.failSends(FAIL_MESSAGE);
    this.mocked.set(id, room);
    this.dirty = true;
    if (withSkeleton) this.skeleton(room, name ?? `Room ${this.mocked.size}`);
    return room;
  }

  private skeleton(room: Room, name: string): void {
    this.inject(room, { type: "m.room.create", stateKey: "", content: { creator: this.user, room_version: "11" } });
    this.inject(room, { type: "m.room.name", stateKey: "", content: { name } });
    this.inject(room, { type: "m.room.member", stateKey: this.user, content: { membership: "join" } });
  }

  /** Store an event as if it had arrived from sync. Returns its id. */
  private inject(room: Room, event: { type: string; stateKey?: string; sender?: string; content: Record<string, unknown> }): string {
    const eventId = `$dev${++this.counter}`;
    room.store.inject({
      eventType: event.type,
      sender: event.sender ?? this.user,
      eventId,
      roomId: room.id,
      originServerTs: BigInt(Date.now()),
      stateKey: event.stateKey,
      content: event.content,
      unsigned: undefined,
    });
    return eventId;
  }

  /** Store an event of another room in `room`, as it is but for the room id. */
  private injectRaw(room: Room, event: RawEvent): void {
    if (typeof event?.type !== "string") throw new Error("an event of the copied room has no `type`");
    const timestamp = Number(event.origin_server_ts);
    room.store.inject({
      eventType: event.type,
      sender: asString(event.sender) ?? this.user,
      eventId: asString(event.event_id) ?? `$dev${++this.counter}`,
      roomId: room.id,
      originServerTs: BigInt(Number.isFinite(timestamp) && timestamp >= 0 ? Math.trunc(timestamp) : Date.now()),
      stateKey: typeof event.state_key === "string" ? event.state_key : undefined,
      content: asObject(event.content),
      unsigned: event.unsigned === undefined || event.unsigned === null ? undefined : event.unsigned,
    });
  }

  private async send(room: Room, event: { type: string; stateKey?: string; sender?: string; content: Record<string, unknown> }, delayMs?: number): Promise<string> {
    if (delayMs === undefined) {
      const eventId = this.inject(room, event);
      this.refresh();
      return eventId;
    }
    if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("the delay has to be a number of milliseconds, 0 or more");
    if (event.sender !== undefined && event.sender !== this.user) {
      throw new Error(`a delayed event is always sent by ${this.user}: the backend schedules it like a widget's`);
    }
    try {
      return await this.unfailing(room, () => room.store.sendDelayedEvent(room.id, event.type, event.stateKey, event.content, BigInt(Math.trunc(delayMs))));
    } finally {
      this.refresh();
    }
  }

  /**
   * Run a host edit that goes through the backend's send path while "fail sends" is on: that
   * switch is for the widgets' sends. (A widget's send that lands in between succeeds too.)
   */
  private async unfailing<T>(room: Room, work: () => T | Promise<T>): Promise<T> {
    if (!this.sendsFail) return work();
    room.store.failSends(undefined);
    try {
      return await work();
    } finally {
      if (this.sendsFail) room.store.failSends(FAIL_MESSAGE);
    }
  }

  private putMedia(file: MediaUpload): string {
    if (!(file?.data instanceof ArrayBuffer)) throw new Error("a media file needs its bytes (`data`)");
    const mxcUri = file.mxcUri ?? `mxc://${serverOf(this.user)}/upload-${++this.counter}`;
    if (!/^mxc:\/\/[^/]+\/.+/.test(mxcUri)) throw new Error(`not an mxc:// URI: ${mxcUri}`);
    this.keep({ mxcUri, data: file.data, mimetype: file.mimetype, name: file.name });
    for (const { store } of this.mocked.values()) store.addMedia(mxcUri, { data: file.data, mimetype: file.mimetype });
    return mxcUri;
  }

  /** Take a file into the account's repository, with an object URL for previews. */
  private keep(file: StoredFile): void {
    this.release(this.files.get(file.mxcUri));
    // Not in every environment (tests in node have it, a worker may not).
    const url = typeof URL.createObjectURL === "function" ? URL.createObjectURL(new Blob([file.data], { type: file.mimetype ?? "" })) : undefined;
    this.files.set(file.mxcUri, { ...file, url });
    this.mediaDirty = true;
  }

  private release(file?: StoredFile): void {
    if (file?.url) URL.revokeObjectURL(file.url);
  }

  private reset(): void {
    for (const { store } of this.mocked.values()) store.clear();
    this.mocked.clear();
    for (const file of this.files.values()) this.release(file);
    this.files.clear();
    this.toDeviceLog = [];
    this.sendsFail = false;
    this.turnServer = undefined;
    this.rtcTransports = undefined;
    this.dirty = true;
    this.mediaDirty = true;
  }

  /** Derive everything the views show from a room's backend. */
  private read(room: Room, timeline: MatrixEvent[], delayed: ReturnType<InMemoryBackendLike["delayedEvents"]>, now: number): RoomContent {
    const stateEvents = room.store.state();
    const state = new Map(stateEvents.map((event) => [`${event.eventType}\n${event.stateKey}`, asObject(event.content)]));

    // TODO-FINDING devbackend-widget-event-timestamps - an event a widget sends gets the backend's
    // counter as `origin_server_ts` (1, 2, 3: January 1970), so the timeline cannot show when it
    // was sent. Until the Rust `InMemoryBackend` uses a clock, such a timestamp is replaced by
    // the time this class first saw the event.
    const timestamp = (event: MatrixEvent): number => {
      const ts = Number(event.originServerTs);
      if (ts >= 1e11) return ts;
      let seen = room.firstSeen.get(event.eventId);
      if (seen === undefined) room.firstSeen.set(event.eventId, (seen = now));
      return seen;
    };
    const raw = (event: MatrixEvent): RawEvent => ({
      type: event.eventType,
      ...(event.stateKey === undefined ? {} : { state_key: event.stateKey }),
      sender: event.sender,
      event_id: event.eventId,
      room_id: event.roomId,
      origin_server_ts: timestamp(event),
      content: asObject(event.content),
      ...(event.unsigned === undefined || event.unsigned === null ? {} : { unsigned: event.unsigned }),
    });

    // Widgets in the order they were first added, so editing one does not move its tab.
    const added = new Map<string, number>();
    timeline.forEach((event, i) => {
      if (event.stateKey === undefined || !WIDGET_EVENT_TYPES.includes(event.eventType)) return;
      const key = `${event.eventType}\n${event.stateKey}`;
      if (!added.has(key)) added.set(key, i);
    });
    const widgetEvents = stateEvents
      .filter((event) => WIDGET_EVENT_TYPES.includes(event.eventType))
      .map((event) => ({ at: added.get(`${event.eventType}\n${event.stateKey}`) ?? 0, event: { type: event.eventType, state_key: event.stateKey ?? "", content: asObject(event.content) } }))
      .sort((a, b) => a.at - b.at)
      .map(({ event }) => event);

    const powerLevels = asObject(state.get("m.room.power_levels\n")?.users);
    const members = stateEvents
      .filter((event) => event.eventType === "m.room.member" && event.stateKey !== undefined)
      .map((event): Member => {
        const content = asObject(event.content);
        const level = Number(powerLevels[event.stateKey!] ?? 0);
        const displayName = asString(content.displayname);
        const avatarUrl = asString(content.avatar_url);
        const role = level >= 100 ? "Admin" : level >= 50 ? "Moderator" : undefined;
        return {
          userId: event.stateKey!,
          joined: content.membership === "join",
          ...(displayName === undefined ? {} : { displayName }),
          ...(avatarUrl === undefined ? {} : { avatarUrl }),
          ...(role === undefined ? {} : { role }),
        };
      });

    for (const id of [...room.scheduledAt.keys()]) if (!delayed.some((d) => d.delayId === id)) room.scheduledAt.delete(id);
    const scheduled = delayed.map(({ delayId, delayMs, restarts, event }) => {
      let since = room.scheduledAt.get(delayId);
      if (!since || since.restarts !== restarts) room.scheduledAt.set(delayId, (since = { at: now, restarts }));
      return {
        delayId,
        type: event.eventType,
        ...(event.stateKey === undefined ? {} : { stateKey: event.stateKey }),
        delayMs: Number(delayMs),
        restarts,
        scheduledAt: since.at,
      };
    });

    const pending = room.store.pendingPagination();
    const pagination: MockedPagination = {
      status: PAGINATION_STATUS[room.store.paginationStatus()],
      ...(pending ? { requested: pending.limit === undefined ? {} : { limit: pending.limit } } : {}),
    };

    return {
      name: asString(state.get("m.room.name\n")?.name) ?? room.id,
      avatarUrl: asString(state.get("m.room.avatar\n")?.url),
      topic: asString(state.get("m.room.topic\n")?.topic),
      encrypted: state.has("m.room.encryption\n"),
      members,
      widgetEvents,
      state: stateEvents.map((event) => ({ type: event.eventType, stateKey: event.stateKey ?? "", content: asObject(event.content) })),
      scheduled,
      pagination,
      raw: { state: stateEvents.map(raw), timeline: timeline.map(raw) },
    };
  }
}

async function loadSeedMedia(file: SeedMedia): Promise<MediaUpload> {
  const { mxcUri, name, mimetype } = file;
  if (file.base64 !== undefined) return { mxcUri, name, mimetype, data: base64ToBytes(file.base64) };
  if (file.text !== undefined) return { mxcUri, name, mimetype: mimetype ?? "text/plain", data: new TextEncoder().encode(file.text).buffer as ArrayBuffer };
  const fetched = await fetchBytes(file.url!);
  return { mxcUri, name: name ?? file.url!.split(/[?#]/)[0].split("/").pop(), mimetype: mimetype ?? fetched.mimetype, data: fetched.data };
}

/** The bytes as text, if they are valid UTF-8. */
function decodeText(data: ArrayBuffer): string | undefined {
  try {
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(data);
  } catch {
    return undefined;
  }
}
