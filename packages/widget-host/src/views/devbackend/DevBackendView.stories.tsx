import type { Meta, StoryObj } from "@storybook/react-vite";

import type { DevBackendViewModel } from "../../appViewModel";
import { EMPTY_MOCKED_ROOM_DATA } from "../env";
import { devMainVm } from "../fixtures";
import { StoryEnv } from "../storyEnv";
import { DevBackendView } from "./DevBackendView";

const devBackend = (o: Partial<DevBackendViewModel> = {}): DevBackendViewModel => ({ ...devMainVm().devBackend!, ...o });

const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView",
  component: DevBackendView,
  args: { canLeave: true },
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

const click = (root: HTMLElement, selector: string, text: string) => Array.from(root.querySelectorAll<HTMLElement>(selector)).find((el) => el.textContent?.includes(text))?.click();
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

/** leaf devbackend/none (after "skip login": no leave link) */
export const NoRooms: Story = {
  args: { devBackend: devBackend({ selectedRoomId: undefined, openSections: [] }), canLeave: false },
  render: (args) => (
    <StoryEnv env={{ useMockedRoomData: () => EMPTY_MOCKED_ROOM_DATA }}>
      <DevBackendView {...args} />
    </StoryEnv>
  ),
};

/** leaf devbackend/dropdown */
export const RoomDropdown: Story = {
  args: { devBackend: devBackend({ openSections: [] }) },
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>(".room-pick")?.click();
  },
};

/** leaf devbackend/state: `m.room.member` expanded, the content of one member shown */
export const State: Story = {
  args: { devBackend: devBackend({ openSections: ["state"] }) },
  play: async ({ canvasElement }) => {
    click(canvasElement, ".tree-row.lvl0", "m.room.member");
    await nextFrame();
    click(canvasElement, ".tree-key", "@bob:dev.local");
  },
};

/** leaves devbackend/timeline-raw and devbackend/timeline-delayed (the "Scheduled" list) */
export const TimelineRawJson: Story = {
  args: { devBackend: devBackend({ openSections: ["timeline"], sendForm: "raw" }) },
};

/** leaf devbackend/media-open */
export const MediaOpen: Story = {
  args: { devBackend: devBackend({ openSections: ["widgetHostBehavior"], media: { open: true, heightShare: 0.4 } }) },
};
