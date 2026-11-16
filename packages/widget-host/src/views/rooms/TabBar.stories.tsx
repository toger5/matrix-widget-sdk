import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomPanelViewModel, WidgetInstanceViewModel } from "../../appViewModel";
import { devToolsLayout, mainVm, newTab, overviewTab, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
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

// leaf tabs/widget-active: WidgetTab active, WidgetTab and NativeTab inactive
const plain = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), overviewTab("design")]);
export const WidgetActive: Story = { render: () => <HeadOnly main={vm(plain, [widgetVm("design", "call"), widgetVm("design", "board")])} panel={plain} /> };

// leaf tabs/native-active: NativeTab active; dev tools enabled, the whiteboard's dev tools are open
const native = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), overviewTab("design")], overviewTab("design").id);
export const NativeActive: Story = {
  render: () => <HeadOnly main={vm(native, [widgetVm("design", "call"), widgetVm("design", "board")], [widgetVm("design", "board").id])} panel={native} settings={DEV_SETTINGS} />,
};

// leaf tabs/pinned: two always-on-screen widgets (pin icon), one of them active
const pinned = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), widgetTab("design", "poll"), overviewTab("design")]);
export const Pinned: Story = {
  render: () => (
    <HeadOnly
      main={vm(pinned, [widgetVm("design", "call", { alwaysOnScreen: true }), widgetVm("design", "board", { alwaysOnScreen: true }), widgetVm("design", "poll")])}
      panel={pinned}
    />
  ),
};

// leaf tabs/overflow: more tabs than fit; the bar scrolls and the "all tabs" button opens the menu
const many = roomPanel(
  "design",
  [widgetTab("design", "call"), widgetTab("design", "board"), widgetTab("design", "poll"), widgetTab("design", "notes"), overviewTab("design"), widgetTab("design", "timer"), newTab("design")],
  widgetTab("design", "poll").id,
);
export const Overflow: Story = {
  render: () => (
    <SoloPanel
      main={vm(many, [widgetVm("design", "call", { alwaysOnScreen: true }), widgetVm("design", "board"), widgetVm("design", "poll"), widgetVm("design", "notes"), widgetVm("design", "timer")])}
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
