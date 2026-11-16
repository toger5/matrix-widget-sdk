import type { Meta, StoryObj } from "@storybook/react-vite";

import { verifyingAccount } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

/** The "Verify this device" box, inside the AccountView as in the leaves (348×700: the whole panel). */
const meta: Meta<typeof AccountView> = { title: "SidePanel/DeviceVerification", component: AccountView, decorators: [SideStage], parameters: { stageHeight: 700 } };
export default meta;
type Story = StoryObj<typeof AccountView>;

// leaf sidepanel/verify-start
export const Start: Story = { args: verifyingAccount() };

// leaf sidepanel/verify-failed (the reason is the controller's text for "They don't match")
export const Failed: Story = { args: verifyingAccount({ step: "failed", error: "The emoji did not match, so this device was not verified." }) };

// leaf sidepanel/verify-done
export const Done: Story = { args: verifyingAccount({ step: "done" }) };
