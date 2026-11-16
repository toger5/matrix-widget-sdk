import type { Meta, StoryObj } from "@storybook/react-vite";

import { verifyingAccount } from "../fixtures";
import { SideStage } from "../storyEnv";
import { AccountView } from "./AccountView";

/**
 * The "Verify this device" box of the AccountView, while this device is not verified, inside the
 * whole AccountView (taller than the other AccountView stories to show the whole panel; in a shorter
 * window its body scrolls).
 */
const meta: Meta<typeof AccountView> = { title: "SidePanel/DeviceVerification", component: AccountView, decorators: [SideStage], parameters: { size: [348, 700] } };
export default meta;
type Story = StoryObj<typeof AccountView>;

/** Device not verified: the "Verify this device" box. */
// leaf sidepanel/verify-start
export const Start: Story = { args: verifyingAccount() };

/** After a failure: the box again, with the reason. The reason is the session's error (cancelled, timed out) or, as here, that the emoji did not match. It takes the place of the explanation. */
// leaf sidepanel/verify-failed
export const Failed: Story = { args: verifyingAccount({ step: "failed", error: "The emoji did not match, so this device was not verified." }) };

/** Verified, until "Done". The details below already say "This device is verified". */
// leaf sidepanel/verify-done
export const Done: Story = { args: verifyingAccount({ step: "done" }) };
