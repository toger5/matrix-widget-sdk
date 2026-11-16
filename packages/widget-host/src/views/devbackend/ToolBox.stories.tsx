import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { RoomToolsViewModel } from "../../appViewModel";
import { ROOMS, roomToolsVm } from "../fixtures";
import { SideStage, fillIn } from "../storyEnv";
import { DevBackendView } from "./DevBackendView";

/**
 * The tool boxes below the room box, inside the whole DevBackendView: the Client Backend Tool and
 * the Media Backend Tool. Pressing a tool's button turns it into its box (resized at the separator
 * above it, minimised with its button); one is open at a time. The collapsed tools are the
 * `ToolsCollapsed` story of `SidePanel/DevBackendView`.
 */
const roomTools = (o: Partial<RoomToolsViewModel> = {}): RoomToolsViewModel => roomToolsVm({ openSections: [], ...o });

const meta: Meta<typeof DevBackendView> = {
  title: "SidePanel/DevBackendView/Tools",
  component: DevBackendView,
  args: { canLeave: true, roomId: ROOMS.lab.id },
  decorators: [SideStage],
  parameters: { size: [348, 850], fence: true },
};
export default meta;
type Story = StoryObj<typeof DevBackendView>;

/** The Client Backend Tool open below the room box: "Widget host behavior" (for all mocked rooms), with the resize handle and the minimise button. */
export const Behavior: Story = {
  args: { roomTools: roomTools({ openSections: ["widgetHostBehavior"], tools: { open: "client", heightShare: 0.5 } }) },
};

/** The Client Backend Tool dragged higher, "To-device messages" open: send to the widget's device, the messages sent by widgets. */
export const ToDevice: Story = {
  args: { roomTools: roomTools({ openSections: ["toDevice"], tools: { open: "client", heightShare: 0.73 } }) },
  parameters: { size: [348, 900] },
  play: ({ canvasElement }) => {
    const form = within(within(canvasElement).getByRole("form", { name: "Send to-device message" }));
    fillIn(form.getByLabelText("Type"), "org.matrix.msc4143.rtc.encryption_keys");
    fillIn(form.getByLabelText("User ID"), "@bob:dev.local");
    fillIn(form.getByLabelText("Device ID"), "BOBDEV");
    fillIn(form.getByLabelText("To-device content (JSON)"), JSON.stringify({ keys: [{ index: 0, key: "c2VjcmV0" }] }, null, 2));
  },
};

/** The Media Backend Tool open below the room box: upload, the list of all media (also those uploaded by widgets), copy an MXC URI. */
export const Media: Story = {
  args: { roomTools: roomTools({ tools: { open: "media", heightShare: 0.5 } }) },
};
