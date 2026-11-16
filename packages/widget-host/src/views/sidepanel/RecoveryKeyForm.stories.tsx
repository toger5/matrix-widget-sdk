import type { Meta, StoryObj } from "@storybook/react-vite";

import { RECOVERY_KEY, verifyingAccount } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

/** Verifying with the recovery key, inside the AccountView. The field starts with the key of the fixtures. */
const meta: Meta<typeof AccountView> = { title: "SidePanel/RecoveryKeyForm", component: AccountView, decorators: [SideStage], parameters: { size: [348, 620] } };
export default meta;
type Story = StoryObj<typeof AccountView>;

/** Recovery key: entering it. A real text field: no autocomplete, no spell check. The key is never kept in the view model. */
// leaf sidepanel/verify-recovery-key
export const Entering: Story = { args: { ...verifyingAccount({ step: "recoveryKey", checking: false }), initialRecoveryKey: RECOVERY_KEY } };

/** Recovery key: checking it. */
// leaf sidepanel/verify-recovery-checking
export const Checking: Story = { args: { ...verifyingAccount({ step: "recoveryKey", checking: true }), initialRecoveryKey: RECOVERY_KEY } };

/** Recovery key: refused. The key stays in the field. The second line is the session's error. */
// leaf sidepanel/verify-recovery-wrong
export const Refused: Story = {
  args: { ...verifyingAccount({ step: "recoveryKey", checking: false, error: "The key does not open the secret storage of this account." }), initialRecoveryKey: RECOVERY_KEY },
};
