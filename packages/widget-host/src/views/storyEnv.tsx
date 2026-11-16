/** The `ViewEnv` of the stories: intents are logged, the data hooks answer from fixtures. */
import type { Decorator } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { WIDGET_EVENT_TYPES, type WidgetEventParser } from "../widgetStateEvent";
import { DEFAULT_VIEW_ENV, ViewEnvContext, type RoomStateData, type RoomTimelineData, type ViewEnv } from "./env";
import { DEV_TOOLS_DATA, MOCKED_ROOM_DATA, MOCKED_ROOM_STATE, MOCKED_ROOM_TIMELINE, ROOM_DETAILS, ROOM_STATE, ROOM_TIMELINE, ROOMS } from "./fixtures";

const retry = (what: string) => () => console.info(`retry the ${what}`);
const TIMELINE: RoomTimelineData = { timeline: { status: "ready", value: ROOM_TIMELINE }, retry: retry("timeline") };
const STATE: RoomStateData = { state: { status: "ready", value: ROOM_STATE }, retry: retry("state") };
/** "Widget lab", the mocked room of the DevBackendView stories. */
const LAB_TIMELINE: RoomTimelineData = { timeline: { status: "ready", value: MOCKED_ROOM_TIMELINE }, retry: retry("timeline") };
const LAB_STATE: RoomStateData = { state: { status: "ready", value: MOCKED_ROOM_STATE }, retry: retry("state") };

/**
 * A stand-in for the driver's parser (stories load no wasm): every widget type with a string `url`
 * (and, MSC4411, a string `name` for `m.widget`) is a widget, absolute http(s) URLs are loaded, a
 * legacy widget through a fake compat wrapper. The URL check is coarser than the driver's.
 */
const STORY_WIDGET_EVENTS: WidgetEventParser = {
  resolve(event) {
    const { url, name } = event.content;
    const legacy = event.type === "im.vector.modular.widgets";
    if (typeof url !== "string" || !WIDGET_EVENT_TYPES.includes(event.type) || (!legacy && typeof name !== "string")) return undefined;
    const shown = typeof name === "string" && name ? name : event.state_key;
    const problem = STORY_WIDGET_EVENTS.urlProblem(url);
    if (problem) return { name: shown, problem };
    const embedded = legacy ? `https://wrapper.example/?legacy_widget_url=${encodeURIComponent(url)}` : url;
    return { name: shown, widget: { url: embedded, name: shown, legacy, usesWidgetApi: legacy || event.content.uses_widget_api === true } };
  },
  urlProblem: (url) => (URL.canParse(url) && /^https?:$/.test(new URL(url).protocol) ? undefined : "the URL is not an absolute http: or https: URL"),
};

export const STORY_ENV: ViewEnv = {
  ...DEFAULT_VIEW_ENV,
  useDevToolsData: () => DEV_TOOLS_DATA,
  useMockedRoomData: () => MOCKED_ROOM_DATA,
  useRoomDetails: () => ({ status: "ready", value: ROOM_DETAILS }),
  useRoomTimeline: (roomId) => (roomId === ROOMS.lab.id ? LAB_TIMELINE : TIMELINE),
  useRoomState: (roomId) => (roomId === ROOMS.lab.id ? LAB_STATE : STATE),
  widgetEvents: STORY_WIDGET_EVENTS,
};

/** Wrap a story to override parts of the environment, e.g. `<StoryEnv env={{ narrow: true }}>`. */
export function StoryEnv({ env, children }: { env?: Partial<ViewEnv>; children: ReactNode }) {
  return <ViewEnvContext.Provider value={{ ...STORY_ENV, ...env }}>{children}</ViewEnvContext.Provider>;
}

/** A stand-in for a widget iframe: what a `WidgetSlot` shows in a story. */
export function FakeWidget({ name = "Widget" }: { name?: string }) {
  return (
    <div className="w w-call" style={{ display: "grid", placeItems: "center" }} data-testid="fake-widget">
      <span style={{ opacity: 0.7 }}>{name} (widget content)</span>
    </div>
  );
}

/**
 * The stage of the side panel leaves: 348 wide with 12px padding, so the column is 324px wide.
 * `parameters.stageHeight`: the leaf's height (620). `parameters.fence`: the DevBackend background.
 */
export const SideStage: Decorator = (Story, context) => (
  <div className={`stage ${context.parameters.fence ? "fence" : ""}`} style={{ width: 348, height: (context.parameters.stageHeight as number | undefined) ?? 620 }}>
    <div className="sidecol">
      <Story />
    </div>
  </div>
);
