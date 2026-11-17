/**
 * The timeline cache of one room as a `MatrixBackend` hands it to widgets (`timelineRead`,
 * `timelinePaginateBackwards`, `subscribeTimeline`; MSCXXXX, `spec/patch/new/timeline-reading.md`).
 * SDK free: the rust and js backends hand in their cached events, how to paginate and how to learn
 * about events decrypted late. The pagination itself is the session's `RoomTimelines`, so a
 * widget's pagination and the RoomTimeline's are one, and every widget of the room hears of it.
 */
import { BackendError, PaginationStatus, type MatrixEvent, type Subscription, type TimelineFilter, type TimelineSink } from "@matrix-widget-tools/widget-host-bindings";

import type { RoomTimelines, TimelineChange } from "./roomTimelines";

/** How many events a pagination asks for when the widget gives no hint. */
export const DEFAULT_PAGINATION_SIZE = 20;
/** The SDKs take the size of a pagination as a `u16`. */
const MAX_PAGINATION_SIZE = 1000;

/**
 * One event of the cache. `eventType` is undefined while the client cannot decrypt the event: it
 * is left out of reads. `toEvent` is called only for the events a read returns.
 */
export interface CachedEvent {
  eventId: string;
  eventType?: string;
  /** `content.msgtype`, for the filter. */
  msgtype?: unknown;
  toEvent(): MatrixEvent;
}

/**
 * Walk `cache` (oldest first) from the event older than `from` (the newest when undefined) towards
 * older events and collect up to `limit` events matching `filter`, newest first. `from` not in the
 * cache throws `BackendError.EventNotCached`.
 */
export function walkCache(cache: CachedEvent[], from: string | undefined, limit: number, filter: TimelineFilter[]): MatrixEvent[] {
  let end = cache.length;
  if (from !== undefined) {
    end = cache.findIndex((entry) => entry.eventId === from);
    if (end < 0) throw new BackendError.EventNotCached({ eventId: from });
  }
  const events: MatrixEvent[] = [];
  for (let i = end - 1; i >= 0 && events.length < limit; i--) {
    const entry = cache[i];
    if (entry.eventType !== undefined && filter.some((f) => matches(f, entry))) events.push(entry.toEvent());
  }
  return events;
}

function matches(filter: TimelineFilter, entry: CachedEvent): boolean {
  return filter.eventType === entry.eventType && (filter.msgtype === undefined || entry.msgtype === filter.msgtype);
}

/** How a backend reaches its SDK. */
export interface TimelineSource {
  /** Load up to `count` older events into the cache; resolves whether the start of the room is reached. */
  paginate(count: number): Promise<boolean>;
  /**
   * Call `report` with cached events that became decryptable (decrypted), until the returned
   * function is called. A source that cannot tell returns a no-op.
   */
  watchDecrypted(report: (events: MatrixEvent[]) => void): () => void;
}

export class TimelineFeed {
  constructor(
    private readonly timelines: RoomTimelines,
    private readonly roomId: string,
    private readonly source: TimelineSource,
  ) {}

  /** The pagination status; `firstEventType` is the type of the oldest cached event, when the caller has it. */
  status(firstEventType?: string): PaginationStatus {
    const { loading, atStart } = this.timelines.pagination(this.roomId);
    if (loading) return PaginationStatus.Paginating;
    if (atStart || firstEventType === "m.room.create") return PaginationStatus.StartReached;
    return PaginationStatus.Idle;
  }

  /** Start a back-pagination unless one runs or the start is reached; answers at once. Its outcome reaches the subscribers. */
  paginate(limit: number | undefined, firstEventType?: string): PaginationStatus {
    const status = this.status(firstEventType);
    if (status !== PaginationStatus.Idle) return status;
    const count = Math.min(Math.max(limit ?? DEFAULT_PAGINATION_SIZE, 1), MAX_PAGINATION_SIZE);
    // A failure reaches the subscribers through `RoomTimelines`.
    this.timelines.loadOlder(this.roomId, () => this.source.paginate(count)).catch(() => undefined);
    return PaginationStatus.Paginating;
  }

  /** Tell `sink` about every change of the status, resets, failed paginations and late decryptions. */
  subscribe(sink: TimelineSink): Subscription {
    let last = this.status();
    const stopListening = this.timelines.listen(this.roomId, (change: TimelineChange) => {
      const now = this.status();
      const failed = change.failed !== undefined;
      const statusChanged = now !== last || failed;
      last = now;
      if (!statusChanged && !change.reset) return;
      sink.onTimelineUpdate({
        pagination: statusChanged ? now : undefined,
        paginationError: failed ? reason(change.failed) : undefined,
        reset: !!change.reset,
        decrypted: [],
      });
    });
    const stopDecrypted = this.source.watchDecrypted((decrypted) => {
      if (decrypted.length > 0) sink.onTimelineUpdate({ pagination: undefined, paginationError: undefined, reset: false, decrypted });
    });
    let active = true;
    return {
      cancel: () => {
        if (!active) return;
        active = false;
        stopListening();
        stopDecrypted();
      },
    };
  }
}

function reason(e: unknown): string {
  if (BackendError.Failed.instanceOf(e)) return e.inner.reason;
  return e instanceof Error ? e.message : String(e);
}
