import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomPanelViewModel } from "../../appViewModel";
import { mainVm, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
import { RoomView } from "./RoomView";
import { HeadOnly, SoloPanel } from "./storyFrame";

/** A RoomView is the content of a room panel (a tabbed container: the room name, then the tabs), so the stories show it inside its panel. Two of them side by side are `App/AppShell` stories. */
const meta: Meta<typeof RoomView> = { title: "Rooms/RoomView", component: RoomView };
export default meta;
type Story = StoryObj<typeof RoomView>;

const withPanels = (panels: RoomPanelViewModel[], widgets = [widgetVm("design", "call"), widgetVm("design", "board")]): MainViewModel =>
  mainVm({ workspaces: { ada: workspace(panels) }, widgets: Object.fromEntries(widgets.map((w) => [w.id, w])) });

const overviewPanel = roomPanel("rtc", []);
/**
 * Room name selected, no widget tab: the header with the name, the number of widgets and users.
 * The room name is the first tab. With no widget tab shown it is selected, and the body (cut off
 * here) is the RoomOverview. It has no close button.
 */
// leaf roomview/header
export const Overview: Story = { render: () => <HeadOnly main={withPanels([overviewPanel], [])} panel={overviewPanel} />, parameters: { size: [640, 72] } };

const widgetPanel = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]);
/** A widget tab is active: the body is the widget (its states are the `Widget/WidgetView` stories). */
export const WidgetOpen: Story = { render: () => <SoloPanel main={withPanels([widgetPanel])} panel={widgetPanel} />, parameters: { size: [900, 560] } };
