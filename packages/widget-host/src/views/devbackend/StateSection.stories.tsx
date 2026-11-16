import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { RoomToolsViewModel } from "../../appViewModel";
import { ROOMS, roomToolsVm } from "../fixtures";
import { SideStage, fillIn } from "../storyEnv";
import { DevBackendView } from "./DevBackendView";

const roomTools = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => roomToolsVm({ openSections: ["state"], ...o });

/** The State section of the DevBackendView, inside the whole view. Its widget form is the `State` story of `SidePanel/DevBackendView`. */
const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView/State",
  component: DevBackendView,
  args: { canLeave: true, roomId: ROOMS.lab.id },
  decorators: [SideStage],
  parameters: { fence: true },
};
export default meta;
type Story = StoryObj<typeof DevBackendView>;

/** The state explorer with `m.room.member` expanded and Bob's content shown, as in the `State` story of `SidePanel/DevBackendView`. */
const showBob = async ({ canvasElement }: { canvasElement: HTMLElement }) => {
  const canvas = within(canvasElement);
  canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
  (await canvas.findByRole("button", { name: "State key @bob:dev.local of m.room.member" })).click();
};

/** State: send state with the Element Call form (a legacy `m.call` widget, as Element Web describes its call). */
// leaf devbackend/state-element-call
export const ElementCall: Story = { args: { roomTools: roomTools({ stateForm: "elementCall" }) }, parameters: { size: [348, 1120] }, play: showBob };

/** State: send (delayed) state as raw JSON: type, state key, content. */
// leaf devbackend/state-raw
export const RawJson: Story = { args: { roomTools: roomTools({ stateForm: "raw" }) }, parameters: { size: [348, 1090] }, play: showBob };

/** State: edit state. The editor of one state event (Bob's membership, changed to "leave"); saving sends a new state event. */
// leaf devbackend/state-edit
export const Edit: Story = {
  args: { roomTools: roomTools() },
  parameters: { size: [348, 1240] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
    (await canvas.findByRole("button", { name: "Edit state event m.room.member @bob:dev.local" })).click();
    fillIn(await canvas.findByLabelText("Content of m.room.member @bob:dev.local (JSON)"), JSON.stringify({ membership: "leave", displayname: "Bob" }, null, 2));
  },
};
