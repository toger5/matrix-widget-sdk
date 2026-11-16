/**
 * What the rust and js sessions know about the RoomTimeline of a room beyond its events: whether a
 * pagination reached the start of the room, whether one runs, and who listens. SDK free: the
 * session hands in how to follow a room's events and how to paginate.
 */
import type { RawEvent, RoomTimeline } from "../session";

interface Entry {
  /** A pagination reported the start of the room, and the room has been followed since. */
  atStart: boolean;
  /** The pagination that runs. */
  loading?: Promise<void>;
  listeners: Set<() => void>;
  /** Stops following the room in the SDK; set while the room has listeners. */
  stop?: () => void;
}

/**
 * Follows a room's events in the SDK: calls `changed` whenever they may have changed, with
 * `reset` when the SDK dropped the events it had (the start of the room is no longer among
 * them). Returns how to stop.
 */
export type WatchRoom = (roomId: string, changed: (reset?: boolean) => void) => () => void;

export class RoomTimelines {
  private readonly rooms = new Map<string, Entry>();

  constructor(private readonly watch: WatchRoom) {}

  /** The RoomTimeline of `events`. The start is reached, too, when the first event is the room's creation. */
  timeline(roomId: string, events: RawEvent[]): RoomTimeline {
    const entry = this.rooms.get(roomId);
    return { events, atStart: !!entry?.atStart || events[0]?.type === "m.room.create", loadingOlder: entry?.loading !== undefined };
  }

  /** The room has a listener (it is followed in the SDK). */
  followed(roomId: string): boolean {
    return (this.rooms.get(roomId)?.listeners.size ?? 0) > 0;
  }

  /**
   * `LiveSession.onTimelineChanged`: the room is followed in the SDK while it has a listener. Once
   * the last one is gone, the start of the room is forgotten: a reset would go unnoticed (js: a
   * gap in the sync after `resume()`; rust: the event cache drops all but its newest events when
   * nobody subscribes to it).
   */
  listen(roomId: string, listener: () => void): () => void {
    const entry = this.entry(roomId);
    entry.listeners.add(listener);
    entry.stop ??= this.watch(roomId, (reset) => {
      if (reset) entry.atStart = false;
      this.notify(entry);
    });
    return () => {
      if (!entry.listeners.delete(listener) || entry.listeners.size > 0) return;
      entry.stop?.();
      entry.stop = undefined;
      entry.atStart = false;
    };
  }

  /**
   * `LiveSession.loadOlderEvents`: runs `paginate` (it resolves whether the start of the room is
   * reached), unless a pagination of the room runs already; then it waits for that one. The
   * listeners hear when it starts and when it ends.
   */
  loadOlder(roomId: string, paginate: () => Promise<boolean>): Promise<void> {
    const entry = this.entry(roomId);
    if (!entry.loading) {
      entry.loading = this.run(entry, paginate);
      this.notify(entry);
    }
    return entry.loading;
  }

  private async run(entry: Entry, paginate: () => Promise<boolean>): Promise<void> {
    try {
      if (await paginate()) entry.atStart = true;
    } finally {
      entry.loading = undefined;
      this.notify(entry);
    }
  }

  private entry(roomId: string): Entry {
    let entry = this.rooms.get(roomId);
    if (!entry) this.rooms.set(roomId, (entry = { atStart: false, listeners: new Set() }));
    return entry;
  }

  private notify(entry: Entry): void {
    entry.listeners.forEach((listener) => listener());
  }
}
