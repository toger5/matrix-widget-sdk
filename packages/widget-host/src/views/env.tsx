/**
 * What a view gets besides its props. The MVVM split of the host:
 *
 * - **Model**: sessions, backends, drivers, iframes (`src/app/runtime`, `src/matrix_session`).
 * - **View model**: `AppViewModel` (`src/appViewModel.ts`), held by the `AppController`.
 * - **View**: the components in `src/views`. A view gets its slice of the view model as props,
 *   and everything else through this context: `dispatch` to send an `AppIntent`, and hooks for
 *   the data that is deliberately not in the view model (it changes too often).
 *
 * Views never import `src/app`, a session or the bindings. That keeps them renderable in
 * Storybook: `StoryEnv` (`src/views/storyEnv.tsx`) provides this context from fixtures.
 */
import { createContext, useContext } from "react";

import { loggableIntent, type AppIntent, type Loadable, type MockedRoomData, type RoomId, type WidgetDevToolsData, type WidgetInstanceId } from "../appViewModel";
import type { RawEvent, RoomDetails, RoomTimeline } from "../session";
import type { WidgetEventParser } from "../widgetStateEvent";

export interface ViewEnv {
  /** Send an intent to the controller. Stable for the lifetime of the app. */
  dispatch: (intent: AppIntent) => void;
  /** The window is narrower than ~900px: the SidePanel overlays, one room panel is visible. */
  narrow: boolean;
  /** Hook: the dev tools data of one widget (messages, stats, capabilities, console). */
  useDevToolsData: (widgetId: WidgetInstanceId) => WidgetDevToolsData;
  /** Hook: the content of the DevBackend, with the `scheduled` events of its room picked in the Dev tools. */
  useMockedRoomData: () => MockedRoomData;
  /** Hook: what the RoomOverview shows beyond the `RoomSummary` (topic, members, encryption). */
  useRoomDetails: (roomId: RoomId) => Loadable<RoomDetails>;
  /** Hook: the RoomTimeline of a room (`LiveSession.timeline`), kept up to date; `retry` loads it again after an error. */
  useRoomTimeline: (roomId: RoomId) => RoomTimelineData;
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
   * widgets, what their iframe loads, the URL check of the widget forms. Pass it to `roomWidgets`.
   */
  widgetEvents: WidgetEventParser;
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
  capabilities: { approved: [], autoApproved: [], denied: [], singleUse: [] },
  console: [],
};

export const EMPTY_MOCKED_ROOM_DATA: MockedRoomData = { rooms: [], scheduled: [], toDevice: [], failSends: false, media: [] };

const LOADING: Loadable<RoomDetails> = { status: "loading" };
const LOADING_TIMELINE: RoomTimelineData = { timeline: { status: "loading" }, retry: () => {} };
const LOADING_STATE: RoomStateData = { state: { status: "loading" }, retry: () => {} };

export const DEFAULT_VIEW_ENV: ViewEnv = {
  dispatch: (intent) => console.info("intent", loggableIntent(intent)),
  narrow: false,
  useDevToolsData: () => EMPTY_DEV_TOOLS_DATA,
  useMockedRoomData: () => EMPTY_MOCKED_ROOM_DATA,
  useRoomDetails: () => LOADING,
  useRoomTimeline: () => LOADING_TIMELINE,
  useRoomState: () => LOADING_STATE,
  avatar: async () => undefined,
  // Without the app (no provider) nothing is a widget and no URL passes.
  widgetEvents: { resolve: () => undefined, urlProblem: () => "no widget parser" },
};

export const ViewEnvContext = createContext<ViewEnv>(DEFAULT_VIEW_ENV);

export const useViewEnv = () => useContext(ViewEnvContext);
export const useDispatch = () => useContext(ViewEnvContext).dispatch;
