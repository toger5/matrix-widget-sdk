import type { Meta, StoryObj } from "@storybook/react-vite";

import { ACCOUNTS } from "../fixtures";
import { LeftBar } from "./LeftBar";

/** The `.stage` of the component leaves: the bar sits directly on the app background. */
const meta: Meta<typeof LeftBar> = {
  title: "App/LeftBar",
  component: LeftBar,
  args: { leftBar: { collapsed: false, expandButtonVisible: false }, devBackend: false, devBackendActive: false, account: ACCOUNTS.ada },
  render: (args) => (
    <div className={`stage ${args.devBackendActive ? "fence" : ""}`} style={{ width: args.devBackendActive ? 230 : 68, height: 620 }}>
      <LeftBar {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof LeftBar>;

export const Expanded: Story = {}; // leaf leftbar/expanded
export const DevBackendEnabled: Story = { args: { devBackend: true, sidePanelView: "settings" } }; // leaf leftbar/devtools (plus the Settings open)
// leaves leftbar/devbackend, leftbar/devbackend-hover (hover or focus the cone for the tooltip)
export const DevBackendActive: Story = { args: { devBackend: true, devBackendActive: true, sidePanelView: "devBackend", account: ACCOUNTS.dev } };
