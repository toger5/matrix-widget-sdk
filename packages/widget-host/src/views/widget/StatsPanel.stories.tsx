import type { Meta, StoryObj } from "@storybook/react-vite";
import { waitFor } from "storybook/test";

import { devToolsLayout, widgetVm } from "../fixtures";
import { InDesignPanel } from "../rooms/storyFrame";
import { findElement } from "../storyEnv";
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
export const Total: Story = {
  args: { devTools: devToolsLayout({ panels: [{ panel: "stats", share: 1 }], size: { top: 250, side: 340 } }) },
  play: async ({ canvasElement }) => {
    // The plot holds as many 5 s bars as its measured width fits.
    const area = await findElement(canvasElement, ".plot-area");
    const bar = await waitFor(() => {
      const bars = area.querySelectorAll<HTMLElement>(".bar");
      if (bars.length < 10) throw new Error(`${bars.length} bars`);
      return bars[bars.length - 10];
    });
    const box = bar.getBoundingClientRect();
    area.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, clientX: box.left + box.width / 2, clientY: box.bottom - 2 }));
  },
};

/** WidgetDevToolStatsPanel: one direction in a narrow panel. "to widget" is selected. The header wraps; the panel shows as many 5 s bars as fit, numbers only where they fit. */
export const ToWidgetDockedRight: Story = {
  args: { devTools: devToolsLayout({ dock: "right", panels: [{ panel: "stats", share: 1 }], size: { top: 250, side: 340 } }), initialStatsSeries: "toWidget" },
};
