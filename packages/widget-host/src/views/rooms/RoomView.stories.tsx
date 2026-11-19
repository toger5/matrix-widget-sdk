import type { Meta, StoryObj } from "@storybook/react-vite";

import { mainVm, roomPanel, workspace } from "../fixtures";
import { RoomView } from "./RoomView";
import { HeadOnly } from "./storyFrame";

/** A RoomView is the content of a room panel (a tabbed container: the room name, then the tabs), so the stories show it inside its panel. With a widget tab active, and two side by side, they are `App/AppShell` stories. */
const meta: Meta<typeof RoomView> = { title: "Rooms/RoomView", component: RoomView };
export default meta;
type Story = StoryObj<typeof RoomView>;

const overviewPanel = roomPanel("rtc", []);
/**
 * Room name selected, no widget tab: the header with the name, the number of widgets and users.
 * The room name is the first tab. With no widget tab shown it is selected, and the body (cut off
 * here) is the RoomOverview. It has no close button.
 */
export const Overview: Story = {
  render: () => <HeadOnly main={mainVm({ workspaces: { ada: workspace([overviewPanel]) }, widgets: {} })} panel={overviewPanel} />,
  parameters: { size: [640, 72] },
};
