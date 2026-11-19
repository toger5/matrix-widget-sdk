import { uniffiInitAsync as initHostBindings } from "@matrix-widget-sdk/host";
import {
  ClientBuilder,
  ClientError,
  IndexedDbStoreBuilder,
  MediaSource,
  Membership,
  OAuthPrompt,
  RoomListEntriesDynamicFilterKind,
  Session as SdkSession,
  SlidingSyncVersion,
  SlidingSyncVersionBuilder,
  uniffiInitAsync as initSdk,
  type ClientLike,
  type ClientSessionDelegate,
  type OAuthAuthorizationDataLike,
  stateEventTypeFromString,
  type RoomLike,
  type RoomListServiceLike,
  type SyncServiceLike,
} from "matrix-sdk-uniffi-js";

import { RustSdkBackend } from "./backend/rustSdkBackend";
import { accountInfo, exportRoom, loadOlderEvents, onTimelineChanged, roomDetails, roomState, timelineEvents } from "./roomData";
import { needsVerification, onVerificationChanged, startEmojiVerification, verifyWithRecoveryKey } from "./verification";
import { AccountStore, RunningClients } from "../accountStore";
import { RoomTimelines } from "../roomTimelines";
import { appUrl } from "../shared";
import { rustTimelineViewModel, SharedTimelines, timelineConfiguration } from "./timelineViewModel";
import { AVATAR_SIZE, AvatarCache } from "../../lib/avatarCache";
import { describesWidget } from "../../lib/widgetEvents";
import { WIDGET_EVENT_TYPES, type StateEvent } from "../../widgetStateEvent";
import {
  StoredLoginInvalidError,
  type AccountInfo,
  type EmojiVerification,
  type LiveSession,
  type LoginOptions,
  type PendingLogin,
  type RawEvent,
  type RoomDetails,
  type RoomExport,
  type RoomSummary,
  type RoomTimeline,
  type SessionProvider,
} from "../../session";

/**
 * The matrix-rust-sdk `SessionProvider` (`matrix-sdk-uniffi-js`). Each login has its own IndexedDB
 * stores, named after its store id, which is also its account id.
 */

/** One `localStorage` entry per login: this prefix followed by the account id. */
export const STORAGE_PREFIX = "widget_host_rust_session_v2:";
/** Where the one login was stored before multi-account. */
export const LEGACY_STORAGE_KEY = "widget_host_rust_session_v1";
const ROOM_LIST_PAGE_SIZE = 500;
/** How long to wait for the full state of a room that was just opened. */
const FULL_STATE_TIMEOUT_MS = 5000;
/** The least time between two reads of the widget events of all rooms (a store read per room and type). */
const WIDGET_EVENTS_INTERVAL_MS = 1000;

interface Stored {
  session: SdkSession;
  /** Encrypts the IndexedDB stores of this login. */
  passphrase: string;
  /** Names the IndexedDB stores of this login. It is the account id as well. */
  storeId: string;
}

/** The login of the old single-key layout as an account of the new one: the record is unchanged, its store id becomes the account id. */
function migrateLegacyLogin(legacy: unknown): { accountId: string; record: Stored } | undefined {
  const stored = legacy as Partial<Stored> | null;
  if (!stored || typeof stored.storeId !== "string" || !stored.storeId || typeof stored.passphrase !== "string" || !stored.session) return undefined;
  return { accountId: stored.storeId, record: stored as Stored };
}

const store = new AccountStore<Stored>({ prefix: STORAGE_PREFIX, legacyKey: LEGACY_STORAGE_KEY, migrate: migrateLegacyLogin });

const storeName = (storeId: string) => `widget-host-store-${storeId}`;

function loadStored(accountId: string): Stored | undefined {
  const stored = store.get(accountId);
  if (!stored) return undefined;
  try {
    return { ...stored, session: SdkSession.create(stored.session) };
  } catch {
    return undefined;
  }
}

/**
 * The SDK reports refreshed tokens through this; without it a reload would restore stale ones.
 * One per client: the SDK only names the user, and two stored logins may be of the same user.
 */
const sessionDelegate = (accountId: string): ClientSessionDelegate => ({
  retrieveSessionFromKeychain(userId) {
    const stored = loadStored(accountId);
    if (!stored || stored.session.userId !== userId) throw new Error(`no stored session for ${userId}`);
    return stored.session;
  },
  saveSessionInKeychain(session) {
    // Nothing is stored yet while the login is still pending.
    store.update(accountId, (stored) => (stored.session.userId === session.userId ? { ...stored, session } : stored));
  },
});

function builder(storeId: string, passphrase: string) {
  return new ClientBuilder()
    .indexeddbStore(new IndexedDbStoreBuilder(storeName(storeId)).passphrase(passphrase))
    .autoEnableCrossSigning(true)
    .setSessionDelegate(sessionDelegate(storeId));
}

function randomPassphrase(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes));
}

/**
 * The SDK uses the store name as a prefix: the state store has that very name, the others
 * (crypto, event cache, media) and the stores' metadata are `<name>::<suffix>`.
 */
const STORE_SUFFIXES = ["", "::matrix-sdk-state", "::matrix-sdk-crypto", "::matrix-sdk-crypto-meta", "::event_cache", "::media"];

/** Delete every IndexedDB database of a login: the state, the crypto store with the device's keys, and the caches. */
async function deleteStore(storeId: string): Promise<void> {
  const prefix = storeName(storeId);
  const names = new Set(STORE_SUFFIXES.map((suffix) => prefix + suffix));
  // Whatever else the SDK has created under the prefix. Not every browser can list databases.
  const existing = await indexedDB.databases?.().catch(() => []);
  for (const { name } of existing ?? []) if (name?.startsWith(`${prefix}::`)) names.add(name);
  await Promise.all(
    Array.from(
      names,
      (name) =>
        new Promise<void>((resolve) => {
          // Failing to delete must not block logging out. A database the client still has open
          // is deleted once the client lets go of it, at the latest when the page is closed.
          const request = indexedDB.deleteDatabase(name);
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        }),
    ),
  );
}

let initialised: Promise<void> | undefined;
/** Load both wasm modules: the SDK and this repository's widget host. */
function init(): Promise<void> {
  return (initialised ??= Promise.all([initSdk(), initHostBindings()]).then(() => undefined));
}

class RustSdkPendingLogin implements PendingLogin {
  private authData: OAuthAuthorizationDataLike | undefined;

  private constructor(
    private readonly client: ClientLike,
    private readonly passphrase: string,
    private readonly storeId: string,
    readonly options: LoginOptions,
  ) {}

  static async start(server: string): Promise<RustSdkPendingLogin> {
    await init();
    const passphrase = randomPassphrase();
    const storeId = crypto.randomUUID();
    const client = await builder(storeId, passphrase)
      .slidingSyncVersionBuilder(SlidingSyncVersionBuilder.DiscoverNative)
      .serverNameOrHomeserverUrl(server)
      .build();
    const details = await client.homeserverLoginDetails();
    return new RustSdkPendingLogin(client, passphrase, storeId, { oauth: details.supportsOauthLogin(), password: details.supportsPasswordLogin() });
  }

  async withPassword(username: string, password: string): Promise<RustSdkSession> {
    await this.client.login(username, password, "Widget host", undefined);
    return this.finish();
  }

  async oauthUrl(): Promise<string> {
    this.authData = await this.client.urlForOauth(
      {
        clientName: "Widget host",
        redirectUri: `${appUrl()}oidc-callback.html`,
        // Authorization servers reject a localhost client URI.
        clientUri: location.origin.includes("localhost") ? "https://element.io" : appUrl(),
        logoUri: undefined,
        tosUri: undefined,
        policyUri: undefined,
        staticRegistrations: new Map(),
      },
      new OAuthPrompt.Consent(),
      undefined,
      undefined,
      undefined,
    );
    return this.authData.loginUrl();
  }

  async completeOAuth(callbackUrl: string): Promise<RustSdkSession> {
    await this.client.loginWithOauthCallback(callbackUrl);
    return this.finish();
  }

  async abortOAuth(): Promise<void> {
    if (this.authData) await this.client.abortOauthAuth(this.authData).catch(() => undefined);
    this.authData = undefined;
  }

  async discard(): Promise<void> {
    await this.abortOAuth();
    await deleteStore(this.storeId);
  }

  private async finish(): Promise<RustSdkSession> {
    if (this.client.slidingSyncVersion() !== SlidingSyncVersion.Native) {
      await deleteStore(this.storeId);
      throw new Error("This homeserver does not support native sliding sync, which the matrix-rust-sdk room list needs.");
    }
    // Only now is the login stored: one that is never completed does not show up in `stored()`.
    store.save(this.storeId, { session: this.client.session(), passphrase: this.passphrase, storeId: this.storeId });
    return running.set(this.storeId, RustSdkSession.start(this.client, this.storeId));
  }
}

const running = new RunningClients<RustSdkSession>();

/** A client with the stored login restored into it, not syncing yet. */
async function restoredClient(stored: Stored): Promise<ClientLike> {
  await init();
  const client = await builder(stored.storeId, stored.passphrase).homeserverUrl(stored.session.homeserverUrl).build();
  await client.restoreSession({ ...stored.session, slidingSyncVersion: SlidingSyncVersion.Native });
  return client;
}

/** The state events of the widget event types in the SDK's store for `room`. */
async function widgetStateEvents(room: RoomLike): Promise<StateEvent[]> {
  const perType = await Promise.all(
    WIDGET_EVENT_TYPES.map(async (type) =>
      (await room.stateEvents(stateEventTypeFromString(type))).map((ev) => ({ type, state_key: ev.stateKey, content: JSON.parse(ev.contentJson) as Record<string, unknown> })),
    ),
  );
  return perType.flat();
}

class RustSdkSession implements LiveSession {
  private readonly listeners = new Set<() => void>();
  /** Handles the SDK needs kept alive for the room list updates to keep coming. */
  private keepAlive: unknown[] = [];
  private readonly roomListService: RoomListServiceLike;
  /** The room the sliding sync currently delivers the full state of. */
  private opened: { roomId: string; ready: Promise<void> } | undefined;
  /** The widget events per room, as of the last read. `rooms()` cannot ask the store: it is synchronous. */
  private readonly widgetEvents = new Map<string, StateEvent[]>();
  private readingWidgets: "idle" | "running" | "again" = "idle";
  private stopped = false;
  /** Between `suspend()` and `resume()`: the sync is stopped and this session makes no requests. */
  private suspended = false;
  private readonly avatars = new AvatarCache(async (mxcUrl) => {
    if (this.suspended) throw new Error("the session is suspended");
    return this.client.getMediaThumbnail(MediaSource.fromUrl(mxcUrl), BigInt(AVATAR_SIZE), BigInt(AVATAR_SIZE));
  });
  /** One SDK timeline per room, shared by its Timeline tabs (opening one is not cheap). */
  private readonly sharedTimelines = new SharedTimelines((roomId) => Promise.resolve().then(() => this.knownRoom(roomId).timelineWithConfiguration(timelineConfiguration())));
  /** The images of the Timeline tab, whole, by `MediaSource.toJson()` (an encrypted image's source carries its key). */
  private readonly images = new AvatarCache(async (source) => {
    if (this.suspended) throw new Error("the session is suspended");
    return this.client.getMediaContent(MediaSource.fromJson(source));
  });
  private readonly timelines = new RoomTimelines((roomId, changed) => {
    const room = this.client.getRoom(roomId);
    const stop = room ? onTimelineChanged(room, changed) : () => {};
    return () => {
      stop();
      this.timelineOpened.delete(roomId);
    };
  });
  /** The rooms whose shown RoomTimeline has subscribed to its room (`open`) since it got its first listener. */
  private readonly timelineOpened = new Set<string>();

  private constructor(
    private readonly client: ClientLike,
    private readonly sync: SyncServiceLike,
    private readonly storeId: string,
  ) {
    this.roomListService = sync.roomListService();
  }

  static async restore(accountId: string): Promise<RustSdkSession> {
    const stored = loadStored(accountId);
    if (!stored) throw new Error(`No login is stored for the account ${accountId}.`);
    const client = await restoredClient(stored);
    // Only an unknown token fails the restore; being offline is left to the sync. The ffi has no
    // `whoami`: the media configuration is the cheapest request that needs the token.
    try {
      await client.getMaxMediaUploadSize();
    } catch (e) {
      if (ClientError.MatrixApi.instanceOf(e) && e.inner.code === "M_UNKNOWN_TOKEN") throw new StoredLoginInvalidError();
      console.warn("the homeserver could not be reached, starting anyway", e);
    }
    return RustSdkSession.start(client, stored.storeId);
  }

  static async start(client: ClientLike, storeId: string): Promise<RustSdkSession> {
    const sync = await client.syncService().withOfflineMode().finish();
    const session = new RustSdkSession(client, sync, storeId);
    const notify = () => {
      session.notify();
      session.readWidgetEvents();
    };

    // The room list only syncs the state the SDK needs itself; this adds the widgets of every room.
    await session.roomListService.syncExtraStateForAllRooms(WIDGET_EVENT_TYPES);
    const roomList = await session.roomListService.allRooms();
    const entries = roomList.entriesWithDynamicAdapters(ROOM_LIST_PAGE_SIZE, { onUpdate: notify });
    const controller = entries.controller();
    controller.setFilter(new RoomListEntriesDynamicFilterKind.NonLeft());
    controller.addOnePage();
    session.keepAlive = [roomList, entries, controller, entries.entriesStream()];

    await sync.start();
    return session;
  }

  get accountId(): string {
    return this.storeId;
  }

  get userId(): string {
    return this.client.userId();
  }

  account(): Promise<AccountInfo> {
    return accountInfo(this.client, !this.suspended);
  }

  /** From what the SDK has of the room; does not need (or change) the full-state subscription of `open`. */
  async roomDetails(roomId: string): Promise<RoomDetails> {
    return roomDetails(this.knownRoom(roomId), !this.suspended);
  }

  async exportRoom(roomId: string, lastEvents: number): Promise<RoomExport> {
    return exportRoom(this.client, this.knownRoom(roomId), lastEvents, !this.suspended);
  }

  /** From the homeserver (no request while suspended), else what the SDK has stored. Does not subscribe to the room. */
  async roomState(roomId: string): Promise<RawEvent[]> {
    return roomState(this.client, this.knownRoom(roomId), !this.suspended);
  }

  /**
   * The events of the event cache. The first read of a shown timeline subscribes to its room
   * (`open`), so that the sliding sync delivers the room's timeline; the reads after a change do
   * not, else every event would take the subscription back from another room's widgets.
   */
  async timeline(roomId: string): Promise<RoomTimeline> {
    let room: RoomLike;
    if (this.timelineOpened.has(roomId)) room = this.knownRoom(roomId);
    else {
      room = await this.open(roomId);
      if (this.timelines.followed(roomId)) this.timelineOpened.add(roomId);
    }
    return this.timelines.timeline(roomId, await timelineEvents(room));
  }

  loadOlderEvents(roomId: string, count: number): Promise<void> {
    return this.timelines.loadOlder(roomId, async () => {
      if (this.suspended) throw new Error("the session is suspended");
      return loadOlderEvents(this.knownRoom(roomId), count);
    });
  }

  onTimelineChanged(roomId: string, listener: () => void): () => void {
    return this.timelines.listen(roomId, listener);
  }

  /** On the room's shared SDK timeline, at once; the subscription to the room (`open`, like the first `timeline(roomId)`) runs alongside. */
  timelineViewModel(roomId: string) {
    this.open(roomId).catch((e: unknown) => console.warn(`subscribing to ${roomId} failed`, e));
    return rustTimelineViewModel(this.sharedTimelines.take(roomId), this.userId, (source) => this.images.get(source.toJson()));
  }

  private knownRoom(roomId: string): RoomLike {
    const room = this.client.getRoom(roomId);
    if (!room) throw new Error(`unknown room ${roomId}`);
    return room;
  }

  /**
   * Stop both sliding syncs and the send queues. The client, its stores and the room backends on
   * it stay as they are: reads from the store keep working, and the subscriptions of the backends
   * deliver again once `resume()` has restarted the sync.
   */
  // TODO-FINDING rust-suspend-explicit-requests - a request a backend makes for a widget (send, TURN poll, media) still goes out while suspended. `Client::pause()` would close the stores.
  async suspend(): Promise<void> {
    if (this.suspended) return;
    this.suspended = true;
    await this.sync.stop().catch((e: unknown) => console.warn("stopping the sync failed", e));
    await this.client.enableAllSendQueues(false).catch(() => undefined);
  }

  async resume(): Promise<void> {
    if (!this.suspended) return;
    this.suspended = false;
    await this.client.enableAllSendQueues(true).catch(() => undefined);
    await this.sync.start();
    // TODO-FINDING rust-resume-room-subscription - unverified whether the subscription survives stop/start; asked for again.
    const opened = this.opened;
    if (opened) {
      const ready = this.roomListService.subscribeToRoomWithFullState(opened.roomId, FULL_STATE_TIMEOUT_MS).catch((e: unknown) => console.warn("subscribing to the open room again failed", e));
      if (this.opened === opened) this.opened = { roomId: opened.roomId, ready };
    }
    this.readWidgetEvents();
  }

  /** The room list stream only says "something changed"; this reads the result. */
  rooms(): RoomSummary[] {
    return this.client
      .rooms()
      .filter((room) => room.membership() === Membership.Joined)
      .map((room) => ({
        id: room.id(),
        name: room.displayName() ?? room.id(),
        avatarUrl: room.avatarUrl(),
        widgetEvents: this.widgetEvents.get(room.id()),
        memberCount: Number(room.joinedMembersCount()),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  avatar(mxcUrl: string): Promise<string | undefined> {
    return this.avatars.get(mxcUrl);
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }

  /**
   * Bring `widgetEvents` up to date, in the background, and tell the room list's listeners if
   * the events of a room have changed. Called on every update of the room list; a call during a
   * read leads to one more read after it.
   */
  private readWidgetEvents(): void {
    if (this.readingWidgets !== "idle") {
      this.readingWidgets = "again";
      return;
    }
    this.readingWidgets = "running";
    void (async () => {
      let changed = false;
      for (const room of this.client.rooms()) {
        if (this.stopped) return;
        if (room.membership() !== Membership.Joined) continue;
        const events = await widgetStateEvents(room).catch(() => []);
        if (JSON.stringify(this.widgetEvents.get(room.id())) !== JSON.stringify(events)) changed = true;
        this.widgetEvents.set(room.id(), events);
      }
      if (changed) this.notify();
      await new Promise((resolve) => setTimeout(resolve, WIDGET_EVENTS_INTERVAL_MS));
      const again = this.readingWidgets === "again";
      this.readingWidgets = "idle";
      if (again) this.readWidgetEvents();
    })();
  }

  onRoomsChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The SDK only syncs the state types it needs itself. Widgets are state events too, and a widget
   * may read any state type, so the room in view is subscribed to with its full state. Resolves
   * when that state is in the SDK's store. The RoomTimeline opens its room too: the subscription
   * makes the sliding sync deliver the room's timeline.
   */
  // TODO-FINDING rust-one-room-subscription - one room at a time: opening room B takes the subscription away from room A's widgets and timeline.
  private async open(roomId: string): Promise<RoomLike> {
    const room = this.client.getRoom(roomId);
    if (!room) throw new Error(`unknown room ${roomId}`);
    if (this.opened?.roomId !== roomId) {
      const opened = { roomId, ready: this.roomListService.subscribeToRoomWithFullState(roomId, FULL_STATE_TIMEOUT_MS) };
      this.opened = opened;
      // A failed subscription is asked for again by the next `open` (the timeline's "Try again", a widget).
      opened.ready.catch(() => {
        if (this.opened === opened) this.opened = undefined;
      });
    }
    await this.opened.ready;
    return room;
  }

  async widgets(roomId: string): Promise<StateEvent[]> {
    return (await widgetStateEvents(await this.open(roomId))).filter(describesWidget);
  }

  onWidgetsChanged(roomId: string, listener: () => void): () => void {
    const room = this.client.getRoom(roomId);
    if (!room) return () => {};
    const handles = WIDGET_EVENT_TYPES.map((type) => {
      // The SDK reports the current state right away; only what follows is a change.
      let initial = true;
      return room.subscribeToStateEvents(stateEventTypeFromString(type), {
        onUpdate: () => {
          if (initial) return void (initial = false);
          listener();
          this.readWidgetEvents();
        },
      });
    });
    return () => handles.forEach((handle) => handle.cancel());
  }

  async backendFor(roomId: string): Promise<RustSdkBackend> {
    return RustSdkBackend.create(this.client, await this.open(roomId), this.timelines);
  }

  needsVerification(): Promise<boolean> {
    return needsVerification(this.client);
  }

  onVerificationChanged(listener: () => void): () => void {
    return onVerificationChanged(this.client, listener);
  }

  verifyWithRecoveryKey(recoveryKey: string): Promise<void> {
    return verifyWithRecoveryKey(this.client, recoveryKey);
  }

  startEmojiVerification(): Promise<EmojiVerification> {
    return startEmojiVerification(this.client);
  }

  async logout(): Promise<void> {
    running.delete(this.accountId);
    this.stopped = true;
    this.avatars.clear();
    this.images.clear();
    this.sharedTimelines.clear();
    await this.sync.stop().catch(() => undefined);
    await this.client.logout().catch((e: unknown) => console.warn("logout request failed", e));
    store.remove(this.accountId);
    await deleteStore(this.storeId);
  }
}

export const rustSdkSessions: SessionProvider = {
  startLogin: (server) => RustSdkPendingLogin.start(server),
  stored: async () => store.list().map(({ accountId, record }) => ({ accountId, userId: record.session.userId, homeserver: record.session.homeserverUrl })),
  restore: (accountId) => running.get(accountId, () => RustSdkSession.restore(accountId)),
  async clearStored(accountId) {
    if (await running.logout(accountId)) return;
    const raw = store.get(accountId);
    if (!raw) return;
    const stored = loadStored(accountId);
    // Fails when the homeserver has already ended the login, which is as good.
    if (stored) {
      await restoredClient(stored)
        .then((client) => client.logout())
        .catch((e: unknown) => console.warn("logout request failed", e));
    }
    store.remove(accountId);
    await deleteStore(raw.storeId);
  },
};
