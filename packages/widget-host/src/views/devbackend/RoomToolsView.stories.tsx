import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { MainViewModel, RoomToolsViewModel } from "../../appViewModel";
import type { RoomStateData, RoomTimelineData } from "../env";
import { mainVm, ROOM_TOOLS_TIMELINE, ROOMS, roomPanel, roomToolsVm, widgetTab, workspace } from "../fixtures";
import { SideStage, StoryEnv, fillIn, findElement } from "../storyEnv";
import { RoomToolsView } from "./RoomToolsView";

/** Ada's account with "Design crit" and "Platform team" in two room panels (as in `app-appshell--room-tools`), the Dev tools open. */
const main = (roomTools: Partial<RoomToolsViewModel> = {}, o: Partial<MainViewModel> = {}): MainViewModel =>
  mainVm({
    sidePanel: { view: "roomTools", width: 324 },
    workspaces: { ada: workspace([roomPanel("design", [widgetTab("design", "call")]), roomPanel("platform", [widgetTab("platform", "poll")])]) },
    roomTools: roomToolsVm(roomTools),
    ...o,
  });

/** The props for the view model `m`. */
const props = (m: MainViewModel, canSwitchToDevBackend = false) => ({ main: m, roomTools: m.roomTools!, canSwitchToDevBackend });

/**
 * The Dev tools of a Matrix account: the rooms of the room panels in a dropdown, their state and
 * timeline read like a mocked room's, everything sent as the account.
 */
const meta: Meta<typeof RoomToolsView> = { title: "SidePanel/RoomToolsView", component: RoomToolsView, decorators: [SideStage], parameters: { size: [348, 620] } };
export default meta;
type Story = StoryObj<typeof RoomToolsView>;

/**
 * No room open (no room panel shows a room). "New room panel" opens a room panel with the room
 * picker; the Dev tools stay open and show the room picked there. The DevBackend is enabled, so its
 * switch link is at the bottom.
 */
export const NoRoomOpen: Story = {
  args: props(main({}, { workspaces: { ada: workspace([]) } }), true),
  parameters: { size: [348, 520] },
};

/** Room dropdown open: the rooms of the room panels, left to right. No "Add room". It starts on the room of the focused panel; a picked room stays while it is open. */
export const RoomDropdown: Story = {
  args: props(main({ openSections: [] })),
  parameters: { size: [348, 520] },
  play: async ({ canvasElement }) => (await findElement(canvasElement, ".room-pick")).click(),
};

/** State: "sent as you", the shortcuts without "Add member", send state, the state explorer (one member's content shown). */
export const State: Story = {
  args: props(main({ openSections: ["state"] })),
  parameters: { size: [348, 1040] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
    (await canvas.findByRole("button", { name: "State key @bob:example.org of m.room.member" })).click();
  },
};

/** Timeline: the sender is the account, a delayed event scheduled here, "Load older events". The events are the ones the session holds, newest first. */
export const Timeline: Story = {
  args: props(
    main({
      openSections: ["timeline"],
      scheduled: { ada: { [ROOMS.design.id]: [{ delayId: "syd_dSbxDqCGhJ", type: "org.matrix.msc3401.call.member", stateKey: "_@ada:example.org_KJQWPLXBTA", delayMs: 30_000, restarts: 0, scheduledAt: Date.now() - 2_600 }] } },
    }),
  ),
  parameters: { size: [348, 1000] },
  render: (args) => (
    <StoryEnv env={{ useRoomTimeline: () => ({ timeline: { status: "ready", value: ROOM_TOOLS_TIMELINE }, retry: () => {} }) }}>
      <RoomToolsView {...props(args.main!)} />
    </StoryEnv>
  ),
  play: ({ canvasElement }) => fillIn(within(canvasElement).getByLabelText("Body"), "Does the widget see this?"),
};

const READING: RoomStateData = { state: { status: "loading" }, retry: () => {} };
const TIMELINE_FAILED: RoomTimelineData = { timeline: { status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }, retry: () => console.info("retry the timeline") };

/** Reading the room: the state is loading, the timeline failed. */
export const LoadingFailed: Story = {
  args: props(main({ openSections: ["state", "timeline"] })),
  render: (args) => (
    <StoryEnv env={{ useRoomState: () => READING, useRoomTimeline: () => TIMELINE_FAILED }}>
      <RoomToolsView {...props(args.main!)} />
    </StoryEnv>
  ),
};
