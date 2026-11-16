import type { Meta, StoryObj } from "@storybook/react-vite";

import { DEV_TOOLS_DATA, devToolsLayout, widgetVm } from "../fixtures";
import { FakeWidget, StoryEnv } from "../storyEnv";
import { WidgetView } from "./WidgetView";

/** The StatsPanel inside the WidgetView, as in its leaves. The graph data of `DEV_TOOLS_DATA` ends with the current bucket. */
const meta: Meta<typeof WidgetView> = {
  title: "Widget/DevTools/Stats",
  component: WidgetView,
  args: { widget: widgetVm("design", "call"), standIn: <FakeWidget name="Element Call" /> },
  decorators: [
    (Story) => (
      // The run duration counts from `runningSince`: keep it at the mockup's "3 m 12 s" instead of the fixture's fixed date.
      <StoryEnv env={{ useDevToolsData: () => STORY_DATA }}>
        <div style={{ width: "100%", height: "100vh", minHeight: 300, display: "flex" }}>
          <Story />
        </div>
      </StoryEnv>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof WidgetView>;

const STORY_DATA = { ...DEV_TOOLS_DATA, stats: { ...DEV_TOOLS_DATA.stats, runningSince: Date.now() - 192_000 } };

/** leaf devtools/stats (the leaf also shows the hover tooltip) */
export const Total: Story = { args: { devTools: devToolsLayout({ panels: [{ panel: "stats", share: 1 }], size: { top: 250, side: 340 } }) } };

/** leaf devtools/stats-direction */
export const ToWidgetDockedRight: Story = {
  args: { devTools: devToolsLayout({ dock: "right", panels: [{ panel: "stats", share: 1 }], size: { top: 250, side: 340 } }), initialStatsSeries: "toWidget" },
};
