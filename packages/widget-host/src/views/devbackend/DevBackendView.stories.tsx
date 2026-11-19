import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import type { RoomToolsViewModel } from "../../appViewModel";
import { EMPTY_MOCKED_ROOM_DATA } from "../env";
import { MOCKED_ROOM_DATA, ROOMS, roomDevTools, roomToolsVm } from "../fixtures";
import { SideStage, StoryEnv, fillIn, findElement, openSendForm } from "../storyEnv";
import { DevBackendView } from "./DevBackendView";

const roomTools = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => roomToolsVm(o);

/**
 * The Dev tools while the DevBackend is active (the DevBackendView): one page per mocked room in a
 * room box (the slim header with the dropdown, then the room dev tools, the bar on the left), the
 * tool boxes below it, "Leave DevBackend" at the bottom. On the construction fence. The State section is `SidePanel/DevBackendView/State`, the open tools are
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

/** "Send event" open, the message form filled in as Bob (`@bob:dev.local`), as the timeline stories show it. */
const fillMessage = async (canvasElement: HTMLElement) => {
  await openSendForm(canvasElement, "Timeline");
  const canvas = within(canvasElement);
  fillIn(await canvas.findByLabelText("Sender"), "@bob:dev.local");
  fillIn(canvas.getByLabelText("Body"), "Can you hear me?");
};

const STATE_ONLY = roomDevTools("left", ["state"]);
const TIMELINE_ONLY = roomDevTools("left", ["timeline"]);

/** No rooms yet (after "skip login": no leave link). */
export const NoRooms: Story = {
  args: { roomTools: roomTools(), roomId: undefined, canLeave: false },
  render: (args) => (
    <StoryEnv env={{ useMockedRoomData: () => EMPTY_MOCKED_ROOM_DATA }}>
      <DevBackendView {...args} />
    </StoryEnv>
  ),
};

/** Room dropdown open: the mocked rooms and "Add room". */
export const RoomDropdown: Story = {
  args: { roomTools: roomTools() },
  play: async ({ canvasElement }) => (await findElement(canvasElement, ".room-pick")).click(),
};

/** State: send state with the test widget form (the URL read-only, with a copy button), the state explorer (`m.room.member` expanded, the content of one member shown). */
export const State: Story = {
  args: { roomTools: roomTools({ layout: STATE_ONLY }) },
  parameters: { size: [348, 820] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSendForm(canvasElement, "State");
    canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
    (await canvas.findByRole("button", { name: "State key @bob:dev.local of m.room.member" })).click();
  },
};

/** Timeline: send event with a predefined form (a message), the event list. */
export const Timeline: Story = {
  args: { roomTools: roomTools({ layout: TIMELINE_ONLY }) },
  parameters: { size: [348, 560] },
  play: ({ canvasElement }) => fillMessage(canvasElement),
};

/** Timeline: send an event as raw JSON (`type`, `sender`, `content` in one editor). */
export const TimelineRawJson: Story = {
  args: { roomTools: roomTools({ layout: TIMELINE_ONLY, sendForm: "raw" }) },
  parameters: { size: [348, 720] },
  play: async ({ canvasElement }) => {
    await openSendForm(canvasElement, "Timeline");
    fillIn(
      await within(canvasElement).findByLabelText("Event (JSON)"),
      JSON.stringify({ type: "m.room.message", sender: "@bob:dev.local", content: { msgtype: "m.text", body: "Can you hear me?" } }, null, 2),
    );
  },
};

/** Timeline: send a delayed event ("Delayed" on, the delay in ms, "Schedule"); "Scheduled" lists the delayed events with "Send now", "Restart" and "Cancel". */
export const TimelineDelayed: Story = {
  args: { roomTools: roomTools({ layout: TIMELINE_ONLY }) },
  parameters: { size: [348, 720] },
  play: async ({ canvasElement }) => {
    await fillMessage(canvasElement);
    const toggle = within(canvasElement).getByRole("checkbox", { name: "Send delayed" });
    await userEvent.click(toggle);
    toggle.blur();
  },
};

/**
 * Timeline with a widget's pagination request: a widget called `paginate_timeline` (limit 20) and
 * waits. An amber row at the top of the events: "20 requested", how many random messages to
 * generate (the requested number, else 20), "Start reached", and "Resolve", which puts the messages
 * before the oldest event and tells the widgets (`notify_timeline_update`).
 */
export const TimelinePaginationRequested: Story = {
  args: { roomTools: roomTools({ layout: TIMELINE_ONLY }) },
  parameters: { size: [348, 520] },
  render: (args) => (
    <StoryEnv env={{ useMockedRoomData: () => ({ ...MOCKED_ROOM_DATA, pagination: { status: "paginating", requested: { limit: 20 } } }) }}>
      <DevBackendView {...args} />
    </StoryEnv>
  ),
};

/**
 * Tools collapsed: the room box (header with the dropdown, "Room actions" and ×; the bar on the
 * left, State and Timeline stacked, no "sending as" line), then the closed tools as panel headers
 * ("Client Backend Tool", "Media Backend Tool" with its number of files), and "Leave DevBackend".
 */
export const ToolsCollapsed: Story = {
  args: { roomTools: roomTools() },
  parameters: { size: [348, 640] },
};
