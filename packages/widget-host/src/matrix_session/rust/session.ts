import { uniffiInitAsync as initHostBindings } from "@matrix-widget-tools/widget-host-bindings";
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
import { accountInfo, exportRoom, roomDetails } from "./roomData";
import { needsVerification, onVerificationChanged, startEmojiVerification, verifyWithRecoveryKey } from "./verification";
import { AccountStore } from "../js/accountStore";
import { AVATAR_SIZE, AvatarCache } from "../../lib/avatarCache";
import { describesWidget, WIDGET_EVENT_TYPES, type StateEvent } from "../../widgetStateEvent";
import {
  StoredLoginInvalidError,
  type AccountInfo,
  type EmojiVerification,
  type LiveSession,
  type LoginOptions,
  type PendingLogin,
  type RoomDetails,
  type RoomExport,
  type RoomSummary,
  type SessionProvider,
} from "../../session";

/**
 * The matrix-rust-sdk implementation of `../../session` (`matrix-sdk-uniffi-js`). With
 * `./backend` it is the only code that knows which SDK the app runs on.
 *
 * Several logins are stored side by side (`../js/accountStore`): each has its own `localStorage`
 * entry and its own IndexedDB stores, named after its store id, which is also its account id.
 */

/** One `localStorage` entry per login: this prefix followed by the account id. Not the prefix of the matrix-js-sdk implementation: the two store different things. */
export const STORAGE_PREFIX = "widget_host_rust_session_v2:";
/** Where the one login was stored before multi-account. */
export const LEGACY_STORAGE_KEY = "widget_host_rust_session_v1";
const ROOM_LIST_PAGE_SIZE = 500;
/** How long to wait for the full state of a room that was just opened. */
const FULL_STATE_TIMEOUT_MS = 5000;
/** The least time between two reads of the widget events of all rooms, each of which asks the store once per room and widget event type. */
const WIDGET_EVENTS_INTERVAL_MS = 1000;

interface Stored {
  session: SdkSession;
  /** Encrypts the IndexedDB stores of this login. */
  passphrase: string;
  /** Names the IndexedDB stores of this login. It is the account id as well. */
  storeId: string;
}

/** The login of the old single-key layout as an account of the new one: the record is unchanged, its store id becomes the account id. */
export function migrateLegacyLogin(legacy: unknown): { accountId: string; record: Stored } | undefined {
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

/** A homeserver chosen on the login screen, before the user has authenticated. */
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

  /** The URL to send the user to; `completeOAuth` takes the URL the server redirects back to. */
  async oauthUrl(): Promise<string> {
    const origin = location.origin;
    // This app's URL, also when it is served under a sub-path (Vite's `base`, e.g. the dev site's `/<repo>/host/`).
    const appUrl = new URL(import.meta.env.BASE_URL, origin).href;
    this.authData = await this.client.urlForOauth(
      {
        clientName: "Widget host",
        redirectUri: `${appUrl}oidc-callback.html`,
        // Authorization servers reject a localhost client URI.
        clientUri: origin.includes("localhost") ? "https://element.io" : appUrl,
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

  /** Drop the stores of a login that was never completed. */
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
    return activate(this.storeId, RustSdkSession.start(this.client, this.storeId));
  }
}

/**
 * The client of each account of this page, or its start in progress. There must never be two on
 * the same stores. `restore()` is called twice in a row by React's strict mode, for one.
 */
// TODO-FINDING concurrent-sessions - the provider lets clients of several accounts run at once (each has its own stores); whether the UI keeps the inactive accounts syncing or restores only the active one is the UI's choice. Not verified against a homeserver with two clients on one page.
const active = new Map<string, Promise<RustSdkSession>>();

/** Make `start` the account's client, unless it fails. */
function activate(accountId: string, start: Promise<RustSdkSession>): Promise<RustSdkSession> {
  const tracked: Promise<RustSdkSession> = start.catch((e: unknown) => {
    if (active.get(accountId) === tracked) active.delete(accountId);
    throw e;
  });
  active.set(accountId, tracked);
  return tracked;
}

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

/** A logged-in, syncing client. */
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

  private constructor(
    private readonly client: ClientLike,
    private readonly sync: SyncServiceLike,
    private readonly storeId: string,
  ) {
    this.roomListService = sync.roomListService();
  }

  /** Restore a stored login. */
  static async restore(accountId: string): Promise<RustSdkSession> {
    const stored = loadStored(accountId);
    if (!stored) throw new Error(`No login is stored for the account ${accountId}.`);
    const client = await restoredClient(stored);
    // A token the server no longer knows cannot be restored; anything else (being offline, say)
    // is left to the sync, which keeps retrying. The ffi has no `whoami`, so this asks for the
    // media configuration, the cheapest request that needs the token.
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

  /** The store id: chosen when the login was started, and what its IndexedDB stores are named after. */
  // TODO-FINDING account-id-choice - what identifies a stored login? Options: a random id per login (done: the store id, a UUID that existed before multi-account, so the migrated login needs no renaming), or `userId` + `deviceId` (readable, but not known before the login completes, when the stores are already created).
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
  // TODO-FINDING rust-suspend-explicit-requests - the bindings offer no way to refuse requests, so suspend() only stops what runs by itself (sync, send queues, this session's own requests). A request a room backend makes for a widget while suspended (a send, the TURN server poll of backend/turnServer.ts, media) still reaches the homeserver. Options: the UI disposes or detaches the backends of a suspended session, or RustSdkBackend gets a gate like the js provider's FetchGate. `Client::pause()` was not used: it also closes the stores, which the backends read from, and is untested on IndexedDB.
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
    // TODO-FINDING rust-resume-room-subscription - could not be verified without a homeserver: whether the full-state subscription of the open room survives SyncService stop/start. It is asked for again here, which is what switching rooms back and forth does too.
    const opened = this.opened;
    if (opened) {
      const ready = this.roomListService.subscribeToRoomWithFullState(opened.roomId, FULL_STATE_TIMEOUT_MS).catch((e: unknown) => console.warn("subscribing to the open room again failed", e));
      if (this.opened === opened) this.opened = { roomId: opened.roomId, ready };
    }
    this.readWidgetEvents();
  }

  /** Joined rooms, by name. The room list stream only says "something changed"; this reads the result. */
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

  /** Call `listener` whenever `rooms()` may have changed. Returns the unsubscribe function. */
  onRoomsChanged(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * The SDK only syncs the state types it needs itself. Widgets are state events too, and a widget
   * may read any state type, so the room in view is subscribed to with its full state. Resolves
   * when that state is in the SDK's store.
   */
  private async open(roomId: string): Promise<RoomLike> {
    const room = this.client.getRoom(roomId);
    if (!room) throw new Error(`unknown room ${roomId}`);
    if (this.opened?.roomId !== roomId) {
      this.opened = { roomId, ready: this.roomListService.subscribeToRoomWithFullState(roomId, FULL_STATE_TIMEOUT_MS) };
    }
    await this.opened.ready;
    return room;
  }

  /** The widget state events of a room that currently describe a widget (removed ones have no `url`). */
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

  /** A `MatrixBackend` bound to `roomId`; `dispose()` it when the room view closes. */
  async backendFor(roomId: string): Promise<RustSdkBackend> {
    return RustSdkBackend.create(this.client, await this.open(roomId));
  }

  /** Device verification: `./verification`. */
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

  /** Log out and delete this login's entry and its IndexedDB stores. */
  async logout(): Promise<void> {
    active.delete(this.accountId);
    this.stopped = true;
    this.avatars.clear();
    await this.sync.stop().catch(() => undefined);
    await this.client.logout().catch((e: unknown) => console.warn("logout request failed", e));
    store.remove(this.accountId);
    await deleteStore(this.storeId);
  }
}

export const rustSdkSessions: SessionProvider = {
  startLogin: (server) => RustSdkPendingLogin.start(server),
  stored: async () => store.list().map(({ accountId, record }) => ({ accountId, userId: record.session.userId, homeserver: record.session.homeserverUrl })),
  restore: async (accountId) => active.get(accountId) ?? activate(accountId, RustSdkSession.restore(accountId)),
  async clearStored(accountId) {
    // A running client of this login ends it itself: a second client must not open its stores.
    const running = await active.get(accountId)?.catch(() => undefined);
    if (running) return running.logout();
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
