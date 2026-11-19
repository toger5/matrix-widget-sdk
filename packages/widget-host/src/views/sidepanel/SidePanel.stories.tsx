import type { Meta, StoryObj } from "@storybook/react-vite";

import { mainVm } from "../fixtures";
import { storySize } from "../storyEnv";
import { SidePanel } from "./SidePanel";

/**
 * The column next to the LeftBar: the AccountView, the Settings, the Room list or the Dev tools.
 * Its views have stories of their own; next to the RoomsArea (shifted, or overlaid in a narrow
 * window) it is in the `App/AppShell` stories.
 */
const meta: Meta<typeof SidePanel> = { title: "SidePanel/SidePanel", component: SidePanel };
export default meta;
type Story = StoryObj<typeof SidePanel>;

/**
 * The Room list: the room picker in the SidePanel (the recents of `mainVm`; Element Call has a tab).
 * The same content as an empty room panel; the tiles wrap to two columns. The body scrolls.
 */
export const RoomList: Story = {
  args: { settings: { devTools: false, devBackend: false, theme: "system" }, main: mainVm({ sidePanel: { view: "rooms", width: 324 } }) },
  parameters: { size: [348, 760] },
  // The stage of the side panel stories; the SidePanel is the column itself.
  render: (args, { parameters }) => {
    const [width, height] = storySize(parameters);
    return (
      <div className="stage" style={{ width, height }}>
        <SidePanel {...args} />
      </div>
    );
  },
};
