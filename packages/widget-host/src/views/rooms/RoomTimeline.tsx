import { I18nApi, I18nContext, registerTranslations, TimelineSeparator, TimelineView, type TimelineItem } from "@element-hq/web-shared-components";
import EN_STRINGS from "@element-hq/web-shared-components/en_EN.json";
import { TooltipProvider } from "@vector-im/compound-web";
import { useCallback, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";

import type { RoomId } from "../../appViewModel";
import type { TimelineRow } from "../../session";
import { useDispatch, useViewEnv } from "../env";
import { Button } from "../ui/atoms";
import { dayLabel } from "./eventText";
import { TimelineTile } from "./TimelineTile";

/** The shared components need one, with their English strings; the host has no translations. */
registerTranslations("en", EN_STRINGS);
const I18N = new I18nApi();

export interface RoomTimelineProps {
  roomId: RoomId;
}

/**
 * What the Timeline tab shows (stories `rooms-roomtimeline--*`): Element Web's `TimelineView` on
 * `useViewEnv().useTimelineViewModel(roomId)`. Virtualised, it starts at the bottom and stays there
 * while new events arrive; scrolling to the top loads older events. A date separator per day;
 * pressing an event's type shows its JSON. Below it a composer for text messages.
 */
export function RoomTimeline({ roomId }: RoomTimelineProps) {
  const vm = useViewEnv().useTimelineViewModel(roomId);
  const timelineRef = useRef<HTMLDivElement>(null);
  useStartAtBottom(timelineRef, roomId);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback(
    (key: string) =>
      setOpen((keys) => {
        const next = new Set(keys);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );
  const renderItem = (item: TimelineItem) => {
    switch (item.kind) {
      case "date-separator":
        return <TimelineSeparator label={dayLabel(item.ts)} />;
      case "loading":
        return (
          <p className="tl-loading" role="status">
            <span className="spinner" aria-hidden="true" /> Loading older events…
          </p>
        );
      case "event":
        return <TimelineTile rowKey={item.key} row={item.event as TimelineRow} continuation={item.continuation} open={open.has(item.key)} onToggle={toggle} />;
      default:
        return null;
    }
  };
  return (
    <div className="tl-tab">
      <div ref={timelineRef} className="tl" data-testid="room-timeline" data-room-id={roomId}>
        <I18nContext.Provider value={I18N}>
          <TooltipProvider>
            <TimelineView key={roomId} vm={vm} renderItem={renderItem} />
          </TooltipProvider>
        </I18nContext.Provider>
      </div>
      <Composer roomId={roomId} send={vm.send} />
    </div>
  );
}

/** Frames the timeline has to stay at the bottom before `useStartAtBottom` lets go, and the most it waits (~3 s). */
const SETTLED_FRAMES = 10;
const MAX_FRAMES = 180;

/**
 * Every open starts at the newest event. The TimelineView scrolls there itself, but gives up after
 * a second (`REVEAL_TIMEOUT_MS`) while rows still change height (images, long or formatted
 * messages), and is then shown wherever it got to. So once it is shown, keep it at the bottom
 * until it has stayed there for a few frames (again for another room); a wheel, touch, key or
 * pointer press in it ends this at once.
 */
function useStartAtBottom(container: RefObject<HTMLDivElement | null>, roomId: RoomId) {
  useEffect(() => {
    const root = container.current;
    if (!root) return;
    let frame = 0;
    let settled = 0;
    let raf = 0;
    const stop = () => cancelAnimationFrame(raf);
    const events = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
    events.forEach((e) => root.addEventListener(e, stop, { capture: true, passive: true }));
    const tick = () => {
      const el = root.querySelector<HTMLElement>('[data-testid="timeline-scroller"]');
      // Hidden: still loading or placing its first rows, however long that takes.
      if (el?.checkVisibility({ visibilityProperty: true })) {
        const bottom = el.scrollHeight - el.clientHeight;
        if (el.scrollTop < bottom - 1) ((el.scrollTop = bottom), (settled = 0));
        else if (++settled >= SETTLED_FRAMES) return;
        if (++frame >= MAX_FRAMES) return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      stop();
      events.forEach((e) => root.removeEventListener(e, stop, { capture: true }));
    };
  }, [container, roomId]);
}

/** Below the timeline: a text message as the account (the view model's `send`, else `room/sendMessage`); Enter sends it. */
function Composer({ roomId, send: sendBody }: { roomId: RoomId; send?: (body: string) => void }) {
  const dispatch = useDispatch();
  const [text, setText] = useState("");
  const send = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (sendBody) sendBody(text);
    else dispatch({ type: "room/sendMessage", roomId, body: text });
    setText("");
  };
  return (
    <form className="tl-composer" aria-label="Send a message" onSubmit={send}>
      <input className="input grow" aria-label="Message" placeholder="Send a message…" value={text} onChange={(e) => setText(e.target.value)} />
      <Button kind="primary" type="submit" disabled={!text.trim()}>
        Send
      </Button>
    </form>
  );
}
