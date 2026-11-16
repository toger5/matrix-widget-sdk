import type { Meta, StoryObj } from "@storybook/react-vite";

import { mainVm, overviewTab, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
import { RoomOverview } from "./RoomOverview";
import { DEV_SETTINGS, SETTINGS, SoloPanel } from "./storyFrame";

// The overview is the body of a native tab, so the stories show it inside its room panel.
const meta: Meta<typeof RoomOverview> = { title: "Rooms/RoomOverview", component: RoomOverview };
export default meta;
type Story = StoryObj<typeof RoomOverview>;

const panel = roomPanel("design", [widgetTab("design", "call"), overviewTab("design")], overviewTab("design").id);
const main = mainVm({ workspaces: { ada: workspace([panel]) }, widgets: { [widgetVm("design", "call").id]: widgetVm("design", "call") } });

// leaf overview/plain
export const Plain: Story = { render: () => <SoloPanel main={main} panel={panel} settings={SETTINGS} /> };

// leaf overview/devtools: the dashed dev card with "Copy to DevBackend"
export const DevTools: Story = { render: () => <SoloPanel main={main} panel={panel} settings={DEV_SETTINGS} /> };
