import {
  AutoDiscovery,
  ClientEvent,
  KnownMembership,
  MatrixError,
  OAuth2,
  RoomEvent,
  RoomStateEvent,
  createClient,
  type MatrixClient,
  type MatrixEvent,
  type Room,
  type ValidatedAuthMetadata,
} from "matrix-js-sdk";

import { AccountStore } from "./accountStore";
import { JsSdkBackend } from "./backend/jsSdkBackend";
import { FetchGate } from "./fetchGate";
import { accountInfo, exportRoom, loadOlderEvents, onTimelineChanged, roomDetails, roomState, timelineEvents } from "./roomData";
import { needsVerification, onVerificationChanged, RecoveryKeySlot, startEmojiVerification, verifyWithRecoveryKey } from "./verification";
import { AVATAR_SIZE, AvatarCache } from "../../lib/avatarCache";
import { RoomTimelines } from "../roomTimelines";
import { describesWidget, WIDGET_EVENT_TYPES, type StateEvent } from "../../widgetStateEvent";
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
 * The matrix-js-sdk implementation of `../../session`. With `./backend` it is the only code that
 * knows which SDK the app runs on.
 *
 * Sync is classic `/sync` v2 with the SDK's in-memory store, so every start does an initial sync;
 * the crypto store is in IndexedDB and survives reloads.
 *
 * Several logins are stored side by side (`./accountStore`): each has its own `localStorage`
 * entry and its own crypto store (`cryptoDatabasePrefix`).
 */

/** One `localStorage` entry per login: this prefix followed by the account id. */
export const STORAGE_PREFIX = "widget_host_session_v2:";
/** Where the one login was stored before multi-account. */
export const LEGACY_STORAGE_KEY = "widget_host_session_v1";
/** The account id of the login taken over from the old layout: the one in the SDK's default crypto store. */
export const LEGACY_ACCOUNT_ID = "legacy";
const CLIENT_NAME = "Widget host";

/** What is needed to restore a login after a reload. */
interface Stored {
  homeserverUrl: string;
  userId: string;
  deviceId: string;
  accessToken: string;
  refreshToken?: string;
  /** Set for an OAuth login: the SDK needs it to refresh and revoke the tokens. */
  oauthClientId?: string;
  /**
   * The name of this login's crypto store in IndexedDB. Not set for the login taken over from
   * the old layout, which keeps using the SDK's default store (so it stays the same device).
   */
  cryptoDatabasePrefix?: string;
}

/** The login of the old single-key layout as an account of the new one, unchanged. */
export function migrateLegacyLogin(legacy: unknown): { accountId: string; record: Stored } | undefined {
  const stored = legacy as Partial<Stored> | null;
  if (!stored || typeof stored.homeserverUrl !== "string" || typeof stored.userId !== "string" || typeof stored.accessToken !== "string") return undefined;
  return { accountId: LEGACY_ACCOUNT_ID, record: stored as Stored };
}

const store = new AccountStore<Stored>({ prefix: STORAGE_PREFIX, legacyKey: LEGACY_STORAGE_KEY, migrate: migrateLegacyLogin });

// TODO-FINDING account-id-choice - what identifies a stored login? Options: a random id per login (done: a UUID, which also names the crypto store; "legacy" for the migrated login), or `userId` + `deviceId` (readable and stable, but not known before the login completes and it leaks into storage names). The rust provider uses its store id (a UUID too).
const newAccountId = () => crypto.randomUUID();
const cryptoPrefixFor = (accountId: string) => `widget-host-js-${accountId}`;

/** Delete the SDK's stores of one login: its crypto store (the default one when `cryptoDatabasePrefix` is not set). */
const clearSdkStores = (baseUrl: string, cryptoDatabasePrefix: string | undefined) =>
  createClient({ baseUrl })
    .clearStores({ cryptoDatabasePrefix })
    .catch((e: unknown) => console.warn("clearing the stores failed", e));

/** This app's URL, also when it is served under a sub-path (Vite's `base`, e.g. the dev site's `/<repo>/host/`). */
const appUrl = () => new URL(import.meta.env.BASE_URL, location.origin).href;
const redirectUri = () => `${appUrl()}oidc-callback.html`;

/** `matrix.org` → its homeserver URL from `.well-known`; a URL is used as it is. */
async function homeserverUrl(server: string): Promise<string> {
  if (/^https?:\/\//.test(server)) return server.replace(/\/+$/, "");
  const config = await AutoDiscovery.findClientConfig(server);
  const found = config["m.homeserver"];
  if (found?.state === AutoDiscovery.SUCCESS && found.base_url) return found.base_url.replace(/\/+$/, "");
  // No usable `.well-known`: the server name may be the homeserver itself.
  return `https://${server}`;
}

/** A homeserver chosen on the login screen, before the user has authenticated. */
class JsSdkPendingLogin implements PendingLogin {
  private oauth: { client: OAuth2; state: string } | undefined;

  private constructor(
    private readonly baseUrl: string,
    private readonly authMetadata: ValidatedAuthMetadata | undefined,
    readonly options: LoginOptions,
  ) {}

  static async start(server: string): Promise<JsSdkPendingLogin> {
    const baseUrl = await homeserverUrl(server);
    const client = createClient({ baseUrl });
    const [authMetadata, flows] = await Promise.all([
      // Rejects when the homeserver has no OAuth 2.0 authorization server.
      client.getAuthMetadata().catch(() => undefined),
      client.loginFlows().catch(() => undefined),
    ]);
    if (!authMetadata && !flows) throw new Error(`${baseUrl} does not answer like a Matrix homeserver.`);
    const password = flows?.flows.some((flow) => flow.type === "m.login.password") === true;
    return new JsSdkPendingLogin(baseUrl, authMetadata, { oauth: authMetadata !== undefined, password });
  }

  async withPassword(username: string, password: string): Promise<JsSdkSession> {
    const response = await createClient({ baseUrl: this.baseUrl }).loginRequest({
      type: "m.login.password",
      identifier: { type: "m.id.user", user: username },
      password,
      initial_device_display_name: CLIENT_NAME,
    });
    return this.finish({ homeserverUrl: this.baseUrl, userId: response.user_id, deviceId: response.device_id, accessToken: response.access_token });
  }

  /** Registers this app with the authorization server (dynamic client registration) and starts a PKCE code grant. */
  async oauthUrl(): Promise<string> {
    if (!this.authMetadata) throw new Error("This homeserver does not offer OAuth login.");
    // A page served from this machine (the dev server) cannot register as a web client:
    // authorization servers reject a localhost client URI, and for a web client also a redirect
    // URI that is not https on the client URI's host. A native client may redirect to loopback.
    const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
    const clientId = await OAuth2.registerClient(this.authMetadata, {
      client_name: CLIENT_NAME,
      client_uri: loopback ? "https://element.io" : appUrl(),
      application_type: loopback ? "native" : "web",
      redirect_uris: [redirectUri()],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    });
    const state = crypto.randomUUID();
    const client = new OAuth2(this.authMetadata, { clientId });
    this.oauth = { client, state };
    return client.generateAuthorizationCodeGrantUrl(state, redirectUri());
  }

  async completeOAuth(callbackUrl: string): Promise<JsSdkSession> {
    if (!this.oauth) throw new Error("No OAuth login is in progress.");
    const { client: oauth, state } = this.oauth;
    // The response arrives in the fragment or in the query, depending on the server's response mode.
    const url = new URL(callbackUrl);
    const answer = new URLSearchParams(url.hash.length > 1 ? url.hash.slice(1) : url.search);
    const error = answer.get("error");
    if (error) throw new Error(`The login was not completed: ${answer.get("error_description") ?? error}`);
    const code = answer.get("code");
    if (!code || answer.get("state") !== state) throw new Error("The login window returned an unexpected answer.");

    const tokens = await oauth.completeAuthorizationCodeGrant(code, redirectUri());
    const whoami = await createClient({ baseUrl: this.baseUrl, accessToken: tokens.access_token }).whoami();
    this.oauth = undefined;
    return this.finish({
      homeserverUrl: this.baseUrl,
      userId: whoami.user_id,
      deviceId: whoami.device_id ?? oauth.context.deviceId,
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      oauthClientId: oauth.context.clientId,
    });
  }

  async abortOAuth(): Promise<void> {
    this.oauth = undefined;
  }

  /** Nothing is stored before a login completes. */
  async discard(): Promise<void> {
    this.oauth = undefined;
  }

  private async finish(login: Omit<Stored, "cryptoDatabasePrefix">): Promise<JsSdkSession> {
    // A login is always a new device, and gets a crypto store of its own, next to the stored logins'.
    const accountId = newAccountId();
    const stored: Stored = { ...login, cryptoDatabasePrefix: cryptoPrefixFor(accountId) };
    store.save(accountId, stored);
    return activate(accountId, JsSdkSession.start(accountId, stored));
  }
}

/**
 * The client of each account of this page, or its start in progress. There must never be two for
 * one account: they would share the crypto store, and each would upload its own one-time keys
 * under the same ids (the homeserver then answers "One time key … already exists" and encryption
 * is broken for good). `restore()` is called twice in a row by React's strict mode, for one.
 */
// TODO-FINDING concurrent-sessions - the provider lets clients of several accounts run at once (each has its own stores); whether the UI keeps the inactive accounts syncing or restores only the active one is the UI's choice. Not verified against a homeserver with two clients on one page.
const active = new Map<string, Promise<JsSdkSession>>();

/** Make `start` the account's client, unless it fails. */
function activate(accountId: string, start: Promise<JsSdkSession>): Promise<JsSdkSession> {
  const tracked: Promise<JsSdkSession> = start.catch((e: unknown) => {
    if (active.get(accountId) === tracked) active.delete(accountId);
    throw e;
  });
  active.set(accountId, tracked);
  return tracked;
}

/** The state events of the widget event types in the SDK's local copy of the room state. */
function widgetStateEvents(room: Room): StateEvent[] {
  return WIDGET_EVENT_TYPES.flatMap((type) => room.currentState.getStateEvents(type))
    .filter((event) => event.getStateKey() !== undefined)
    .map((event) => ({ type: event.getType(), state_key: event.getStateKey()!, content: event.getContent() }));
}

/** A logged-in, syncing client. */
class JsSdkSession implements LiveSession {
  private readonly avatars = new AvatarCache(async (mxcUrl) => {
    const url = this.client.mxcUrlToHttp(mxcUrl, AVATAR_SIZE, AVATAR_SIZE, "crop", false, true, true);
    if (!url) throw new Error("not an mxc:// URI");
    // Authenticated media: the access token goes in a header, so an `<img src>` cannot load it.
    const response = await this.gate.fetch(url, { headers: { Authorization: `Bearer ${this.client.getAccessToken() ?? ""}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  });
  /** The RoomTimelines: the start of the room, a running pagination, the listeners (`./roomData`). */
  private readonly timelines = new RoomTimelines((roomId, changed) => onTimelineChanged(this.client, roomId, changed));

  private constructor(
    readonly accountId: string,
    private readonly client: MatrixClient,
    /** Every request of the client goes through it: closed while the session is suspended. */
    private readonly gate: FetchGate,
    private readonly cryptoDatabasePrefix: string | undefined,
    /** Holds the recovery key while `verifyWithRecoveryKey` runs; the client's crypto callback reads it. */
    private readonly recoveryKey: RecoveryKeySlot,
  ) {}

  /** Restore a stored login. */
  static async restore(accountId: string): Promise<JsSdkSession> {
    const stored = store.get(accountId);
    if (!stored) throw new Error(`No login is stored for the account ${accountId}.`);
    return JsSdkSession.start(accountId, stored);
  }

  static async start(accountId: string, stored: Stored): Promise<JsSdkSession> {
    const gate = new FetchGate();
    const recoveryKey = new RecoveryKeySlot();
    const client = createClient({
      fetchFn: gate.fetch,
      baseUrl: stored.homeserverUrl,
      userId: stored.userId,
      deviceId: stored.deviceId,
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      oauthClientId: stored.oauthClientId,
      // Without this a reload would restore tokens the server has already replaced.
      onTokenRefresh: (tokens) => store.update(accountId, (current) => ({ ...current, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken })),
      cryptoCallbacks: { getSecretStorageKey: recoveryKey.getSecretStorageKey },
      timelineSupport: true,
    });

    // A token the server no longer knows cannot be restored; anything else (being offline, say)
    // is left to the sync loop, which keeps retrying.
    try {
      await client.whoami();
    } catch (e) {
      if (e instanceof MatrixError && (e.errcode === "M_UNKNOWN_TOKEN" || e.httpStatus === 401)) throw new StoredLoginInvalidError();
      console.warn("the homeserver could not be reached, starting anyway", e);
    }

    try {
      await client.initRustCrypto({ cryptoDatabasePrefix: stored.cryptoDatabasePrefix });
      await client.startClient({ lazyLoadMembers: true });
    } catch (e) {
      // Nothing may keep running (or keep the crypto store open) when the start is tried again.
      client.stopClient();
      throw e;
    }
    return new JsSdkSession(accountId, client, gate, stored.cryptoDatabasePrefix, recoveryKey);
  }

  account(): Promise<AccountInfo> {
    return accountInfo(this.client);
  }

  roomDetails(roomId: string): Promise<RoomDetails> {
    return roomDetails(this.client, roomId);
  }

  exportRoom(roomId: string, lastEvents: number): Promise<RoomExport> {
    return exportRoom(this.client, roomId, lastEvents);
  }

  roomState(roomId: string): Promise<RawEvent[]> {
    return roomState(this.client, roomId);
  }

  async timeline(roomId: string): Promise<RoomTimeline> {
    return this.timelines.timeline(roomId, timelineEvents(this.client, roomId));
  }

  /** While suspended the request fails (`./fetchGate`). */
  loadOlderEvents(roomId: string, count: number): Promise<void> {
    return this.timelines.loadOlder(roomId, () => loadOlderEvents(this.client, roomId, count));
  }

  onTimelineChanged(roomId: string, listener: () => void): () => void {
    return this.timelines.listen(roomId, listener);
  }

  /**
   * No request reaches the homeserver until `resume()` (`./fetchGate`). The client, its crypto
   * module and the room backends on it stay as they are; what they try to send meanwhile fails.
   */
  async suspend(): Promise<void> {
    this.gate.suspend();
  }

  async resume(): Promise<void> {
    if (!this.gate.suspended) return;
    this.gate.resume();
    // The sync loop is waiting to probe the connection again: do it now.
    this.client.retryImmediately();
  }

  get userId(): string {
    return this.client.getSafeUserId();
  }

  /** Joined rooms, by name. */
  rooms(): RoomSummary[] {
    return this.client
      .getRooms()
      .filter((room) => room.getMyMembership() === KnownMembership.Join)
      .map((room) => ({
        id: room.roomId,
        name: room.name || room.roomId,
        avatarUrl: room.getMxcAvatarUrl() ?? undefined,
        memberCount: room.getJoinedMemberCount(),
        // With `/sync` v2 the state of every room is local.
        widgetEvents: widgetStateEvents(room),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  avatar(mxcUrl: string): Promise<string | undefined> {
    return this.avatars.get(mxcUrl);
  }

  /** Call `listener` whenever `rooms()` may have changed. Returns the unsubscribe function. */
  onRoomsChanged(listener: () => void): () => void {
    const events = [ClientEvent.Room, ClientEvent.DeleteRoom, RoomEvent.Name, RoomEvent.MyMembership] as const;
    for (const event of events) this.client.on(event, listener);
    // What a room of the list has besides its name: the avatar and the widget events.
    const onState = (event: MatrixEvent) => {
      if (event.getType() === "m.room.avatar" || WIDGET_EVENT_TYPES.includes(event.getType())) listener();
    };
    this.client.on(RoomStateEvent.Events, onState);
    return () => {
      for (const event of events) this.client.off(event, listener);
      this.client.off(RoomStateEvent.Events, onState);
    };
  }

  /** From the SDK's local copy of the room state: with `/sync` v2 the widget state of every room is there. */
  async widgets(roomId: string): Promise<StateEvent[]> {
    const room = this.client.getRoom(roomId);
    if (!room) throw new Error(`unknown room ${roomId}`);
    return widgetStateEvents(room).filter(describesWidget);
  }

  onWidgetsChanged(roomId: string, listener: () => void): () => void {
    const onState = (event: MatrixEvent) => {
      if (event.getRoomId() === roomId && WIDGET_EVENT_TYPES.includes(event.getType())) listener();
    };
    this.client.on(RoomStateEvent.Events, onState);
    return () => this.client.off(RoomStateEvent.Events, onState);
  }

  /** A `MatrixBackend` bound to `roomId`; `dispose()` it when the room view closes. */
  async backendFor(roomId: string): Promise<JsSdkBackend> {
    if (!this.client.getRoom(roomId)) throw new Error(`unknown room ${roomId}`);
    return JsSdkBackend.create(this.client, roomId);
  }

  /** Device verification: `./verification`. */
  needsVerification(): Promise<boolean> {
    return needsVerification(this.client);
  }

  onVerificationChanged(listener: () => void): () => void {
    return onVerificationChanged(this.client, listener);
  }

  verifyWithRecoveryKey(recoveryKey: string): Promise<void> {
    return verifyWithRecoveryKey(this.client, this.recoveryKey, recoveryKey);
  }

  startEmojiVerification(): Promise<EmojiVerification> {
    return startEmojiVerification(this.client);
  }

  /** Log out (for an OAuth login this revokes the tokens) and delete this login's entry and its SDK stores. */
  async logout(): Promise<void> {
    active.delete(this.accountId);
    this.avatars.clear();
    // The logout request has to get through, suspended or not.
    this.gate.resume();
    await this.client.logout(true).catch((e: unknown) => console.warn("logout request failed", e));
    this.client.stopClient();
    store.remove(this.accountId);
    await this.client.clearStores({ cryptoDatabasePrefix: this.cryptoDatabasePrefix }).catch((e: unknown) => console.warn("clearing the stores failed", e));
  }
}

export const jsSdkSessions: SessionProvider = {
  startLogin: (server) => JsSdkPendingLogin.start(server),
  stored: async () => store.list().map(({ accountId, record }) => ({ accountId, userId: record.userId, homeserver: record.homeserverUrl })),
  restore: async (accountId) => active.get(accountId) ?? activate(accountId, JsSdkSession.restore(accountId)),
  async clearStored(accountId) {
    // A running client of this login ends it itself: a second client must not open its crypto store.
    const running = await active.get(accountId)?.catch(() => undefined);
    if (running) return running.logout();
    const stored = store.get(accountId);
    if (!stored) return;
    const { homeserverUrl: baseUrl, userId, deviceId, accessToken, refreshToken, oauthClientId } = stored;
    // Fails when the homeserver has already ended the login, which is as good.
    await createClient({ baseUrl, userId, deviceId, accessToken, refreshToken, oauthClientId })
      .logout(true)
      .catch((e: unknown) => console.warn("logout request failed", e));
    store.remove(accountId);
    await clearSdkStores(baseUrl, stored.cryptoDatabasePrefix);
  },
};
