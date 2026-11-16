import type { Meta, StoryObj } from "@storybook/react-vite";

import { SAS_EMOJI, verifyingAccount } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

/** Verifying with another device, inside the AccountView. While a step runs, the box replaces the device details and the menu; × cancels the verification. */
const meta: Meta<typeof AccountView> = { title: "SidePanel/EmojiVerification", component: AccountView, decorators: [SideStage], parameters: { size: [348, 620] } };
export default meta;
type Story = StoryObj<typeof AccountView>;

/** With another device: waiting for one to accept the request. The request goes to every other device of the account. */
// leaf sidepanel/verify-waiting
export const Waiting: Story = { args: verifyingAccount({ step: "waiting" }) };

/** With another device: comparing the 7 emoji. */
// leaf sidepanel/verify-emoji
export const Compare: Story = { args: verifyingAccount({ step: "emoji", emoji: SAS_EMOJI, confirming: false }) };

/** With another device: "They match" pressed, waiting for it to confirm. */
// leaf sidepanel/verify-confirming
export const Confirming: Story = { args: verifyingAccount({ step: "emoji", emoji: SAS_EMOJI, confirming: true }) };
