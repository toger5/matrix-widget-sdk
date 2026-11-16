import type { Meta, StoryObj } from "@storybook/react-vite";

import { SideStage } from "../storyEnv";
import { SettingsView } from "./SettingsView";

const meta: Meta<typeof SettingsView> = { title: "SidePanel/SettingsView", component: SettingsView, decorators: [SideStage], parameters: { stageHeight: 420 } };
export default meta;
type Story = StoryObj<typeof SettingsView>;

// leaf sidepanel/settings-off
export const DevToolsOff: Story = { args: { settings: { devTools: false, theme: "system" }, devBackendActive: false } };

// leaf sidepanel/settings-on
export const DevToolsOn: Story = { args: { settings: { devTools: true, theme: "system" }, devBackendActive: false } };

// No leaf: the toggle is locked while the DevBackend is active.
export const DevBackendActive: Story = { args: { settings: { devTools: true, theme: "dark" }, devBackendActive: true } };
