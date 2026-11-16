import type { Meta, StoryObj } from "@storybook/react-vite";

import { SideStage } from "../storyEnv";
import { SettingsView } from "./SettingsView";

const meta: Meta<typeof SettingsView> = { title: "SidePanel/SettingsView", component: SettingsView, decorators: [SideStage], parameters: { stageHeight: 420 } };
export default meta;
type Story = StoryObj<typeof SettingsView>;

// leaf sidepanel/settings-off
export const BothOff: Story = { args: { settings: { devTools: false, devBackend: false, theme: "system" }, devBackendActive: false } };

// leaf sidepanel/settings-on
export const BothOn: Story = { args: { settings: { devTools: true, devBackend: true, theme: "system" }, devBackendActive: false }, parameters: { stageHeight: 620 } };

// leaf sidepanel/settings-devbackend: the DevBackend switch is locked while it is active
export const DevBackendActive: Story = {
  args: { settings: { devTools: false, devBackend: true, theme: "system" }, devBackendActive: true },
  parameters: { stageHeight: 500, fence: true },
};
