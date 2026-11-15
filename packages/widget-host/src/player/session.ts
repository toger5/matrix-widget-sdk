/**
 * Everything the player needs from a Matrix client, as interfaces. The UI (`App`, `Login`,
 * `Player`, `RoomView`, `WidgetView`) only uses this module, so swapping the Matrix SDK means
 * writing another `SessionProvider` and changing the one line at the bottom. Nothing here, and
 * nothing in the UI, may import an SDK.
 *
 * The in-memory mode (`./memorySession`) implements `LiveSession` too, which is why it gets the
 * same views as a logged-in client.
 */
import type { MatrixBackend } from "@matrix-widget-tools/widget-host-bindings";

import type { StateEvent } from "../widgetStateEvent";

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
  /** Log out and delete everything stored for this login. */
  logout(): Promise<void>;
}

export interface SessionProvider {
  /** Look the homeserver up and report how it lets users log in. */
  startLogin(server: string): Promise<PendingLogin>;
  /** Restore the stored login, if there is one. */
  restore(): Promise<LiveSession | undefined>;
  /** Forget a stored login that can no longer be restored. */
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

/** The Matrix SDK this build of the player runs on. */
export const sessions: SessionProvider = lazyProvider(() => import("../js_sdk/session").then((m) => m.jsSdkSessions));
