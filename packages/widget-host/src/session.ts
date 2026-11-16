/**
 * Everything the widget host needs from a Matrix client, as interfaces. The UI (`App`, `Login`,
 * `LoggedInView`, `RoomView`, `WidgetView`) only uses this module, so supporting another Matrix SDK
 * means writing another `SessionProvider` and adding it to the choice at the bottom. Nothing
 * here, and nothing in the UI, may import an SDK.
 *
 * The in-memory mode (`./matrix_session/memory/devBackend`) implements `LiveSession` too, which is why it gets the
 * same views as a logged-in client.
 */
import type { MatrixBackend } from "@matrix-widget-tools/widget-host-bindings";

import type { StateEvent } from "./widgetStateEvent";

export interface RoomSummary {
  id: string;
  name: string;
  /** The room's avatar, an `mxc://` URI. `LiveSession.avatar` turns it into a URL an `<img>` can show. */
  avatarUrl?: string;
  /**
   * The room's state events of the widget event types, as they are: what they mean (which of them
   * describe a widget) is up to the UI. `undefined` as long as the session does not know.
   */
  widgetEvents?: StateEvent[];
  /** Number of joined members, if the session knows it. */
  memberCount?: number;
}

/** What the AccountView shows about the logged-in user. Everything but the user id may be unknown. */
export interface AccountInfo {
  userId: string;
  displayName?: string;
  /** An `mxc://` URI. */
  avatarUrl?: string;
  /** The homeserver's base URL or server name. */
  homeserver?: string;
  deviceId?: string;
  /** The account page of the homeserver's auth service (MAS): "Manage account & devices". */
  manageUrl?: string;
}

export interface RoomMember {
  userId: string;
  displayName?: string;
  avatarUrl?: string;
  /** "Admin", "Moderator" or nothing, from the power level. */
  role?: string;
}

/** What the RoomOverviewTab shows beyond the `RoomSummary`. */
export interface RoomDetails {
  topic?: string;
  encrypted?: boolean;
  memberCount?: number;
  /** The first members (the session may cap the list). */
  members?: RoomMember[];
}

/** A Matrix event as plain JSON (`type`, `content`, `sender`, `event_id`, `origin_server_ts`, `state_key` for state). */
export type RawEvent = Record<string, unknown> & { type: string; content: Record<string, unknown> };

/** A room as "Copy to DevBackend" takes it over: the whole current state and the last timeline events (oldest first). */
export interface RoomExport {
  roomId: string;
  name: string;
  state: RawEvent[];
  timeline: RawEvent[];
}

/** Which ways of logging in the chosen homeserver offers. */
export interface LoginOptions {
  oauth: boolean;
  password: boolean;
}

/** A homeserver chosen on the login screen, before the user has authenticated. */
export interface PendingLogin {
  readonly options: LoginOptions;
  withPassword(username: string, password: string): Promise<LiveSession>;
  /** The URL to send the user to; `completeOAuth` takes the URL the server redirects back to (`/oidc-callback.html?...`). */
  oauthUrl(): Promise<string>;
  completeOAuth(callbackUrl: string): Promise<LiveSession>;
  abortOAuth(): Promise<void>;
  /** Drop whatever a login that was never completed has stored. */
  discard(): Promise<void>;
}

/** The driver's `MatrixBackend` for one room, plus cleanup when the room view closes. */
export interface RoomBackend extends MatrixBackend {
  dispose(): void;
}

/** One of the emoji both devices show during an emoji verification. */
export interface VerificationEmoji {
  symbol: string;
  name: string;
}

/** A running emoji (SAS) verification of this device by another device of the same account. */
export interface EmojiVerification {
  /** The emoji to compare, once the other device has accepted the request. Rejects when the verification ends before that. */
  readonly emoji: Promise<VerificationEmoji[]>;
  /** The user says the emoji match. Resolves when the other device has confirmed too and this device is verified. */
  confirm(): Promise<void>;
  /** End the verification: the emoji differ (`mismatch`), or the user gave up. */
  cancel(mismatch?: boolean): void;
}

/** A logged-in, syncing client (or the in-memory stand-in for one). */
export interface LiveSession {
  /** Identifies the stored login this session belongs to (`StoredLogin.accountId`). */
  readonly accountId: string;
  readonly userId: string;
  /** Display name, avatar, homeserver, device and the account page URL, as far as the session knows them. */
  account(): Promise<AccountInfo>;
  /** Topic, members and encryption state of a room. */
  roomDetails(roomId: string): Promise<RoomDetails>;
  /** The room's current state and its last `lastEvents` timeline events, for "Copy to DevBackend". */
  exportRoom(roomId: string, lastEvents: number): Promise<RoomExport>;
  /**
   * Stop talking to the homeserver (no sync, no requests) but stay logged in: the DevBackend is
   * active. `resume()` starts syncing again. Backends handed out before stay valid across both.
   */
  suspend(): Promise<void>;
  resume(): Promise<void>;
  /** Joined rooms, sorted by name. */
  rooms(): RoomSummary[];
  /** Call `listener` whenever `rooms()` may have changed. Returns the unsubscribe function. */
  onRoomsChanged(listener: () => void): () => void;
  /** The avatar at `mxcUrl` (`RoomSummary.avatarUrl`) as a URL for an `<img>`, or `undefined` if it cannot be loaded. */
  avatar(mxcUrl: string): Promise<string | undefined>;
  /** The widget state events of a room that currently describe a widget (removed ones have no `url`). */
  widgets(roomId: string): Promise<StateEvent[]>;
  /** Call `listener` whenever `widgets(roomId)` may have changed. Returns the unsubscribe function. */
  onWidgetsChanged(roomId: string, listener: () => void): () => void;
  /** A backend bound to `roomId`; `dispose()` it when the room view closes. */
  backendFor(roomId: string): Promise<RoomBackend>;
  /** Whether this device still has to be verified before other devices share encryption keys with it. */
  needsVerification(): Promise<boolean>;
  /** Verify this device with the account's recovery key. */
  verifyWithRecoveryKey(recoveryKey: string): Promise<void>;
  /** Ask the account's other devices to verify this one by comparing emoji. */
  startEmojiVerification(): Promise<EmojiVerification>;
  /** Log out and delete everything stored for this login. */
  logout(): Promise<void>;
}

/** `SessionProvider.restore()` rejects with this when the homeserver no longer knows the stored login. */
export class StoredLoginInvalidError extends Error {
  constructor() {
    super("The stored login is no longer valid.");
    this.name = "StoredLoginInvalidError";
  }
}

/** A login stored in this browser. Several can be stored at once (multi-account). */
export interface StoredLogin {
  /** Chosen by the provider; stable for the lifetime of the login. */
  accountId: string;
  userId: string;
  homeserver?: string;
}

export interface SessionProvider {
  /** Look the homeserver up and report how it lets users log in. A completed login is stored next to the existing ones. */
  startLogin(server: string): Promise<PendingLogin>;
  /** The logins stored in this browser, in the order they were made. */
  stored(): Promise<StoredLogin[]>;
  /**
   * Restore one stored login. Rejects with `StoredLoginInvalidError` when the homeserver has
   * ended that login; after any other rejection the login may still be alive and stays stored,
   * so `restore()` can be tried again.
   */
  restore(accountId: string): Promise<LiveSession>;
  /** End a stored login without restoring it: log out on the homeserver if it still answers, and delete everything stored for it. */
  clearStored(accountId: string): Promise<void>;
}

/** Load the SDK's module only when a login is started or restored, so the in-memory mode never does. */
function lazyProvider(load: () => Promise<SessionProvider>): SessionProvider {
  let provider: Promise<SessionProvider> | undefined;
  const get = () => (provider ??= load());
  return {
    startLogin: async (server) => (await get()).startLogin(server),
    stored: async () => (await get()).stored(),
    restore: async (accountId) => (await get()).restore(accountId),
    clearStored: async (accountId) => (await get()).clearStored(accountId),
  };
}

/**
 * The Matrix SDK this build of the widget host runs on: matrix-rust-sdk, or matrix-js-sdk when built
 * with `VITE_MATRIX_SDK=js` (`npm run dev:js`, `npm run build:js`). Vite replaces the variable
 * at build time, so the other SDK is not part of the build at all.
 */
export const sessions: SessionProvider = lazyProvider(
  import.meta.env.VITE_MATRIX_SDK === "js"
    ? () => import("./matrix_session/js/session").then((m) => m.jsSdkSessions)
    : () => import("./matrix_session/rust/session").then((m) => m.rustSdkSessions),
);
