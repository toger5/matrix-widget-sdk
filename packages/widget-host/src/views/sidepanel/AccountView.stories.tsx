import type { Decorator, Meta, StoryObj } from "@storybook/react-vite";

import type { AccountViewModel } from "../../appViewModel";
import { ACCOUNTS } from "../fixtures";
import { StoryEnv } from "../storyEnv";
import { AccountView } from "./AccountView";

/** The stage of the side panel leaves: 348x620 with 12px padding, so the column is 324px wide. `parameters.fence`: the DevBackend background. */
const stage: Decorator = (Story, context) => (
  <div className={`stage ${context.parameters.fence ? "fence" : ""}`} style={{ width: 348, height: 620 }}>
    <div className="sidecol">
      <Story />
    </div>
  </div>
);

const meta: Meta<typeof AccountView> = { title: "SidePanel/AccountView", component: AccountView, decorators: [stage] };
export default meta;
type Story = StoryObj<typeof AccountView>;

const suspended = (a: AccountViewModel): AccountViewModel => ({ ...a, status: "suspended" });

// leaf sidepanel/account-one
export const OneAccount: Story = { args: { accounts: [ACCOUNTS.ada], activeAccountId: "ada" } };

// leaf sidepanel/account-several (the QA bot's restore failed: marker in the switch list)
export const SeveralAccounts: Story = { args: { accounts: [ACCOUNTS.ada, ACCOUNTS.work, ACCOUNTS.bot], activeAccountId: "ada" } };

// leaf sidepanel/account-dev (the Matrix accounts are suspended while the DevBackend is active)
export const DevBackendMode: Story = {
  args: { accounts: [suspended(ACCOUNTS.ada), suspended(ACCOUNTS.work), ACCOUNTS.bot, ACCOUNTS.dev], activeAccountId: ACCOUNTS.dev.id },
  parameters: { fence: true },
};

// No leaf: the active account could not be restored ("Try again" / "Log out").
export const RestoreFailed: Story = { args: { accounts: [ACCOUNTS.bot, { ...ACCOUNTS.ada, status: "restoring" }], activeAccountId: "bot" } };

// No leaf: an unverified device shows the verification flow of `ViewEnv.renderVerification` below the account card.
export const Unverified: Story = {
  args: { accounts: [{ ...ACCOUNTS.ada, verified: false }], activeAccountId: "ada" },
  decorators: [
    (Story) => (
      <StoryEnv env={{ renderVerification: (id) => <div className="hint" style={{ padding: 10, border: "1px dashed var(--border-strong)", borderRadius: 8 }}>Verification flow of “{id}” (self-contained view)</div> }}>
        <Story />
      </StoryEnv>
    ),
  ],
};
