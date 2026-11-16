import type { Meta, StoryObj } from "@storybook/react-vite";

import type { RoomToolsViewModel } from "../../appViewModel";
import { ROOMS, roomToolsVm } from "../fixtures";
import { DevBackendView } from "./DevBackendView";

/** The State section inside the whole DevBackendView, as the leaves draw it. Its widget form is the `State` story of DevBackendView. */
const roomTools = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => roomToolsVm({ openSections: ["state"], ...o });

const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView/State",
  component: DevBackendView,
  args: { canLeave: true, roomId: ROOMS.lab.id },
  decorators: [
    (Story) => (
      <div className="sidecol" style={{ width: 324, height: 820 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof DevBackendView>;

/** leaf devbackend/state-element-call */
export const ElementCall: Story = { args: { roomTools: roomTools({ stateForm: "elementCall" }) } };

/** leaf devbackend/state-raw */
export const RawJson: Story = { args: { roomTools: roomTools({ stateForm: "raw" }) } };
