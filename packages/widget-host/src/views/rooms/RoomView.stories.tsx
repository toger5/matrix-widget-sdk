import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomPanelViewModel } from "../../appViewModel";
import { mainVm, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
import { RoomsArea } from "./RoomsArea";
import { RoomView } from "./RoomView";
import { AppFrame, HeadOnly, SETTINGS, SoloPanel, fakeWidget } from "./storyFrame";

// A RoomView is the content of a room panel, so the stories show it inside its panel.
const meta: Meta<typeof RoomView> = { title: "Rooms/RoomView", component: RoomView };
export default meta;
type Story = StoryObj<typeof RoomView>;

const withPanels = (panels: RoomPanelViewModel[], widgets = [widgetVm("design", "call"), widgetVm("design", "board")]): MainViewModel =>
  mainVm({ workspaces: { ada: workspace(panels) }, widgets: Object.fromEntries(widgets.map((w) => [w.id, w])) });

// leaf roomview/header: no widget tab, the room name is selected (the body, cut off here, is the RoomOverview)
const overviewPanel = roomPanel("rtc", []);
export const Overview: Story = { render: () => <HeadOnly main={withPanels([overviewPanel], [])} panel={overviewPanel} /> };

// leaf widgetview/plain: a widget tab is active, the body is the widget
const widgetPanel = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]);
export const WidgetOpen: Story = { render: () => <SoloPanel main={withPanels([widgetPanel])} panel={widgetPanel} /> };

// leaf roomview2/same: the same room in two panels; the right one shows its RoomOverview, where the widgets of the other panel also offer "move widget here"
const same = withPanels(
  [
    roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]),
    roomPanel("design", [widgetTab("design", "poll")], null, "panel-design-2"),
  ],
  [widgetVm("design", "call"), widgetVm("design", "board"), widgetVm("design", "poll")],
);
export const SameRoomTwice: Story = {
  render: () => (
    <AppFrame>
      <RoomsArea main={same} settings={SETTINGS} fullscreen={false} renderWidget={fakeWidget(same)} />
    </AppFrame>
  ),
};
