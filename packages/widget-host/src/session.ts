/**
 * Everything the widget host needs from a Matrix client, as interfaces. The UI (`App`, `Login`,
 * `LoggedInView`, `RoomView`, `WidgetView`) only uses this module, so supporting another Matrix SDK
 * means writing another `SessionProvider` and adding it to the choice at the bottom. Nothing
 * here, and nothing in the UI, may import an SDK.
 *
 * The in-memory mode (`./memorySession`) implements `LiveSession` too, which is why it gets the
 * same views as a logged-in client.
 */
import type { MatrixBackend } from "@matrix-widget-tools/widget-host-bindings";

import type { StateEvent } from "./widgetStateEvent";

export interface RoomSummary {
  id: string;
  name: string;
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
  readonly userId: string;
  /** Joined rooms, sorted by name. */
  rooms(): RoomSummary[];
  /** Call `listener` whenever `rooms()` may have changed. Returns the unsubscribe function. */
  onRoomsChanged(listener: () => void): () => void;
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

export interface SessionProvider {
  /** Look the homeserver up and report how it lets users log in. */
  startLogin(server: string): Promise<PendingLogin>;
  /**
   * Restore the stored login, if there is one. Rejects with `StoredLoginInvalidError` when the
   * homeserver has ended that login; after any other rejection the login may still be alive and
   * stays stored, so `restore()` can be tried again.
   */
  restore(): Promise<LiveSession | undefined>;
  /** End the stored login without restoring it: log out on the homeserver if it still answers, and delete everything stored for it. */
  clearStored(): Promise<void>;
}

/** Load the SDK's module only when a login is started or restored, so the in-memory mode never does. */
function lazyProvider(load: () => Promise<SessionProvider>): SessionProvider {
  let provider: Promise<SessionProvider> | undefined;
  const get = () => (provider ??= load());
  return {
    startLogin: async (server) => (await get()).startLogin(server),
    restore: async () => (await get()).restore(),
    clearStored: async () => (await get()).clearStored(),
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
