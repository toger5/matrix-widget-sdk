import type { Meta, StoryObj } from "@storybook/react-vite";

import type { AccountViewModel } from "../../appViewModel";
import { ACCOUNTS } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

const meta: Meta<typeof AccountView> = { title: "SidePanel/AccountView", component: AccountView, decorators: [SideStage] };
export default meta;
type Story = StoryObj<typeof AccountView>;

const suspended = (a: AccountViewModel): AccountViewModel => ({ ...a, status: "suspended" });

// leaf sidepanel/account-one
export const OneAccount: Story = { args: { accounts: [ACCOUNTS.ada], activeAccountId: "ada" } };

// leaf sidepanel/account-several (the QA bot's restore failed: marker in the switch list; the DevBackend is enabled, so it is listed)
export const SeveralAccounts: Story = { args: { accounts: [ACCOUNTS.ada, ACCOUNTS.work, ACCOUNTS.bot, ACCOUNTS.dev], activeAccountId: "ada" }, parameters: { stageHeight: 680 } };

// leaf sidepanel/account-dev (the Matrix accounts are suspended while the DevBackend is active)
export const DevBackendMode: Story = {
  args: { accounts: [suspended(ACCOUNTS.ada), suspended(ACCOUNTS.work), ACCOUNTS.bot, ACCOUNTS.dev], activeAccountId: ACCOUNTS.dev.id },
  parameters: { fence: true },
};

// No leaf: the active account could not be restored ("Try again" / "Log out").
export const RestoreFailed: Story = { args: { accounts: [ACCOUNTS.bot, { ...ACCOUNTS.ada, status: "restoring" }], activeAccountId: "bot" } };
