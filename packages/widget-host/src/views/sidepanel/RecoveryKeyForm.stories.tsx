import type { Meta, StoryObj } from "@storybook/react-vite";

import { RECOVERY_KEY, verifyingAccount } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

/** Verifying with the recovery key, inside the AccountView as in the leaves. The field starts with the mockups' key. */
const meta: Meta<typeof AccountView> = { title: "SidePanel/RecoveryKeyForm", component: AccountView, decorators: [SideStage] };
export default meta;
type Story = StoryObj<typeof AccountView>;

// leaf sidepanel/verify-recovery-key
export const Entering: Story = { args: { ...verifyingAccount({ step: "recoveryKey", checking: false }), initialRecoveryKey: RECOVERY_KEY } };

// leaf sidepanel/verify-recovery-checking
export const Checking: Story = { args: { ...verifyingAccount({ step: "recoveryKey", checking: true }), initialRecoveryKey: RECOVERY_KEY } };

// leaf sidepanel/verify-recovery-wrong
export const Refused: Story = {
  args: { ...verifyingAccount({ step: "recoveryKey", checking: false, error: "The key does not open the secret storage of this account." }), initialRecoveryKey: RECOVERY_KEY },
};
