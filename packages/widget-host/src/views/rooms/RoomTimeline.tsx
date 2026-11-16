import { memo, useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";

import { OLDER_EVENTS_PER_LOAD, type RoomId } from "../../appViewModel";
import type { RawEvent, RoomTimeline as RoomTimelineData } from "../../session";
import { useDispatch, useViewEnv } from "../env";
import { Button, Icon, Json } from "../ui/atoms";
import { dayKey, describeEvent, eventDay, eventTime } from "./eventText";

export interface RoomTimelineProps {
  roomId: RoomId;
}

/** How many of the newest events are rendered, and how many more each "Load older events" shows of those already loaded. */
// TODO-FINDING room-timeline-not-virtualized - the RoomTimeline renders the newest 200 events, not a virtualised list; "Load older events" shows more of the loaded ones before it asks the session.
const RENDERED = 200;
/** Closer to the bottom than this (px), the timeline counts as scrolled to the bottom and stays there. */
const PINNED_SLACK = 8;
/** How many of the rows in view keep their place while events are added or dropped above them (the first one that is still there). */
const ANCHORS = 8;

/**
 * What the Timeline tab shows: the events of the room, oldest at the top, newest at the bottom
 * (mockup function `timelineBody`). leaves timeline/*. It starts scrolled to the bottom and stays
 * there while new events arrive; scrolled up, the events in view stay where they are. A heading
 * per day; pressing a line shows the event's JSON. The events come from
 * `useViewEnv().useRoomTimeline(roomId)`; nothing of them is in the view model.
 */
export function RoomTimeline({ roomId }: RoomTimelineProps) {
  const { timeline, retry } = useViewEnv().useRoomTimeline(roomId);
  if (timeline.status === "loading") {
    return (
      <div className="tl" data-testid="room-timeline" data-room-id={roomId}>
        <div className="empty tl-state" role="status">
          <span className="spinner" aria-hidden="true" />
          <b>Loading the timeline…</b>
        </div>
      </div>
    );
  }
  if (timeline.status === "error") {
    return (
      <div className="tl" data-testid="room-timeline" data-room-id={roomId}>
        <div className="empty tl-state" role="alert">
          <Icon name="alert" size={28} className="danger" />
          <b>The timeline could not be loaded</b>
          <p>{timeline.error}</p>
          <Button kind="primary" icon="refresh" onClick={retry}>
            Try again
          </Button>
        </div>
      </div>
    );
  }
  return <TimelineEvents roomId={roomId} timeline={timeline.value} />;
}

/** The key of an event in the list: its id (an event without one, which a session should not hand out, gets its position). */
const keyOf = (event: RawEvent, index: number) => (typeof event.event_id === "string" ? event.event_id : `#${index}`);

interface Day {
  key: string;
  label: string;
  events: { key: string; event: RawEvent }[];
}

/**
 * The rendered events by day. A day's key is its date, so it stays the same when its oldest
 * rendered event is dropped (its rows are not mounted again, the focus stays); a date that comes
 * back after another one (clocks of servers differ) gets a number.
 */
function byDay(events: RawEvent[], offset: number): Day[] {
  const days: Day[] = [];
  const seen = new Map<string, number>();
  let last: string | undefined;
  events.forEach((event, i) => {
    const key = dayKey(event);
    let day = days.at(-1);
    if (!day || key !== last) {
      last = key;
      const n = seen.get(key) ?? 0;
      seen.set(key, n + 1);
      days.push((day = { key: n > 0 ? `${key}#${n}` : key, label: eventDay(event).label, events: [] }));
    }
    day.events.push({ key: keyOf(event, offset + i), event });
  });
  return days;
}

/** One line of the RoomTimeline and, open, the event's JSON. Rendered again only when its event or `open` changes. */
const TimelineRow = memo(function TimelineRow({ rowKey, event, open, onToggle }: { rowKey: string; event: RawEvent; open: boolean; onToggle: (key: string) => void }) {
  const said = describeEvent(event);
  return (
    <li className={`tl-ev ${said.state ? "state" : ""} ${open ? "open" : ""}`} data-key={rowKey} data-event-id={typeof event.event_id === "string" ? event.event_id : undefined}>
      <button type="button" className="tl-h" aria-expanded={open} onClick={() => onToggle(rowKey)}>
        <span className="tl-time">{eventTime(event)}</span>
        <span className="tl-s">{typeof event.sender === "string" ? event.sender : ""}</span>
        <span className="tl-p">
          {said.icon && <Icon name={said.icon} size={13} />}
          <span className={said.mono ? "mono" : ""}>{said.text}</span>
        </span>
        {/* String(): the event comes from the homeserver, which may send anything as its type. */}
        <span className="mono tl-t">{String(event.type)}</span>
      </button>
      {open && (
        <pre className="code">
          <Json value={event} />
        </pre>
      )}
    </li>
  );
});

function TimelineEvents({ roomId, timeline }: { roomId: RoomId; timeline: RoomTimelineData }) {
  const dispatch = useDispatch();
  const ids = useId();
  const { events, atStart, loadingOlder } = timeline;
  /** How many of the newest events are rendered. */
  const [limit, setLimit] = useState(RENDERED);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const offset = Math.max(0, events.length - limit);
  const days = useMemo(() => byDay(offset > 0 ? events.slice(offset) : events, offset), [events, offset]);

  const busy = loadingOlder && offset === 0;
  const loadOlder = () => {
    if (busy) return;
    // First what is loaded but not rendered, then older events from the session (rendered once they arrive).
    if (offset > 0) return setLimit(limit + RENDERED);
    setLimit(events.length + OLDER_EVENTS_PER_LOAD);
    dispatch({ type: "room/loadOlderEvents", roomId });
  };
  const toggle = useCallback(
    (key: string) =>
      setOpen((keys) => {
        const next = new Set(keys);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  // "Load older events" keeps the focus while it loads (`aria-disabled`, not `disabled`); when
  // "Start of the room" replaces it, the focus moves to the oldest event instead of being lost.
  const topRef = useRef<HTMLDivElement>(null);
  /** "Load older events" had the focus at the last render, or got it since. */
  const olderFocused = useRef(false);

  // Scrolling: at the bottom it stays at the bottom; scrolled up, the events in view keep their place
  // when events are added or dropped above them (older ones shown, the oldest rendered one dropped).
  const scrollerRef = useRef<HTMLDivElement>(null);
  const pinned = useRef(true);
  /** The first rows in view and their distance from the top edge, as of the last scroll or render. */
  const anchors = useRef<{ key: string; top: number }[]>([]);
  const remember = () => {
    const el = scrollerRef.current;
    if (!el) return;
    pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight <= PINNED_SLACK;
    const top = el.getBoundingClientRect().top;
    const rows = Array.from(el.querySelectorAll<HTMLElement>(".tl-ev"));
    // The first row whose bottom is below the top edge (the rows are in order: binary search).
    let lo = 0;
    let hi = rows.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (rows[mid].getBoundingClientRect().bottom > top) hi = mid;
      else lo = mid + 1;
    }
    // A few of them: the first one may be the oldest rendered row, which a new event drops.
    anchors.current = rows.slice(lo, lo + ANCHORS).map((row) => ({ key: row.dataset.key ?? "", top: row.getBoundingClientRect().top - top }));
  };
  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const doc = el.ownerDocument;
    if (olderFocused.current && !topRef.current && (doc.activeElement === null || doc.activeElement === doc.body)) {
      el.querySelector<HTMLElement>(".tl-h")?.focus({ preventScroll: true });
    }
    // The UI lives in a shadow root: its own `activeElement`.
    olderFocused.current = !!topRef.current?.contains((el.getRootNode() as Document | ShadowRoot).activeElement);
    if (pinned.current) el.scrollTop = el.scrollHeight;
    else {
      const rows = new Map(Array.from(el.querySelectorAll<HTMLElement>(".tl-ev"), (row) => [row.dataset.key, row]));
      const anchor = anchors.current.find((a) => rows.has(a.key));
      const row = anchor && rows.get(anchor.key);
      if (anchor && row) el.scrollTop += row.getBoundingClientRect().top - el.getBoundingClientRect().top - anchor.top;
    }
    remember();
  });
  // The panel or the content changed its size without a render (the window, a font): stay at the bottom.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (pinned.current) el.scrollTop = el.scrollHeight;
    });
    observer.observe(el);
    if (el.firstElementChild) observer.observe(el.firstElementChild);
    return () => observer.disconnect();
  }, []);

  return (
    <div ref={scrollerRef} className="tl" data-testid="room-timeline" data-room-id={roomId} onScroll={remember}>
      <div className="tl-in">
        {offset === 0 && atStart ? (
          <p className="tl-top tl-start">Start of the room</p>
        ) : (
          <div ref={topRef} className="tl-top" onFocus={() => (olderFocused.current = true)}>
            <Button sm aria-disabled={busy || undefined} onClick={loadOlder}>
              {busy ? "Loading older events…" : "Load older events"}
            </Button>
          </div>
        )}
        {days.map((day) => {
          const id = `${ids}-day-${day.key}`;
          return (
            <section key={day.key} className="tl-day">
              <h3 className="tl-day-h" id={id}>
                {day.label}
              </h3>
              <ul className="tl-list" aria-labelledby={id}>
                {day.events.map(({ key, event }) => (
                  <TimelineRow key={key} rowKey={key} event={event} open={open.has(key)} onToggle={toggle} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}
