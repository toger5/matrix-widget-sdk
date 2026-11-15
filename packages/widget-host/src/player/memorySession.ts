import { InMemoryBackend } from "@matrix-widget-tools/widget-host-bindings";

import { widgetKey, type StateEvent } from "../widgetStateEvent";
import type { LiveSession, RoomBackend, RoomSummary } from "./session";

export const EXAMPLE_NEW: StateEvent = {
  type: "m.widget",
  state_key: "widget-1",
  content: { name: "New test widget", url: "http://localhost:5175/new/", uses_widget_api: true },
};
export const EXAMPLE_LEGACY: StateEvent = {
  type: "im.vector.modular.widgets",
  state_key: "widget-1",
  content: {
    type: "m.custom",
    name: "Legacy test widget",
    // Template variables are resolved by the compat wrapper, not by this host. The base url
    // variable produces a nested `https://` inside the already nested legacy url.
    url: "http://localhost:5175/legacy/?title=$title&widgetId=$matrix_widget_id&userId=$matrix_user_id&baseUrl=$org.matrix.msc4039.matrix_base_url&theme=$org.matrix.msc2873.client_theme",
    waitForIframeLoad: true,
    creatorUserId: "@alice:example.org",
    data: { title: "Notes & more" },
  },
};

/**
 * Demo files a fresh in-memory store starts with (served from `public/demo/`), so a widget has
 * something to `download_file`. The first one is the test widgets' default URI.
 */
const DEMO_MEDIA = [
  { contentUri: "mxc://example.org/demo-landscape", path: "demo/landscape.png", mimetype: "image/png" },
  { contentUri: "mxc://example.org/demo-tiles", path: "demo/tiles.png", mimetype: "image/png" },
  { contentUri: "mxc://example.org/demo-notes", path: "demo/notes.txt", mimetype: "text/plain" },
];

export async function seedDemoMedia(store: InMemoryBackend): Promise<void> {
  for (const { contentUri, path, mimetype } of DEMO_MEDIA) {
    const data = await (await fetch(path)).arrayBuffer();
    store.addMedia(contentUri, { data, mimetype });
  }
}

export interface MemorySessionOptions {
  roomId?: string;
  userId?: string;
  /** The room's widgets; the two test widgets by default. */
  widgets?: StateEvent[];
}

/**
 * The in-memory stand-in for a logged-in client: one room on the crate's `InMemoryBackend`, with
 * a list of widgets kept here. It implements `LiveSession`, so the player's views work on it
 * unchanged; `store` is what the memory-store panel inspects and seeds. Nothing leaves the page.
 */
export class MemorySession implements LiveSession {
  readonly roomId: string;
  readonly userId: string;
  readonly store: InMemoryBackend;
  private readonly events: StateEvent[];
  private readonly listeners = new Set<() => void>();

  constructor(options: MemorySessionOptions = {}) {
    this.roomId = options.roomId ?? "!room:example.org";
    this.userId = options.userId ?? "@alice:example.org";
    this.store = new InMemoryBackend(this.roomId, this.userId);
    this.events = [...(options.widgets ?? [EXAMPLE_NEW, EXAMPLE_LEGACY])];
  }

  rooms(): RoomSummary[] {
    return [{ id: this.roomId, name: "In-memory room" }];
  }

  onRoomsChanged(): () => void {
    return () => {};
  }

  async widgets(roomId: string): Promise<StateEvent[]> {
    return roomId === this.roomId ? [...this.events] : [];
  }

  onWidgetsChanged(roomId: string, listener: () => void): () => void {
    if (roomId !== this.roomId) return () => {};
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Add a widget to the room, replacing the one with the same event type and state key. Returns its `widgetKey`. */
  addWidget(event: StateEvent): string {
    if (typeof event?.type !== "string" || typeof event.state_key !== "string" || typeof event.content !== "object" || event.content === null) {
      throw new Error("a widget state event needs `type`, `state_key` and `content`");
    }
    const key = widgetKey(event);
    const index = this.events.findIndex((ev) => widgetKey(ev) === key);
    if (index === -1) this.events.push(event);
    else this.events[index] = event;
    this.notify();
    return key;
  }

  /** Every widget of the room shares the one store, handed to each driver like any other `MatrixBackend`. */
  async backendFor(roomId: string): Promise<RoomBackend> {
    if (roomId !== this.roomId) throw new Error(`unknown room ${roomId}`);
    return Object.assign(this.store.asBackend(), { dispose() {} });
  }

  async needsVerification(): Promise<boolean> {
    return false;
  }

  async verifyWithRecoveryKey(): Promise<void> {}

  async startEmojiVerification(): Promise<never> {
    throw new Error("The in-memory store has no devices to verify.");
  }

  /** Leaving the in-memory mode: there is nothing to log out of, the store goes with the session. */
  async logout(): Promise<void> {
    this.store.clear();
  }

  private notify(): void {
    this.listeners.forEach((listener) => listener());
  }
}
