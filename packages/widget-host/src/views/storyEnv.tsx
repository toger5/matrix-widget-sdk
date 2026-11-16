/** The `ViewEnv` of the stories: intents are logged, the data hooks answer from fixtures. */
import type { Decorator } from "@storybook/react-vite";
import type { ReactNode } from "react";

import { DEFAULT_VIEW_ENV, ViewEnvContext, type RoomTimelineData, type ViewEnv } from "./env";
import { DEV_TOOLS_DATA, MOCKED_ROOM_DATA, ROOM_DETAILS, ROOM_TIMELINE } from "./fixtures";

const TIMELINE: RoomTimelineData = { timeline: { status: "ready", value: ROOM_TIMELINE }, retry: () => console.info("retry the timeline") };

export const STORY_ENV: ViewEnv = {
  ...DEFAULT_VIEW_ENV,
  useDevToolsData: () => DEV_TOOLS_DATA,
  useMockedRoomData: () => MOCKED_ROOM_DATA,
  useRoomDetails: () => ({ status: "ready", value: ROOM_DETAILS }),
  useRoomTimeline: () => TIMELINE,
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
