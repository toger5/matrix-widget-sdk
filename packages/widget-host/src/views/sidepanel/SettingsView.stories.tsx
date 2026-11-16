import type { Meta, StoryObj } from "@storybook/react-vite";

import { SideStage } from "../storyEnv";
import { SettingsView } from "./SettingsView";

/** The Settings: two independent developer switches; what one enables is listed under it while it is on. */
const meta: Meta<typeof SettingsView> = { title: "SidePanel/SettingsView", component: SettingsView, decorators: [SideStage], parameters: { size: [348, 420] } };
export default meta;
type Story = StoryObj<typeof SettingsView>;

/** Both switches off. */
export const BothOff: Story = { args: { settings: { devTools: false, devBackend: false, theme: "system" }, devBackendActive: false } };

/** Both switches on. The two switches are independent: each lists what it shows while it is on. */
export const BothOn: Story = { args: { settings: { devTools: true, devBackend: true, theme: "system" }, devBackendActive: false }, parameters: { size: [348, 620] } };

/**
 * DevBackend active: its switch is locked, dev tools off. Dev tools can be off while the DevBackend
 * is active: no ⋯ button on the widget tabs, the fence and the badge stay.
 */
export const DevBackendActive: Story = {
  args: { settings: { devTools: false, devBackend: true, theme: "system" }, devBackendActive: true },
  parameters: { size: [348, 500], fence: true },
};
