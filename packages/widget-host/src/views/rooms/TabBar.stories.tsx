import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomPanelViewModel, WidgetInstanceViewModel } from "../../appViewModel";
import { devToolsLayout, mainVm, roomPanel, timelineTab, widgetTab, widgetVm, workspace } from "../fixtures";
import { DEV_SETTINGS, HeadOnly, SETTINGS, SoloPanel } from "./storyFrame";
import { TabBar } from "./TabBar";

// The tab bar is a part of the room panel's header, so the stories show the header of a panel.
const meta: Meta<typeof TabBar> = { title: "Rooms/TabBar", component: TabBar };
export default meta;
type Story = StoryObj<typeof TabBar>;

const vm = (panel: RoomPanelViewModel, widgets: WidgetInstanceViewModel[], devToolsOf: string[] = []): MainViewModel =>
  mainVm({
    workspaces: { ada: workspace([panel], { devTools: Object.fromEntries(devToolsOf.map((id) => [id, devToolsLayout()])) }) },
    widgets: Object.fromEntries(widgets.map((w) => [w.id, w])),
  });

// leaf tabs/widget-active: WidgetTab active, the other WidgetTab and the room name inactive
const plain = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]);
export const WidgetActive: Story = { render: () => <HeadOnly main={vm(plain, [widgetVm("design", "call"), widgetVm("design", "board")])} panel={plain} /> };

// leaf tabs/overview-active: the room name selected; dev tools enabled, the whiteboard's dev tools are open
const overview = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")], null);
export const OverviewActive: Story = {
  render: () => <HeadOnly main={vm(overview, [widgetVm("design", "call"), widgetVm("design", "board")], [widgetVm("design", "board").id])} panel={overview} settings={DEV_SETTINGS} />,
};

// leaf tabs/pinned: two always-on-screen widgets (pin icon), one of them active
const pinned = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), widgetTab("design", "poll")]);
export const Pinned: Story = {
  render: () => (
    <HeadOnly
      main={vm(pinned, [widgetVm("design", "call", { alwaysOnScreen: true }), widgetVm("design", "board", { alwaysOnScreen: true }), widgetVm("design", "poll")])}
      panel={pinned}
    />
  ),
};

// leaf tabs/timeline-active: the Timeline tab is active (dev tools enabled: ⋯ on the widget tabs only)
const timeline = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), timelineTab("design")], timelineTab("design").id);
export const TimelineActive: Story = {
  render: () => <HeadOnly main={vm(timeline, [widgetVm("design", "call"), widgetVm("design", "board")])} panel={timeline} settings={DEV_SETTINGS} />,
};

// leaf tabs/overflow: more tabs than fit; the widget tabs scroll and the "all tabs" button opens the menu
const MANY = ["call", "board", "poll", "notes", "timer", "retro", "stream"] as const;
const many = roomPanel("design", MANY.map((w) => widgetTab("design", w)), widgetTab("design", "poll").id);
export const Overflow: Story = {
  render: () => (
    <SoloPanel
      main={vm(many, MANY.map((w) => widgetVm("design", w, { alwaysOnScreen: w === "call" })))}
      panel={many}
      settings={SETTINGS}
    />
  ),
  // the leaf shows the menu open
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    canvasElement.querySelector<HTMLButtonElement>(".tab-all")?.click();
  },
};
