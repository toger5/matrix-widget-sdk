import type { Meta, StoryObj } from "@storybook/react-vite";

import { devToolsLayout, widgetVm } from "../fixtures";
import { InDesignPanel } from "../rooms/storyFrame";
import { WidgetView } from "./WidgetView";

/** The StatsPanel inside the WidgetView, in the room panel of "Design crit". The graph data of `DEV_TOOLS_DATA` ends with the current bucket. */
const meta: Meta<typeof WidgetView> = {
  title: "Widget/DevTools/Stats",
  component: WidgetView,
  args: { widget: widgetVm("design", "call") },
  render: (args) => (
    <InDesignPanel widget={args.widget} devTools={args.devTools}>
      <WidgetView {...args} />
    </InDesignPanel>
  ),
  parameters: { size: [1000, 640] },
};
export default meta;
type Story = StoryObj<typeof WidgetView>;

/**
 * WidgetDevToolStatsPanel: the total graph. The bar under the pointer (here the tenth from the
 * right) is outlined and its tooltip shows both directions. A number goes above its bar if it fits,
 * else inside it.
 */
// leaf devtools/stats
export const Total: Story = {
  args: { devTools: devToolsLayout({ panels: [{ panel: "stats", share: 1 }], size: { top: 250, side: 340 } }) },
  play: async ({ canvasElement }) => {
    // The size of the plot is measured after the first render.
    await new Promise((resolve) => setTimeout(resolve, 100));
    const bars = canvasElement.querySelectorAll<HTMLElement>(".plot-area .bar");
    const bar = bars[bars.length - 10];
    const box = bar?.getBoundingClientRect();
    if (box) bar.closest(".plot-area")?.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + box.width / 2, clientY: box.bottom - 2 }));
  },
};

/** WidgetDevToolStatsPanel: one direction in a narrow panel. "to widget" is selected. The header wraps; the panel shows as many 5 s bars as fit, numbers only where they fit. */
// leaf devtools/stats-direction
export const ToWidgetDockedRight: Story = {
  args: { devTools: devToolsLayout({ dock: "right", panels: [{ panel: "stats", share: 1 }], size: { top: 250, side: 340 } }), initialStatsSeries: "toWidget" },
};
