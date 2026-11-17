/**
 * The legacy `org.matrix.msc2876.read_events`, answered by the wrapper: the host does not know it.
 *
 * - A **timeline** read becomes `read_timeline` reads of the host's timeline cache (MSCXXXX,
 *   `spec/patch/new/timeline-reading.md`), filtered by the legacy `type` / `msgtype`. While the
 *   answer is short of `limit` and the host's pagination is `idle`, the reader asks the host to
 *   `paginate_timeline`, waits for the `notify_timeline_update` that ends it, and reads on below
 *   the oldest event it has. It stops at `limit`, at `start_reached`, at a failed pagination or at
 *   a deadline well under the legacy 10 s timeout, and answers with what it has, newest first, as
 *   Element Web's `readRoomTimeline` does. Without `limit` (a legacy "as many as possible") it
 *   answers from the cache only. `since` is not supported (no host of this repository supported it).
 * - A **state** read (`state_key` present) is answered from the state the host pushed with
 *   `update_state` (the legacy `receive.state_event:<type>` expands to it), kept per type here.
 * - `room_ids`: only the widget's own room is served; a list without it reads nothing.
 *
 * Driven by the bridge: `read` for each request, `onUpdateState` / `onTimelineUpdate` for what the
 * host pushes.
 */
import { errorBody, isErrorBody, PLACEHOLDER } from "./envelope";

/** The legacy action, as matrix-widget-api sends it. */
export const LEGACY_READ_EVENTS_ACTION = "org.matrix.msc2876.read_events";
/** The host's timeline actions. */
export const READ_TIMELINE_ACTION = `${PLACEHOLDER}.read_timeline`;
export const PAGINATE_TIMELINE_ACTION = `${PLACEHOLDER}.paginate_timeline`;
export const NOTIFY_TIMELINE_UPDATE_ACTION = `${PLACEHOLDER}.notify_timeline_update`;

/** How long a legacy timeline read may take in all: under the 10 s a legacy widget waits. */
export const LEGACY_READ_DEADLINE_MS = 7000;
/** The largest number of events one read asks for (hosts clamp `limit`, this repository's at 1000). */
const MAX_LIMIT = 1000;
/** A host that keeps answering "idle" and then "start reached" must not make the reader spin. */
const MAX_ROUNDS = 50;

type PaginationStatus = "idle" | "paginating" | "start_reached";
interface TimelinePage {
  events?: { event_id?: unknown }[];
  pagination?: PaginationStatus;
}
/** What a `notify_timeline_update` said about the end of a pagination. */
interface Settled {
  error?: unknown;
  reset?: boolean;
}

export interface ReaderOptions {
  /** Send a request to the host; resolves with its response body (an error body included). */
  call(action: string, request: unknown): Promise<unknown>;
  /** Does the widget hold `host:…update_state:<type>` (any state key)? */
  holdsUpdateState(eventType: string): boolean;
  /** The widget's room, once known (`get_matrix_context`). */
  roomId(): string | undefined;
  deadlineMs?: number;
}

const TIMEOUT = Symbol("timeout");

export class LegacyEventReader {
  /** The state the host pushed (`update_state`), per event type. */
  private readonly state = new Map<string, { state_key?: unknown }[]>();
  private readonly waiters = new Set<(settled: Settled) => void>();

  constructor(private readonly o: ReaderOptions) {}

  /** The host's `update_state`: the current set of each event type it carries. */
  onUpdateState(request: unknown): void {
    const events = (request as { state?: unknown } | undefined)?.state;
    if (!Array.isArray(events)) return;
    const byType = new Map<string, { state_key?: unknown }[]>();
    for (const event of events as { type?: unknown; state_key?: unknown }[]) {
      if (typeof event?.type !== "string") continue;
      byType.set(event.type, [...(byType.get(event.type) ?? []), event]);
    }
    for (const [type, set] of byType) this.state.set(type, set);
  }

  /** The host's `notify_timeline_update`: wakes up the reads waiting for a pagination to end. */
  onTimelineUpdate(request: unknown): void {
    const { pagination, reset } = (request ?? {}) as { pagination?: { status?: unknown; error?: unknown }; reset?: unknown };
    const ended = pagination !== undefined && pagination.status !== "paginating";
    if (!ended && reset !== true) return;
    const settled: Settled = { ...(pagination?.error !== undefined ? { error: pagination.error } : {}), ...(reset === true ? { reset: true } : {}) };
    for (const waiter of [...this.waiters]) waiter(settled);
  }

  /** The legacy response body for a `read_events` request body. */
  async read(data: unknown): Promise<unknown> {
    const { type, msgtype, state_key: stateKey, limit, room_ids: roomIds } = (data ?? {}) as Record<string, unknown>;
    if (typeof type !== "string" || type === "") return errorBody("Invalid request - missing event type");
    if (limit !== undefined && !(typeof limit === "number" && limit > 0)) return errorBody("Invalid request - limit out of range");
    if (!this.servesOwnRoom(roomIds)) return { events: [] };
    const max = typeof limit === "number" ? Math.min(Math.floor(limit), MAX_LIMIT) : undefined;
    if (stateKey !== undefined) return this.readState(type, stateKey === true ? undefined : String(stateKey), max);
    return this.readTimeline(type, typeof msgtype === "string" ? msgtype : undefined, max);
  }

  private servesOwnRoom(roomIds: unknown): boolean {
    if (!Array.isArray(roomIds)) return true; // absent, or `*`: the widget's room
    const own = this.o.roomId();
    return own === undefined || roomIds.includes(own);
  }

  private readState(type: string, stateKey: string | undefined, limit: number | undefined): unknown {
    if (!this.o.holdsUpdateState(type)) return errorBody("Cannot read state events of this type");
    const events = (this.state.get(type) ?? []).filter((event) => stateKey === undefined || event.state_key === stateKey);
    return { events: limit === undefined ? events : events.slice(0, limit) };
  }

  private async readTimeline(type: string, msgtype: string | undefined, limit: number | undefined): Promise<unknown> {
    const want = limit ?? MAX_LIMIT;
    const filter = [{ type, ...(msgtype === undefined ? {} : { msgtype }) }];
    const deadline = Date.now() + (this.o.deadlineMs ?? LEGACY_READ_DEADLINE_MS);
    const events: { event_id?: unknown }[] = [];
    let from: string | undefined;

    for (let round = 0; round < MAX_ROUNDS; round++) {
      const response = await this.within(deadline, this.o.call(READ_TIMELINE_ACTION, { ...(from === undefined ? {} : { from }), limit: want - events.length, filter }));
      if (response === TIMEOUT) break;
      // Refused (no capability), or `from` dropped by a reset of the cache: answer with what there is.
      if (isErrorBody(response)) {
        if (events.length === 0) return response;
        break;
      }
      const page = response as TimelinePage;
      const got = Array.isArray(page.events) ? page.events : [];
      events.push(...got);
      const oldest = got.at(-1)?.event_id;
      if (typeof oldest === "string") from = oldest;
      if (events.length >= want || limit === undefined || page.pagination === "start_reached") break;

      // Short: wait for older events, starting a pagination unless one runs.
      const settled = this.nextSettled(deadline);
      if (page.pagination !== "paginating") {
        const paginated = await this.within(deadline, this.o.call(PAGINATE_TIMELINE_ACTION, { limit: want - events.length }));
        const status = paginated === TIMEOUT || isErrorBody(paginated) ? undefined : (paginated as { pagination?: PaginationStatus }).pagination;
        if (status !== "paginating") {
          settled.cancel();
          // Refused or timed out: done. `start_reached`: one more read sees the final status.
          if (status === "start_reached") continue;
          break;
        }
      }
      const outcome = await settled.promise;
      if (outcome === undefined || outcome.error !== undefined) break;
    }
    return { events: events.slice(0, want) };
  }

  /** The next end of a pagination (or reset), or `undefined` at the deadline. */
  private nextSettled(deadline: number): { promise: Promise<Settled | undefined>; cancel(): void } {
    let waiter: ((settled: Settled) => void) | undefined;
    const promise = new Promise<Settled | undefined>((resolve) => {
      waiter = (settled) => {
        this.waiters.delete(waiter!);
        resolve(settled);
      };
      this.waiters.add(waiter);
    });
    const cancel = () => {
      if (waiter) this.waiters.delete(waiter);
    };
    return {
      promise: this.within(deadline, promise).then((result) => {
        cancel();
        return result === TIMEOUT ? undefined : result;
      }),
      cancel,
    };
  }

  private within<T>(deadline: number, promise: Promise<T>): Promise<T | typeof TIMEOUT> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<typeof TIMEOUT>((resolve) => (timer = setTimeout(() => resolve(TIMEOUT), Math.max(0, deadline - Date.now()))));
    return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
  }
}
