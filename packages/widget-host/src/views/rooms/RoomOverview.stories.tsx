import type { Meta, StoryObj } from "@storybook/react-vite";

import { mainVm, roomPanel, timelineTab, widgetTab, widgetVm, workspace } from "../fixtures";
import { RoomOverview } from "./RoomOverview";
import { DEV_SETTINGS, SETTINGS, SoloPanel } from "./storyFrame";

// The overview is what the room name tab shows, so the stories show it inside its room panel.
const meta: Meta<typeof RoomOverview> = { title: "Rooms/RoomOverview", component: RoomOverview };
export default meta;
type Story = StoryObj<typeof RoomOverview>;

// leaf overview/plain: no widget open, dev tools disabled
const empty = roomPanel("design", []);
export const Plain: Story = { render: () => <SoloPanel main={mainVm({ workspaces: { ada: workspace([empty]) }, widgets: {} })} panel={empty} settings={SETTINGS} /> };

// leaf overview/devtools: the call has a tab in this panel ("jump to tab"), so has the timeline ("Show timeline"); the dashed dev card with "Copy to DevBackend"
const withCall = roomPanel("design", [widgetTab("design", "call"), timelineTab("design")], null);
const call = widgetVm("design", "call");
export const DevTools: Story = { render: () => <SoloPanel main={mainVm({ workspaces: { ada: workspace([withCall]) }, widgets: { [call.id]: call } })} panel={withCall} settings={DEV_SETTINGS} /> };
