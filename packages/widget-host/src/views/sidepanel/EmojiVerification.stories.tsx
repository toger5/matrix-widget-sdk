import type { Meta, StoryObj } from "@storybook/react-vite";

import { SAS_EMOJI, verifyingAccount } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

/** Verifying with another device, inside the AccountView as in the leaves. */
const meta: Meta<typeof AccountView> = { title: "SidePanel/EmojiVerification", component: AccountView, decorators: [SideStage] };
export default meta;
type Story = StoryObj<typeof AccountView>;

// leaf sidepanel/verify-waiting
export const Waiting: Story = { args: verifyingAccount({ step: "waiting" }) };

// leaf sidepanel/verify-emoji
export const Compare: Story = { args: verifyingAccount({ step: "emoji", emoji: SAS_EMOJI, confirming: false }) };

// leaf sidepanel/verify-confirming
export const Confirming: Story = { args: verifyingAccount({ step: "emoji", emoji: SAS_EMOJI, confirming: true }) };
