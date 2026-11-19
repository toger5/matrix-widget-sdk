/**
 * What a view gets besides its props: `dispatch` for intents, and hooks for the data that is kept out
 * of the view model because it changes too often. The app provides it (`src/app/AppRoot.tsx`), the
 * stories fake it (`src/views/storyEnv.tsx`); see `src/views/README.md`.
 */
import { createContext, useContext, type ReactNode } from "react";

import type { TimelineItem } from "@element-hq/web-shared-components";
import { loggableIntent, TIMELINE_ACTIONS, timelineSnapshot, type AppIntent, type Loadable, type MockedRoomData, type RoomId, type WidgetDevToolsData, type WidgetInstanceId, type WidgetInstanceViewModel } from "../appViewModel";
import type { RawEvent, RoomDetails, RoomTimeline, RoomTimelineViewModel } from "../session";
import type { WidgetEventParser } from "../widgetStateEvent";

export interface ViewEnv {
  /** Send an intent to the controller. Stable for the lifetime of the app. */
  dispatch: (intent: AppIntent) => void;
  /** The window is narrower than ~900px: the SidePanel overlays, one room panel is visible. */
  narrow: boolean;
  /** Hook: the dev tools data of one widget (messages, stats, capabilities, console). */
  useDevToolsData: (widgetId: WidgetInstanceId) => WidgetDevToolsData;
  /**
   * Hook: the content of the DevBackend, with the `scheduled` events and the `pagination` of the
   * mocked room `roomId` (a room dev tools tab), else of the room picked in the Dev tools.
   */
  useMockedRoomData: (roomId?: RoomId) => MockedRoomData;
  /** Hook: what the RoomOverview shows beyond the `RoomSummary` (topic, members, encryption). */
  useRoomDetails: (roomId: RoomId) => Loadable<RoomDetails>;
  /** Hook: the RoomTimeline of a room (`LiveSession.timeline`), kept up to date; `retry` loads it again after an error. */
  useRoomTimeline: (roomId: RoomId) => RoomTimelineData;
  /** Hook: the view model of the Timeline tab of a room (`LiveSession.timelineViewModel`), disposed when the tab goes. */
  useTimelineViewModel: (roomId: RoomId) => RoomTimelineViewModel;
  /**
   * Hook: the whole current state of a room (`LiveSession.roomState`), for the Dev tools. Read once
   * `version` is known and again whenever it changes (`roomStateVersion` of the room's timeline);
   * `retry` reads it again after an error.
   */
  useRoomState: (roomId: RoomId, version: string | undefined) => RoomStateData;
  /** Resolve an `mxc://` avatar to a URL an `<img>` can show (`LiveSession.avatar`). */
  avatar: (mxcUrl: string) => Promise<string | undefined>;
  /**
   * The driver's widget state event parser (`src/lib/widgetEvents.ts`): which state events are
   * widgets, what their iframe loads, the check of the widget forms. Pass it to `roomWidgets`.
   */
  widgetEvents: WidgetEventParser;
  /**
   * Stories only: what a `WidgetSlot` shows in place of the widget's iframe (outside the app's
   * shadow root a `<slot>` shows its children). `compact`: inside a PiP box. The app leaves it
   * undefined: its iframes are slotted in.
   */
  widgetStandIn?: (widget: WidgetInstanceViewModel, compact: boolean) => ReactNode;
}

/** What `useRoomState` returns. */
export interface RoomStateData {
  state: Loadable<RawEvent[]>;
  /** Read the state again (the "Try again" of its error state). */
  retry: () => void;
}

/** What `useRoomTimeline` returns. */
export interface RoomTimelineData {
  timeline: Loadable<RoomTimeline>;
  /** Load the timeline again (the "Try again" of its error state). */
  retry: () => void;
}

export const EMPTY_DEV_TOOLS_DATA: WidgetDevToolsData = {
  messages: [],
  stats: { actionsFromWidget: 0, actionsToWidget: 0, eventsSharedWithWidget: 0, eventsSentFromWidget: 0, charactersTotal: { toWidget: 0, fromWidget: 0 }, characters: [] },
  capabilities: { approved: [], autoApproved: [], denied: [], singleUse: [], webview: { applied: [], sandbox: "allow-scripts allow-same-origin", allow: "" } },
  console: [],
};

export const EMPTY_MOCKED_ROOM_DATA: MockedRoomData = { rooms: [], scheduled: [], toDevice: [], failSends: false, media: [] };

const LOADING: Loadable<RoomDetails> = { status: "loading" };
const LOADING_TIMELINE: RoomTimelineData = { timeline: { status: "loading" }, retry: () => {} };
/**
 * A timeline of fixed `items`; without them it is loading (the TimelineView's spinner). A
 * TimelineView must mount without items: it scrolls to the bottom once the first ones arrive, in an
 * effect that React's StrictMode would cancel on mount.
 */
export const staticTimeline = (items: TimelineItem[] = []): RoomTimelineViewModel => {
  const snapshot = timelineSnapshot(items);
  return { ...TIMELINE_ACTIONS, getSnapshot: () => snapshot, subscribe: () => () => {}, dispose: () => {} };
};
const LOADING_TIMELINE_VM = staticTimeline();
const LOADING_STATE: RoomStateData = { state: { status: "loading" }, retry: () => {} };

export const DEFAULT_VIEW_ENV: ViewEnv = {
  dispatch: (intent) => console.info("intent", loggableIntent(intent)),
  narrow: false,
  useDevToolsData: () => EMPTY_DEV_TOOLS_DATA,
  useMockedRoomData: () => EMPTY_MOCKED_ROOM_DATA,
  useRoomDetails: () => LOADING,
  useRoomTimeline: () => LOADING_TIMELINE,
  useTimelineViewModel: () => LOADING_TIMELINE_VM,
  useRoomState: () => LOADING_STATE,
  avatar: async () => undefined,
  // Without the app (no provider) nothing is a widget and no URL passes.
  widgetEvents: { resolve: () => undefined },
};

export const ViewEnvContext = createContext<ViewEnv>(DEFAULT_VIEW_ENV);

export const useViewEnv = () => useContext(ViewEnvContext);
export const useDispatch = () => useContext(ViewEnvContext).dispatch;
