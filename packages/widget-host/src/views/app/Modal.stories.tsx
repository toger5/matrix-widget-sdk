import type { Meta, StoryObj } from "@storybook/react-vite";

import { Modal } from "./Modal";

const meta: Meta<typeof Modal> = {
  title: "App/Modal",
  component: Modal,
  render: (args) => (
    <div className="app" style={{ height: "100vh" }}>
      <Modal {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof Modal>;

export const Info: Story = { args: { modal: { kind: "appInfo" } } }; // leaf app/info-modal

// leaf app/confirm
export const Confirm: Story = {
  args: {
    modal: {
      kind: "confirm",
      title: "Switch to the DevBackend?",
      body: "Your 2 room panels are closed and their widgets stop. They are opened again when you switch back to Ada Okafor.",
      confirmLabel: "Switch to the DevBackend",
      danger: false,
      intent: { type: "devBackend/toggle" },
    },
  },
};

// No leaf: a confirmation of an action that cannot be undone.
export const ConfirmDanger: Story = {
  args: {
    modal: { kind: "confirm", title: "Log out Ada Okafor?", body: "The remembered capabilities of all widgets are forgotten.", confirmLabel: "Log out", danger: true, intent: { type: "account/logout", accountId: "ada" } },
  },
};
