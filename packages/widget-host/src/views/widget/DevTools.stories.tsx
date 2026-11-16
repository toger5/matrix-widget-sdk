import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DevToolPanel, WidgetDevToolsLayout } from "../../appViewModel";
import { devToolsLayout, widgetVm } from "../fixtures";
import { InDesignPanel } from "../rooms/storyFrame";
import { WidgetView } from "./WidgetView";

/**
 * The WidgetDevToolBar of a widget with its panels. The dev tools are part of the WidgetView (it
 * puts them at the dock position), so the stories render the whole view, in the room panel of
 * "Design crit". The bar is at the outer edge, the panels between it and the widget. The stats
 * panel has its own file.
 */
const meta: Meta<typeof WidgetView> = {
  title: "Widget/DevTools",
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

/** The dev tools docked at `dock` with `panels` open, oldest first, `size` px high (docked top or bottom) or wide (left or right). */
const layout = (dock: WidgetDevToolsLayout["dock"], panels: DevToolPanel[], size?: number): WidgetDevToolsLayout =>
  devToolsLayout({
    dock,
    panels: panels.map((panel) => ({ panel, share: 1 })),
    size: { top: dock === "top" || dock === "bottom" ? (size ?? 250) : 250, side: dock === "left" || dock === "right" ? (size ?? 340) : 340 },
  });

/** Bar only, docked top (the default). */
export const BarTop: Story = { args: { devTools: layout("top", []) }, parameters: { size: [900, 560] } };

/** Bar only, docked bottom. */
export const BarBottom: Story = { args: { devTools: layout("bottom", []) }, parameters: { size: [900, 560] } };

/** Bar only, docked left. The vertical bar needs about 600px for its labels; a shorter one shows icons only (see `SidePanels`). */
export const BarLeft: Story = { args: { devTools: layout("left", []) }, parameters: { size: [900, 680] } };

/** Bar only, docked right. */
export const BarRight: Story = { args: { devTools: layout("right", []) }, parameters: { size: [900, 680] } };

/** One panel open (full width): the messages. */
export const OnePanel: Story = { args: { devTools: layout("top", ["messages"]) } };

/** Two panels next to each other. */
export const TwoPanels: Story = { args: { devTools: layout("top", ["messages", "stats"]) } };

/** Three panels next to each other: the maximum. */
export const ThreePanels: Story = { args: { devTools: layout("top", ["messages", "stats", "driver"], 290) }, parameters: { size: [1280, 680] } };

/** Fourth panel opened: the oldest one closes. Messages, Stats and Driver were open; pressing Console closed Messages, the oldest. Three panels are the maximum. */
export const FourthPanel: Story = { args: { devTools: layout("top", ["stats", "driver", "console"], 290) }, parameters: { size: [1280, 680] } };

/** Docked right with two panels: they stack. At this height the vertical bar shows icons only. */
export const SidePanels: Story = { args: { devTools: layout("right", ["messages", "driver"], 400) } };

/** Docked bottom with one panel: the bar stays at the edge, the panels sit between the widget and the bar, the separator above them (as when docked right). */
export const DockedBottom: Story = { args: { devTools: layout("bottom", ["messages"]) } };

/** WidgetDevToolMessagesPanel: the list, one message expanded. */
export const MessagesExpanded: Story = { args: { devTools: layout("top", ["messages"], 420), initialExpandedMessage: "m4" }, parameters: { size: [1000, 720] } };

/** WidgetDevToolDriverPanel: the capabilities (approved, auto-approved, denied; the one-use one marked "once") and the mocked driver actions. */
export const Driver: Story = { args: { devTools: layout("top", ["driver"], 356) }, parameters: { size: [1000, 720] } };

/** WidgetDevToolConsolePanel: the log about the widget. */
export const Console: Story = { args: { devTools: layout("top", ["console"]) } };
