import type { Meta, StoryObj } from "@storybook/react-vite";

import { CHANGE_POWER_LEVELS, SWITCH_TO_DEV_BACKEND, mainVm } from "../fixtures";
import { Modal } from "./Modal";

/** The modals on their own, on the app background. On the screen they are the `App/AppShell` stories `InfoModal`, `Confirm`, `RoomToolsConfirm` and `RoomPickerModal`. */
const meta: Meta<typeof Modal> = {
  title: "App/Modal",
  component: Modal,
  args: { main: mainVm() },
  render: (args) => (
    <div className="app" style={{ height: "100vh" }}>
      <Modal {...args} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof Modal>;

/** The app info modal. */
export const Info: Story = { args: { modal: { kind: "appInfo" } } };

/** The confirmation of an action that loses state: activating the DevBackend. */
export const Confirm: Story = { args: { modal: SWITCH_TO_DEV_BACKEND } };

/** A confirmation with an alert icon and a danger button: changing the configuration of a real room from the Dev tools. */
export const ConfirmDanger: Story = { args: { modal: CHANGE_POWER_LEVELS } };

/** The room picker dialog (Ctrl+K): the content of an empty room panel; a pick opens the room in a new panel. */
export const RoomPicker: Story = { args: { modal: { kind: "roomPicker" } } };
