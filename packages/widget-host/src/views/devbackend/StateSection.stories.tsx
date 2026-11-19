import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { RoomToolsViewModel } from "../../appViewModel";
import { ROOMS, roomDevTools, roomToolsVm } from "../fixtures";
import { SideStage, fillIn, openSendForm } from "../storyEnv";
import { DevBackendView } from "./DevBackendView";

const roomTools = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => roomToolsVm({ layout: roomDevTools("left", ["state"]), ...o });

/** The State panel of the DevBackendView (only State open, its send form open), inside the whole view. Its test widget form is the `State` story of `SidePanel/DevBackendView`. */
const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView/State",
  component: DevBackendView,
  args: { canLeave: true, roomId: ROOMS.lab.id },
  decorators: [SideStage],
  parameters: { fence: true },
};
export default meta;
type Story = StoryObj<typeof DevBackendView>;

/** "Send state" open, the state explorer with `m.room.member` expanded and Bob's content shown, as in the `State` story of `SidePanel/DevBackendView`. */
const showBob = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const canvas = within(canvasElement);
  await openSendForm(canvasElement, "State");
  canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
  (await canvas.findByRole("button", { name: "State key @bob:dev.local of m.room.member" })).click();
};

/** State: send state with the widget form: any custom widget, of any widget event type. It starts empty. */
export const Widget: Story = { args: { roomTools: roomTools({ stateForm: "widget" }) }, parameters: { size: [348, 860] }, play: showBob };

/** State: the test widget form under the ID of a widget the room has (`call`): "Update widget" in the warning look instead of "Send". */
export const UpdateWidget: Story = {
  args: { roomTools: roomTools() },
  parameters: { size: [348, 860] },
  play: async (context) => {
    await showBob(context);
    fillIn(await within(context.canvasElement).findByLabelText("Widget ID"), "call");
  },
};

/** State: send state with the Element Call form (a legacy `m.call` widget, as Element Web describes its call). */
export const ElementCall: Story = { args: { roomTools: roomTools({ stateForm: "elementCall" }) }, parameters: { size: [348, 860] }, play: showBob };

/** State: send (delayed) state as raw JSON: type, state key, content. */
export const RawJson: Story = { args: { roomTools: roomTools({ stateForm: "raw" }) }, parameters: { size: [348, 860] }, play: showBob };

/** State: edit state. The editor of one state event (Bob's membership, changed to "leave"); saving sends a new state event. */
export const Edit: Story = {
  args: { roomTools: roomTools() },
  parameters: { size: [348, 860] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSendForm(canvasElement, "State");
    canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
    (await canvas.findByRole("button", { name: "Edit state event m.room.member @bob:dev.local" })).click();
    fillIn(await canvas.findByLabelText("Content of m.room.member @bob:dev.local (JSON)"), JSON.stringify({ membership: "leave", displayname: "Bob" }, null, 2));
  },
};
