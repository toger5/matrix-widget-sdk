import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import type { RoomToolsViewModel } from "../../appViewModel";
import { EMPTY_MOCKED_ROOM_DATA } from "../env";
import { ROOMS, roomToolsVm } from "../fixtures";
import { SideStage, StoryEnv, fillIn, findElement } from "../storyEnv";
import { DevBackendView } from "./DevBackendView";

const roomTools = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => roomToolsVm(o);

/**
 * The Dev tools while the DevBackend is active (the DevBackendView): one page per mocked room in a
 * room box with a dropdown, the tool boxes below it, "Leave DevBackend" at the bottom. On the
 * construction fence. The State section is `SidePanel/DevBackendView/State`, the open tools are
 * `SidePanel/DevBackendView/Tools`.
 */
const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView",
  component: DevBackendView,
  args: { canLeave: true, roomId: ROOMS.lab.id },
  decorators: [SideStage],
  parameters: { size: [348, 520], fence: true },
};
export default meta;
type Story = StoryObj<typeof DevBackendView>;

/** The message form filled in as Bob (`@bob:dev.local`), as the timeline stories show it. */
const fillMessage = (canvasElement: HTMLElement) => {
  const canvas = within(canvasElement);
  fillIn(canvas.getByLabelText("Sender"), "@bob:dev.local");
  fillIn(canvas.getByLabelText("Body"), "Can you hear me?");
};

/** No rooms yet (after "skip login": no leave link). */
export const NoRooms: Story = {
  args: { roomTools: roomTools({ openSections: [] }), roomId: undefined, canLeave: false },
  render: (args) => (
    <StoryEnv env={{ useMockedRoomData: () => EMPTY_MOCKED_ROOM_DATA }}>
      <DevBackendView {...args} />
    </StoryEnv>
  ),
};

/** Room dropdown open: the mocked rooms and "Add room". */
export const RoomDropdown: Story = {
  args: { roomTools: roomTools({ openSections: [] }) },
  play: async ({ canvasElement }) => (await findElement(canvasElement, ".room-pick")).click(),
};

/** State: the shortcuts, send state with the widget form, the state explorer (`m.room.member` expanded, the content of one member shown). */
export const State: Story = {
  args: { roomTools: roomTools({ openSections: ["state"] }) },
  parameters: { size: [348, 1150] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
    (await canvas.findByRole("button", { name: "State key @bob:dev.local of m.room.member" })).click();
  },
};

/** Timeline: send event with a predefined form (a message), the event list. */
export const Timeline: Story = {
  args: { roomTools: roomTools({ openSections: ["timeline"] }) },
  parameters: { size: [348, 840] },
  play: ({ canvasElement }) => fillMessage(canvasElement),
};

/** Timeline: send an event as raw JSON (`type`, `sender`, `content` in one editor). */
export const TimelineRawJson: Story = {
  args: { roomTools: roomTools({ openSections: ["timeline"], sendForm: "raw" }) },
  parameters: { size: [348, 880] },
  play: ({ canvasElement }) =>
    fillIn(
      within(canvasElement).getByLabelText("Event (JSON)"),
      JSON.stringify({ type: "m.room.message", sender: "@bob:dev.local", content: { msgtype: "m.text", body: "Can you hear me?" } }, null, 2),
    ),
};

/** Timeline: send a delayed event ("Delayed" on, the delay in ms, "Schedule"); "Scheduled" lists the delayed events with "Send now", "Restart" and "Cancel". */
export const TimelineDelayed: Story = {
  args: { roomTools: roomTools({ openSections: ["timeline"] }) },
  parameters: { size: [348, 1050] },
  play: async ({ canvasElement }) => {
    fillMessage(canvasElement);
    const toggle = within(canvasElement).getByRole("switch", { name: "Send delayed" });
    await userEvent.click(toggle);
    toggle.blur();
  },
};

/** Tools collapsed: the room box with its sections closed, the "Client Backend Tool" and "Media Backend Tool" buttons below it. */
export const ToolsCollapsed: Story = {
  args: { roomTools: roomTools({ openSections: [] }) },
  parameters: { size: [348, 470] },
};
