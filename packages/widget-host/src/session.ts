/**
 * Everything the widget host needs from a Matrix client, as interfaces. The app (`src/app`,
 * `src/views`) only uses this module, so supporting another Matrix SDK means writing another
 * `SessionProvider` and adding it to the choice at the bottom. Nothing here, and nothing in the
 * app, may import an SDK; only `src/matrix_session/*` does.
 *
 * The in-memory mode (`./matrix_session/memory/devBackend`) implements `LiveSession` too, which is why it gets the
 * same views as a logged-in client.
 */
import type { EventSendState, TimelineViewModel } from "@element-hq/web-shared-components";
import type { MatrixBackend } from "@matrix-widget-sdk/host";

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

/** What the RoomOverview shows beyond the `RoomSummary`. */
export interface RoomDetails {
  topic?: string;
  encrypted?: boolean;
  memberCount?: number;
  /** The first members (the session may cap the list). */
  members?: RoomMember[];
}

/** A Matrix event as plain JSON (`type`, `content`, `sender`, `event_id`, `origin_server_ts`, `state_key` for state). */
export type RawEvent = Record<string, unknown> & { type: string; content: Record<string, unknown> };

/** The events of a room as the RoomTimeline shows them. */
export interface RoomTimeline {
  /**
   * The events the session holds of the room, oldest first: every kind, state events included,
   * decrypted where it could (one it could not decrypt stays `m.room.encrypted`); no local echoes.
   */
  events: RawEvent[];
  /** The room's first event is among `events`: there is nothing older to load. */
  atStart: boolean;
  /** `loadOlderEvents` runs for this room. */
  loadingOlder: boolean;
}

/** What a tile of the Timeline tab shows as its body. */
export type TimelineBody =
  /** A message: its text (the rust timeline: the latest edit), and its HTML (`formatted_body`, not sanitised) if it has one. */
  | { kind: "text"; text: string; html?: string; edited?: boolean }
  /** An image (a sticker too). `load` resolves to a URL an `<img>` can show, or `undefined`. */
  | { kind: "image"; caption: string; width?: number; height?: number; load(): Promise<string | undefined> }
  /** It could not be decrypted; `reason` is a `DecryptionFailureReason` of the shared components. */
  | { kind: "utd"; reason?: string }
  /** It was deleted. */
  | { kind: "redacted"; reason?: string }
  /** Anything else: the view puts `json()` into words. */
  | { kind: "event" };

/** A reaction to an event, as the tile's reaction buttons show it. */
export interface TimelineReaction {
  key: string;
  /** The user IDs that reacted with it. */
  senders: string[];
  /** The account is one of `senders`. */
  mine: boolean;
}

/** One event of the Timeline tab: the `event` of an event item of its `TimelineView`. */
export interface TimelineRow {
  sender: string;
  /** The sender's display name and avatar (an `mxc://` URI, `LiveSession.avatar`), where the session knows them. */
  name?: string;
  avatar?: string;
  /** When it was sent (ms since the epoch). */
  ts: number;
  body: TimelineBody;
  reactions: TimelineReaction[];
  /** React with `key`, or take the account's reaction back; missing where the timeline cannot send. */
  toggleReaction?(key: string): void;
  /** The event as JSON; undefined for a local echo that has not been sent yet. */
  json(): RawEvent | undefined;
  /** A local echo (the rust timeline): its send state. */
  sendState?: EventSendState;
}

/**
 * The view model of the Timeline tab (Element Web's `TimelineView`). `dispose` stops it. `send`: a
 * text message (Markdown) through the timeline, shown at once as a local echo (the rust session);
 * without it the composer sends with `room/sendMessage`.
 */
export type RoomTimelineViewModel = TimelineViewModel & { dispose(): void; send?(body: string): void };

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
  /**
   * Rejects with the reason as soon as the verification ends without success, at any step: the
   * other device cancelled it, it timed out, it failed. Never resolves.
   */
  readonly ended: Promise<never>;
  /** The user says the emoji match. Resolves when the other device has confirmed too and this device is verified. */
  confirm(): Promise<void>;
  /** End the verification: the emoji differ (`mismatch`), or the user gave up. Once it has ended, it only stops a `confirm()` that still waits. */
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
  /** The room's current state and its last `lastEvents` timeline events, for "Copy to DevBackend". Its `state` is `roomState(roomId)`. */
  exportRoom(roomId: string, lastEvents: number): Promise<RoomExport>;
  /**
   * The room's whole current state (the Dev tools): from the homeserver where the session can ask
   * it, else what the session holds (which may lack members and state types it never saw). A
   * change usually arrives as a state event in `timeline(roomId)`, after which it is worth reading
   * again (not after a gap in the sync or a redaction: finding `room-tools-state-refresh`).
   */
  roomState(roomId: string): Promise<RawEvent[]>;
  /** The events of a room the session holds (the RoomTimeline). The rust session subscribes to the room for it, like `backendFor`. */
  timeline(roomId: string): Promise<RoomTimeline>;
  /**
   * Load up to `count` older events of a room, from the store or the homeserver (it may load a few
   * more). Resolves once they are in `timeline(roomId)`; a second call while one runs joins it.
   */
  loadOlderEvents(roomId: string, count: number): Promise<void>;
  /**
   * The Timeline tab of a room: the matrix-rust-sdk timeline (edits and reactions folded in, local
   * echoes) in the rust session, `timeline(roomId)` (one row per event) in the others. The caller disposes it.
   */
  timelineViewModel(roomId: string): RoomTimelineViewModel;
  /** Call `listener` whenever `timeline(roomId)` may have changed: new, older, deleted or decrypted events, `loadingOlder`. Returns the unsubscribe function. */
  onTimelineChanged(roomId: string, listener: () => void): () => void;
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
  /**
   * Call `listener` whenever `needsVerification()` may have changed: this device or the account's
   * cross-signing keys were verified, reset or arrived. Returns the unsubscribe function.
   */
  onVerificationChanged(listener: () => void): () => void;
  /** Verify this device with the account's recovery key. The key is a secret: it is not stored or logged. */
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
