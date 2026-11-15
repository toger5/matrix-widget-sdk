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
import { decodeRecoveryKey, VerificationPhase, VerificationRequestEvent, VerifierEvent, type ShowSasCallbacks, type VerificationRequest } from "matrix-js-sdk/lib/crypto-api";

import { JsSdkBackend } from "./backend/jsSdkBackend";
import { AVATAR_SIZE, AvatarCache } from "../../lib/avatarCache";
import { describesWidget, WIDGET_EVENT_TYPES, type StateEvent } from "../../widgetStateEvent";
import { StoredLoginInvalidError, type EmojiVerification, type LiveSession, type LoginOptions, type PendingLogin, type RoomSummary, type SessionProvider } from "../../session";

/**
 * The matrix-js-sdk implementation of `../../session`. With `./backend` it is the only code that
 * knows which SDK the app runs on.
 *
 * Sync is classic `/sync` v2 with the SDK's in-memory store, so every start does an initial sync;
 * the crypto store is in IndexedDB and survives reloads.
 */

const STORAGE_KEY = "widget_host_session_v1";
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
}

function loadStored(): Stored | undefined {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return undefined;
  try {
    return JSON.parse(raw) as Stored;
  } catch {
    return undefined;
  }
}

const saveStored = (stored: Stored) => localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));

/**
 * Delete the SDK's stores. There is one crypto store per origin and it belongs to one device, so
 * it has to go before another device logs in: the SDK refuses to open the store of another device.
 */
const clearSdkStores = (baseUrl: string) =>
  createClient({ baseUrl })
    .clearStores()
    .catch((e: unknown) => console.warn("clearing the stores failed", e));

const redirectUri = () => `${location.origin}/oidc-callback.html`;

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
      client_uri: loopback ? "https://element.io" : location.origin,
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

  private async finish(stored: Stored): Promise<JsSdkSession> {
    // A login is always a new device; whatever an earlier one left behind cannot be used by it.
    await clearSdkStores(stored.homeserverUrl);
    saveStored(stored);
    return (await activate(JsSdkSession.start(stored)))!;
  }
}

/**
 * The one client of this page, or its start in progress. There must never be two: they would
 * share the crypto store, and each would upload its own one-time keys under the same ids (the
 * homeserver then answers "One time key … already exists" and encryption is broken for good).
 * `restore()` is called twice in a row by React's strict mode, for one.
 */
let active: Promise<JsSdkSession | undefined> | undefined;

/** Make `start` the page's client, unless it fails or finds no login. */
function activate(start: Promise<JsSdkSession | undefined>): Promise<JsSdkSession | undefined> {
  const tracked: Promise<JsSdkSession | undefined> = start.then(
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

/** How long the signature of the verifying device may take to arrive after an emoji verification. */
const VERIFIED_TIMEOUT_MS = 20_000;

/** Resolves once the other device has accepted `request` (or started verifying right away). */
function accepted(request: VerificationRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const phase = request.phase;
      if (phase !== VerificationPhase.Ready && phase !== VerificationPhase.Started && phase !== VerificationPhase.Cancelled && phase !== VerificationPhase.Done) return;
      request.off(VerificationRequestEvent.Change, check);
      if (phase === VerificationPhase.Cancelled) reject(new Error("The verification was cancelled or timed out."));
      else if (phase === VerificationPhase.Done) reject(new Error("The verification ended before the emoji were shown."));
      else resolve();
    };
    request.on(VerificationRequestEvent.Change, check);
    check();
  });
}

/** The state events of the widget event types in the SDK's local copy of the room state. */
function widgetStateEvents(room: Room): StateEvent[] {
  return WIDGET_EVENT_TYPES.flatMap((type) => room.currentState.getStateEvents(type))
    .filter((event) => event.getStateKey() !== undefined)
    .map((event) => ({ type: event.getType(), state_key: event.getStateKey()!, content: event.getContent() }));
}

/** A logged-in, syncing client. */
class JsSdkSession implements LiveSession {
  /** Set while verifying: the SDK asks for it through `getSecretStorageKey`. */
  private recoveryKey: Uint8Array<ArrayBuffer> | undefined;
  private readonly avatars = new AvatarCache(async (mxcUrl) => {
    const url = this.client.mxcUrlToHttp(mxcUrl, AVATAR_SIZE, AVATAR_SIZE, "crop", false, true, true);
    if (!url) throw new Error("not an mxc:// URI");
    // Authenticated media: the access token goes in a header, so an `<img src>` cannot load it.
    const response = await fetch(url, { headers: { Authorization: `Bearer ${this.client.getAccessToken() ?? ""}` } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.blob();
  });

  private constructor(private readonly client: MatrixClient) {}

  /** Restore the stored login, if there is one. */
  static async restore(): Promise<JsSdkSession | undefined> {
    const stored = loadStored();
    return stored ? JsSdkSession.start(stored) : undefined;
  }

  static async start(stored: Stored): Promise<JsSdkSession> {
    let session: JsSdkSession | undefined;
    const client = createClient({
      baseUrl: stored.homeserverUrl,
      userId: stored.userId,
      deviceId: stored.deviceId,
      accessToken: stored.accessToken,
      refreshToken: stored.refreshToken,
      oauthClientId: stored.oauthClientId,
      // Without this a reload would restore tokens the server has already replaced.
      onTokenRefresh: (tokens) => {
        const current = loadStored();
        if (current?.userId === stored.userId) saveStored({ ...current, accessToken: tokens.accessToken, refreshToken: tokens.refreshToken });
      },
      cryptoCallbacks: {
        getSecretStorageKey: async ({ keys }) => {
          const keyId = Object.keys(keys)[0];
          return session?.recoveryKey && keyId ? [keyId, session.recoveryKey] : null;
        },
      },
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
      await client.initRustCrypto();
      await client.startClient({ lazyLoadMembers: true });
    } catch (e) {
      // Nothing may keep running (or keep the crypto store open) when the start is tried again.
      client.stopClient();
      throw e;
    }
    session = new JsSdkSession(client);
    return session;
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

  /** True when the account has cross-signing but this device is not signed by it. */
  async needsVerification(): Promise<boolean> {
    const crypto = this.client.getCrypto();
    const deviceId = this.client.getDeviceId();
    if (!crypto || !deviceId) return false;
    if (!(await crypto.userHasCrossSigningKeys(this.userId, true))) return false;
    const status = await crypto.getDeviceVerificationStatus(this.userId, deviceId);
    return status?.crossSigningVerified !== true;
  }

  /**
   * The recovery key opens the account's secret storage: fetch the cross-signing keys from it
   * (which signs this device) and the key of the room key backup.
   */
  async verifyWithRecoveryKey(recoveryKey: string): Promise<void> {
    const crypto = this.client.getCrypto();
    if (!crypto) throw new Error("End-to-end encryption is not set up in this client.");
    try {
      this.recoveryKey = decodeRecoveryKey(recoveryKey.trim());
      await crypto.bootstrapCrossSigning({});
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch((e: unknown) => console.warn("no room key backup key in secret storage", e));
      await crypto.checkKeyBackupAndEnable();
    } finally {
      this.recoveryKey = undefined;
    }
    if (await this.needsVerification()) throw new Error("The recovery key was accepted, but this device is still not verified.");
  }

  /**
   * Emoji (SAS) verification, started from here: every other device of the account gets the
   * request, the one that accepts it compares emoji with this one and then signs this device.
   * The secrets (cross-signing keys, backup key) follow from that device on their own.
   */
  async startEmojiVerification(): Promise<EmojiVerification> {
    const crypto = this.client.getCrypto();
    if (!crypto) throw new Error("End-to-end encryption is not set up in this client.");
    const request = await crypto.requestOwnUserVerification();
    let sas: ShowSasCallbacks | undefined;
    let done: Promise<void> | undefined;

    const emoji = (async () => {
      await accepted(request);
      // `Started`: the other device chose emoji already and the verifier exists.
      const verifier = request.verifier ?? (await request.startVerification("m.sas.v1"));
      const shown = new Promise<ShowSasCallbacks>((resolve) => {
        const callbacks = verifier.getShowSasCallbacks();
        if (callbacks) resolve(callbacks);
        else verifier.once(VerifierEvent.ShowSas, resolve);
      });
      // Runs until both sides have confirmed; rejects when either side cancels.
      done = verifier.verify();
      done.catch(() => undefined);
      sas = await Promise.race([
        shown,
        done.then(() => {
          throw new Error("The verification ended before the emoji were shown.");
        }),
      ]);
      if (!sas.sas.emoji) throw new Error("The other device offers no emoji to compare.");
      return sas.sas.emoji.map(([symbol, name]) => ({ symbol, name }));
    })();
    emoji.catch(() => undefined);

    return {
      emoji,
      confirm: async () => {
        await emoji;
        await sas!.confirm();
        await done;
        // This device is verified once the other device's signature of it has come down the sync.
        const deadline = Date.now() + VERIFIED_TIMEOUT_MS;
        while (await this.needsVerification()) {
          if (Date.now() > deadline) throw new Error("The emoji were confirmed, but this device is still not verified.");
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        await crypto.checkKeyBackupAndEnable().catch((e: unknown) => console.warn("checking the key backup failed", e));
      },
      cancel: (mismatch) => {
        if (mismatch && sas) sas.mismatch();
        else if (request.phase !== VerificationPhase.Done && request.phase !== VerificationPhase.Cancelled) {
          request.cancel().catch((e: unknown) => console.warn("cancelling the verification failed", e));
        }
      },
    };
  }

  /** Log out (for an OAuth login this revokes the tokens) and delete the SDK's stores. */
  async logout(): Promise<void> {
    active = undefined;
    this.avatars.clear();
    await this.client.logout(true).catch((e: unknown) => console.warn("logout request failed", e));
    this.client.stopClient();
    localStorage.removeItem(STORAGE_KEY);
    await this.client.clearStores().catch((e: unknown) => console.warn("clearing the stores failed", e));
  }
}

export const jsSdkSessions: SessionProvider = {
  startLogin: (server) => JsSdkPendingLogin.start(server),
  restore: async () => active ?? activate(JsSdkSession.restore()),
  async clearStored() {
    const stored = loadStored();
    if (!stored) return;
    const { homeserverUrl: baseUrl, userId, deviceId, accessToken, refreshToken, oauthClientId } = stored;
    // Fails when the homeserver has already ended the login, which is as good.
    await createClient({ baseUrl, userId, deviceId, accessToken, refreshToken, oauthClientId })
      .logout(true)
      .catch((e: unknown) => console.warn("logout request failed", e));
    localStorage.removeItem(STORAGE_KEY);
    await clearSdkStores(baseUrl);
  },
};
