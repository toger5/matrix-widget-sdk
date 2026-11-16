import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomToolsViewModel } from "../../appViewModel";
import { ROOMS, roomToolsVm } from "../fixtures";
import { DevBackendView } from "./DevBackendView";

/** The tool boxes below the room box, inside the whole DevBackendView, as the leaves draw them. The collapsed tools are the `ToolsCollapsed` story of DevBackendView. */
const roomTools = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => roomToolsVm({ openSections: [], ...o });

const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView/Tools",
  component: DevBackendView,
  args: { canLeave: true, roomId: ROOMS.lab.id },
  // The height of the leaf minus its stage padding; `parameters.height` overrides it.
  decorators: [
    (Story, { parameters }) => (
      <div className="sidecol" style={{ width: 324, height: (parameters.height as number | undefined) ?? 826 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof DevBackendView>;

/** leaf devbackend/behavior: the Client Backend Tool with "Widget host behavior" open */
export const Behavior: Story = {
  args: { roomTools: roomTools({ openSections: ["widgetHostBehavior"], tools: { open: "client", heightShare: 0.5 } }) },
};

/** leaf devbackend/todevice: the Client Backend Tool dragged higher, "To-device messages" open */
export const ToDevice: Story = {
  args: { roomTools: roomTools({ openSections: ["toDevice"], tools: { open: "client", heightShare: 0.73 } }) },
  parameters: { height: 876 },
};

/** leaf devbackend/media-open */
export const Media: Story = {
  args: { roomTools: roomTools({ tools: { open: "media", heightShare: 0.5 } }) },
};
