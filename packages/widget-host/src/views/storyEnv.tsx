/** The `ViewEnv` of the stories: intents are logged, the data hooks answer from fixtures. */
import type { ReactNode } from "react";

import { DEFAULT_VIEW_ENV, ViewEnvContext, type ViewEnv } from "./env";
import { DEV_TOOLS_DATA, MOCKED_ROOM_DATA, ROOM_DETAILS } from "./fixtures";

export const STORY_ENV: ViewEnv = {
  ...DEFAULT_VIEW_ENV,
  useDevToolsData: () => DEV_TOOLS_DATA,
  useMockedRoomData: () => MOCKED_ROOM_DATA,
  useRoomDetails: () => ({ status: "ready", value: ROOM_DETAILS }),
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
