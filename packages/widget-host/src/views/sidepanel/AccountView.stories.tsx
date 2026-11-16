import type { Meta, StoryObj } from "@storybook/react-vite";

import type { AccountViewModel } from "../../appViewModel";
import { ACCOUNTS } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

/** The AccountView: the current account, its buttons, and the list to switch accounts (ending with "Add account"). */
const meta: Meta<typeof AccountView> = { title: "SidePanel/AccountView", component: AccountView, decorators: [SideStage], parameters: { size: [348, 620] } };
export default meta;
type Story = StoryObj<typeof AccountView>;

const suspended = (a: AccountViewModel): AccountViewModel => ({ ...a, status: "suspended" });

/** One account. */
export const OneAccount: Story = { args: { accounts: [ACCOUNTS.ada], activeAccountId: "ada" } };

/**
 * Several accounts, DevBackend enabled: the switch list at the bottom with the DevBackend, ending
 * with "Add account". Switching to the DevBackend activates it (confirmed if room panels are open).
 * The QA bot's restore failed: a marker in the switch list.
 */
export const SeveralAccounts: Story = { args: { accounts: [ACCOUNTS.ada, ACCOUNTS.work, ACCOUNTS.bot, ACCOUNTS.dev], activeAccountId: "ada" }, parameters: { size: [348, 680] } };

/** DevBackend mode: the full account list (the Matrix accounts are suspended while the DevBackend is active). */
export const DevBackendMode: Story = {
  args: { accounts: [suspended(ACCOUNTS.ada), suspended(ACCOUNTS.work), ACCOUNTS.bot, ACCOUNTS.dev], activeAccountId: ACCOUNTS.dev.id },
  parameters: { fence: true },
};

/** The active account could not be restored: "Try again" / "Log out" (finding `restore-failed-actions`). */
export const RestoreFailed: Story = { args: { accounts: [ACCOUNTS.bot, { ...ACCOUNTS.ada, status: "restoring" }], activeAccountId: "bot" } };
