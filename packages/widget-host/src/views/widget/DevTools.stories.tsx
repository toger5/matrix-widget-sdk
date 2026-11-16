import type { Meta, StoryObj } from "@storybook/react-vite";

import { DEV_TOOLS_DATA, devToolsLayout, widgetVm } from "../fixtures";
import { FakeWidget, StoryEnv } from "../storyEnv";
import { WidgetView } from "./WidgetView";

/** The dev tools are part of the WidgetView (it puts them at the dock position), so the stories render the whole view. */
const meta: Meta<typeof WidgetView> = {
  title: "Widget/DevTools",
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

/** leaf devtools/bottom-panel (the bar without panels is in leaves devtools/bar-*) */
export const DockedBottom: Story = { args: { devTools: devToolsLayout({ dock: "bottom", size: { top: 250, side: 340 } }) } };

/** leaf devtools/two-panels */
export const TwoPanels: Story = {
  args: {
    devTools: devToolsLayout({
      panels: [
        { panel: "messages", share: 1 },
        { panel: "stats", share: 1 },
      ],
      size: { top: 250, side: 340 },
    }),
  },
};

/** leaf devtools/messages */
export const MessagesExpanded: Story = { args: { devTools: devToolsLayout({ size: { top: 420, side: 340 } }), initialExpandedMessage: "m4" } };

/** leaf devtools/stats, but docked right (compare the dock with leaf devtools/side-panels) */
export const DockedRightStats: Story = { args: { devTools: devToolsLayout({ dock: "right", panels: [{ panel: "stats", share: 1 }], size: { top: 250, side: 400 } }) } };

/** leaves devtools/driver and devtools/console, as in leaf devtools/fourth-panel */
export const DriverAndConsole: Story = {
  args: {
    devTools: devToolsLayout({
      panels: [
        { panel: "driver", share: 1 },
        { panel: "console", share: 1 },
      ],
      size: { top: 330, side: 340 },
    }),
  },
};
