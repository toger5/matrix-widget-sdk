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
      intent: { type: "account/switch", accountId: "devBackend", confirmed: true },
    },
  },
};

// leaf roomtools/confirm (the modal): changing the configuration of a real room from the Dev tools
export const ConfirmDanger: Story = {
  args: {
    modal: {
      kind: "confirm",
      title: "Change the power levels of Design crit?",
      body: "This m.room.power_levels event is sent to the room as @ada:example.org and changes who may do what in it, for everyone. Some changes cannot be undone, for example lowering your own level.",
      confirmLabel: "Send the state event",
      danger: true,
      intent: { type: "roomTools/sendState", roomId: "!hGtVzqNmPa:example.org", event: { type: "m.room.power_levels", stateKey: "", content: {} }, confirmed: true },
    },
  },
};
