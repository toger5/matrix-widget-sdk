import { uniffiInitAsync as initHostBindings } from "@matrix-widget-tools/widget-host-bindings";
import {
  ClientBuilder,
  ClientError,
  IndexedDbStoreBuilder,
  Membership,
  OAuthPrompt,
  RoomListEntriesDynamicFilterKind,
  Session as SdkSession,
  SessionVerificationData,
  SlidingSyncVersion,
  SlidingSyncVersionBuilder,
  VerificationState,
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
import { WIDGET_EVENT_TYPES, type StateEvent } from "../../widgetStateEvent";
import { StoredLoginInvalidError, type EmojiVerification, type LiveSession, type LoginOptions, type PendingLogin, type RoomSummary, type SessionProvider, type VerificationEmoji } from "../../session";

/**
 * The matrix-rust-sdk implementation of `../../session` (`matrix-sdk-uniffi-js`). With
 * `./backend` it is the only code that knows which SDK the app runs on.
 */

/** Not the key of the matrix-js-sdk implementation: the two store different things. */
const STORAGE_KEY = "widget_host_rust_session_v1";
const ROOM_LIST_PAGE_SIZE = 500;
/** How long the signature of the verifying device may take to arrive after an emoji verification. */
const VERIFIED_TIMEOUT_MS = 20_000;
/** How long to wait for the full state of a room that was just opened. */
const FULL_STATE_TIMEOUT_MS = 5000;

interface Stored {
  session: SdkSession;
  /** Encrypts the IndexedDB stores of this login. */
  passphrase: string;
  storeId: string;
}

const storeName = (storeId: string) => `widget-host-store-${storeId}`;

function loadStored(): Stored | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    const stored = JSON.parse(raw) as Stored;
    return { ...stored, session: SdkSession.create(stored.session) };
  } catch {
    return undefined;
  }
}

const saveStored = (stored: Stored) => localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

/** The SDK reports refreshed tokens through this; without it a reload would restore stale ones. */
const sessionDelegate: ClientSessionDelegate = {
  retrieveSessionFromKeychain(userId) {
    const stored = loadStored();
    if (!stored || stored.session.userId !== userId) throw new Error(`no stored session for ${userId}`);
    return stored.session;
  },
  saveSessionInKeychain(session) {
    const stored = loadStored();
    if (stored && stored.session.userId === session.userId) saveStored({ ...stored, session });
  },
};

function builder(storeId: string, passphrase: string) {
  return new ClientBuilder()
    .indexeddbStore(new IndexedDbStoreBuilder(storeName(storeId)).passphrase(passphrase))
    .autoEnableCrossSigning(true)
    .setSessionDelegate(sessionDelegate);
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
    this.authData = await this.client.urlForOauth(
      {
        clientName: "Widget host",
        redirectUri: `${origin}/oidc-callback.html`,
        // Authorization servers reject a localhost client URI.
        clientUri: origin.includes("localhost") ? "https://element.io" : origin,
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
    saveStored({ session: this.client.session(), passphrase: this.passphrase, storeId: this.storeId });
    return (await activate(RustSdkSession.start(this.client, this.storeId)))!;
  }
}

/**
 * The one client of this page, or its start in progress. There must never be two on the same
 * stores. `restore()` is called twice in a row by React's strict mode, for one.
 */
let active: Promise<RustSdkSession | undefined> | undefined;

/** Make `start` the page's client, unless it fails or finds no login. */
function activate(start: Promise<RustSdkSession | undefined>): Promise<RustSdkSession | undefined> {
  const tracked: Promise<RustSdkSession | undefined> = start.then(
    (session) => {
      if (!session && active === tracked) active = undefined;
      return session;
    },
    (e: unknown) => {
      if (active === tracked) active = undefined;
      throw e;
    },
  );
  active = tracked;
  return tracked;
}

/** A client with the stored login restored into it, not syncing yet. */
async function restoredClient(stored: Stored): Promise<ClientLike> {
  await init();
  const client = await builder(stored.storeId, stored.passphrase).homeserverUrl(stored.session.homeserverUrl).build();
  await client.restoreSession({ ...stored.session, slidingSyncVersion: SlidingSyncVersion.Native });
  return client;
}

/** A logged-in, syncing client. */
class RustSdkSession implements LiveSession {
  private readonly listeners = new Set<() => void>();
  /** Handles the SDK needs kept alive for the room list updates to keep coming. */
  private keepAlive: unknown[] = [];
  private readonly roomListService: RoomListServiceLike;
  /** The room the sliding sync currently delivers the full state of. */
  private opened: { roomId: string; ready: Promise<void> } | undefined;

  private constructor(
    private readonly client: ClientLike,
    private readonly sync: SyncServiceLike,
    private readonly storeId: string,
  ) {
    this.roomListService = sync.roomListService();
  }

  /** Restore the stored login, if there is one. */
  static async restore(): Promise<RustSdkSession | undefined> {
    const stored = loadStored();
    if (!stored) return undefined;
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
    const notify = () => session.listeners.forEach((listener) => listener());

    const roomList = await session.roomListService.allRooms();
    const entries = roomList.entriesWithDynamicAdapters(ROOM_LIST_PAGE_SIZE, { onUpdate: notify });
    const controller = entries.controller();
    controller.setFilter(new RoomListEntriesDynamicFilterKind.NonLeft());
    controller.addOnePage();
    session.keepAlive = [roomList, entries, controller, entries.entriesStream()];

    await sync.start();
    return session;
  }

  get userId(): string {
    return this.client.userId();
  }

  /** Joined rooms, by name. The room list stream only says "something changed"; this reads the result. */
  rooms(): RoomSummary[] {
    return this.client
      .rooms()
      .filter((room) => room.membership() === Membership.Joined)
      .map((room) => ({ id: room.id(), name: room.displayName() ?? room.id() }))
      .sort((a, b) => a.name.localeCompare(b.name));
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
    const room = await this.open(roomId);
    const perType = await Promise.all(
      WIDGET_EVENT_TYPES.map(async (type) =>
        (await room.stateEvents(stateEventTypeFromString(type))).map((ev) => ({ type, state_key: ev.stateKey, content: JSON.parse(ev.contentJson) as Record<string, unknown> })),
      ),
    );
    return perType.flat().filter((ev) => typeof ev.content.url === "string");
  }

  onWidgetsChanged(roomId: string, listener: () => void): () => void {
    const room = this.client.getRoom(roomId);
    if (!room) return () => {};
    const handles = WIDGET_EVENT_TYPES.map((type) => {
      // The SDK reports the current state right away; only what follows is a change.
      let initial = true;
      return room.subscribeToStateEvents(stateEventTypeFromString(type), { onUpdate: () => (initial ? (initial = false) : listener()) });
    });
    return () => handles.forEach((handle) => handle.cancel());
  }

  /** A `MatrixBackend` bound to `roomId`; `dispose()` it when the room view closes. */
  async backendFor(roomId: string): Promise<RustSdkBackend> {
    return RustSdkBackend.create(this.client, await this.open(roomId));
  }

  /** True when the account has cross-signing but this device is not signed by it. */
  async needsVerification(): Promise<boolean> {
    const encryption = this.client.encryption();
    // Until the SDK has looked at the account's cross-signing keys the state is unknown.
    await encryption.waitForE2eeInitializationTasks();
    return encryption.verificationState() === VerificationState.Unverified;
  }

  /**
   * The recovery key opens the account's secret storage: the SDK fetches the cross-signing keys
   * from it (which signs this device) and the key of the room key backup.
   */
  async verifyWithRecoveryKey(recoveryKey: string): Promise<void> {
    await this.client.encryption().recover(recoveryKey.trim());
    if (await this.needsVerification()) throw new Error("The recovery key was accepted, but this device is still not verified.");
  }

  /**
   * Emoji (SAS) verification, started from here: every other device of the account gets the
   * request, the one that accepts it compares emoji with this one and then signs this device.
   */
  async startEmojiVerification(): Promise<EmojiVerification> {
    const controller = await this.client.getSessionVerificationController();
    let showEmoji!: (emoji: VerificationEmoji[]) => void;
    let finish!: () => void;
    let end!: (reason: Error) => void;
    const emoji = new Promise<VerificationEmoji[]>((resolve) => (showEmoji = resolve));
    const finished = new Promise<void>((resolve) => (finish = resolve));
    // Rejects when the verification ends without success; both promises below race against it.
    const ended = new Promise<never>((_, reject) => (end = reject));
    ended.catch(() => undefined);
    const failed = (e: unknown) => end(e instanceof Error ? e : new Error(String(e)));

    controller.setDelegate({
      didReceiveVerificationRequest: () => {},
      didAcceptVerificationRequest: () => void controller.startSasVerification().catch(failed),
      didStartSasVerification: () => {},
      didReceiveVerificationData: (data) => {
        if (!SessionVerificationData.Emojis.instanceOf(data)) return end(new Error("The other device offers no emoji to compare."));
        showEmoji(data.inner.emojis.map((e) => ({ symbol: e.symbol(), name: e.description() })));
      },
      didFail: () => end(new Error("The verification failed.")),
      didCancel: () => end(new Error("The verification was cancelled or timed out.")),
      didFinish: finish,
    });
    await controller.requestDeviceVerification();

    const shown = Promise.race([emoji, ended]);
    shown.catch(() => undefined);
    let over = false;
    void Promise.race([finished, ended])
      .catch(() => undefined)
      .then(() => (over = true));

    return {
      emoji: shown,
      confirm: async () => {
        await shown;
        await controller.approveVerification();
        await Promise.race([finished, ended]);
        // This device is verified once the other device's signature of it has come down the sync.
        const deadline = Date.now() + VERIFIED_TIMEOUT_MS;
        while (await this.needsVerification()) {
          if (Date.now() > deadline) throw new Error("The emoji were confirmed, but this device is still not verified.");
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      },
      cancel: (mismatch) => {
        if (over) return;
        const stop = mismatch ? controller.declineVerification() : controller.cancelVerification();
        stop.catch((e: unknown) => console.warn("cancelling the verification failed", e));
      },
    };
  }

  async logout(): Promise<void> {
    active = undefined;
    await this.sync.stop().catch(() => undefined);
    await this.client.logout().catch((e: unknown) => console.warn("logout request failed", e));
    localStorage.removeItem(STORAGE_KEY);
    await deleteStore(this.storeId);
  }
}

export const rustSdkSessions: SessionProvider = {
  startLogin: (server) => RustSdkPendingLogin.start(server),
  restore: async () => active ?? activate(RustSdkSession.restore()),
  async clearStored() {
    const stored = loadStored();
    if (!stored) return;
    // Fails when the homeserver has already ended the login, which is as good.
    await restoredClient(stored)
      .then((client) => client.logout())
      .catch((e: unknown) => console.warn("logout request failed", e));
    localStorage.removeItem(STORAGE_KEY);
    await deleteStore(stored.storeId);
  },
};
