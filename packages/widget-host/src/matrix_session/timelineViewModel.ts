/**
 * The view models of the Timeline tab (Element Web's `TimelineView`, `LiveSession.timelineViewModel`).
 * The rust session has its own on the SDK timeline (`./rust/timelineViewModel.ts`); the js session
 * and the DevBackend use `rawTimelineViewModel`, kept small on purpose (the js session is to be
 * dropped, the DevBackend needs the tab for debugging only).
 */
import type { TimelineItem } from "@element-hq/web-shared-components";

import { OLDER_EVENTS_PER_LOAD, rawTimelineItems, TIMELINE_ACTIONS, timelineSnapshot } from "../appViewModel";
import type { LiveSession, RoomTimeline, RoomTimelineViewModel } from "../session";

/** A view model that shows what `show` was last given; no items until then (`staticTimeline` says why). */
export function timelineStore(onStartReached: () => void, dispose: () => void): RoomTimelineViewModel & { show(items: TimelineItem[]): void } {
  let snapshot = timelineSnapshot([]);
  const listeners = new Set<() => void>();
  return {
    ...TIMELINE_ACTIONS,
    onStartReached,
    // Once the TimelineView shows its first rows. If they do not fill it, nothing scrolls and it never reports the top: load older events here.
    onAnchorReached: onStartReached,
    dispose,
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    show: (items) => {
      snapshot = timelineSnapshot(items);
      listeners.forEach((listener) => listener());
    },
  };
}

/**
 * The Timeline tab on `session.timeline(roomId)`: read again on every change, one read at a time. A
 * failed read is logged. Images are loaded with `avatar` (the js session: a small thumbnail).
 */
export function rawTimelineViewModel(session: Pick<LiveSession, "userId" | "timeline" | "loadOlderEvents" | "onTimelineChanged" | "avatar">, roomId: string): RoomTimelineViewModel {
  let last: RoomTimeline | undefined;
  let state: "idle" | "reading" | "again" = "idle";
  let stopped = false;
  const read = async (): Promise<void> => {
    if (state !== "idle") return void (state = "again");
    do {
      state = "reading";
      try {
        last = await session.timeline(roomId);
        if (!stopped) vm.show(rawTimelineItems(last, session.userId, (mxcUrl) => session.avatar(mxcUrl)));
      } catch (e) {
        console.error("the timeline could not be read", e);
      }
    } while ((state as string) === "again" && !stopped);
    state = "idle";
  };
  const loadOlder = () => {
    if (last && !last.atStart && !last.loadingOlder) session.loadOlderEvents(roomId, OLDER_EVENTS_PER_LOAD).catch((e) => console.error("older events could not be loaded", e));
  };
  const stop = session.onTimelineChanged(roomId, () => void read());
  const vm = timelineStore(loadOlder, () => {
    stopped = true;
    stop();
  });
  void read();
  return vm;
}
