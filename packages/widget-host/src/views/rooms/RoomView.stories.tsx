import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomPanelViewModel } from "../../appViewModel";
import { mainVm, newTab, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
import { RoomsArea } from "./RoomsArea";
import { RoomView } from "./RoomView";
import { AppFrame, SETTINGS, SoloPanel, fakeWidget } from "./storyFrame";

// A RoomView is the content of a room panel, so the stories show it inside its panel.
const meta: Meta<typeof RoomView> = { title: "Rooms/RoomView", component: RoomView };
export default meta;
type Story = StoryObj<typeof RoomView>;

const withPanels = (panels: RoomPanelViewModel[], widgets = [widgetVm("design", "call"), widgetVm("design", "board")]): MainViewModel =>
  mainVm({ workspaces: { ada: workspace(panels) }, widgets: Object.fromEntries(widgets.map((w) => [w.id, w])) });

// leaf roomview/tiles: no widget open
const tilesPanel = roomPanel("design", []);
export const Tiles: Story = { render: () => <SoloPanel main={withPanels([tilesPanel], [])} panel={tilesPanel} /> };

// leaf roomview/new-tab: the opened widgets are grayed out with "jump to tab"
const newTabPanel = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), newTab("design")], newTab("design").id);
export const NewTab: Story = { render: () => <SoloPanel main={withPanels([newTabPanel])} panel={newTabPanel} /> };

// leaf widgetview/plain: a widget tab is active, the body is the widget
const widgetPanel = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]);
export const WidgetOpen: Story = { render: () => <SoloPanel main={withPanels([widgetPanel])} panel={widgetPanel} /> };

// leaf roomview2/same: the same room in two panels; widgets of the other panel also offer "move widget here"
const same = withPanels(
  [
    roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]),
    roomPanel("design", [widgetTab("design", "poll"), newTab("design")], newTab("design").id, "panel-design-2"),
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
