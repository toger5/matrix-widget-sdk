import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { MainViewModel, RoomToolsViewModel } from "../../appViewModel";
import type { RoomStateData, RoomTimelineData } from "../env";
import { mainVm, ROOM_TOOLS_TIMELINE, ROOMS, roomDevTools, roomPanel, roomToolsVm, widgetTab, workspace } from "../fixtures";
import { SideStage, StoryEnv, fillIn, findElement, openSendForm } from "../storyEnv";
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
 * The Dev tools of a Matrix account: the slim header (the rooms of the room panels in a dropdown, ×),
 * then the room dev tools: the bar of the widget dev tools on the left (status dot, State, Timeline,
 * dock switch) and the panels stacked. The state and timeline are read like a mocked room's,
 * everything is sent as the account.
 */
const meta: Meta<typeof RoomToolsView> = { title: "SidePanel/RoomToolsView", component: RoomToolsView, decorators: [SideStage], parameters: { size: [348, 620] } };
export default meta;
type Story = StoryObj<typeof RoomToolsView>;

/** The events of "Design crit" as the session holds them, newest first in the list; older ones can be loaded. */
const WithEvents = ({ main: m }: { main: MainViewModel }) => (
  <StoryEnv env={{ useRoomTimeline: () => ({ timeline: { status: "ready", value: ROOM_TOOLS_TIMELINE }, retry: () => {} }) }}>
    <RoomToolsView {...props(m)} />
  </StoryEnv>
);

const SCHEDULED = { ada: { [ROOMS.design.id]: [{ delayId: "syd_dSbxDqCGhJ", type: "org.matrix.msc3401.call.member", stateKey: "_@ada:example.org_KJQWPLXBTA", delayMs: 30_000, restarts: 0, scheduledAt: Date.now() - 2_600 }] } };

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
  args: props(main()),
  parameters: { size: [348, 520] },
  play: async ({ canvasElement }) => (await findElement(canvasElement, ".room-pick")).click(),
};

/**
 * The default: the bar on the left, State and Timeline stacked and sharing the height, each with its
 * filter, the send form collapsed to its heading (with the form menu) and the list. "Sending as" in
 * the status line under the panels. The toggles show their labels while they fit the bar.
 */
export const StateAndTimeline: Story = {
  args: props(main()),
  parameters: { size: [348, 720] },
  render: (args) => <WithEvents main={args.main!} />,
};

/**
 * Both panels, State's send form open: above the list it takes at most 45% of the panel and scrolls
 * on its own, so the state rows stay visible.
 */
export const StateFormOpen: Story = {
  args: props(main()),
  parameters: { size: [348, 640] },
  render: (args) => <WithEvents main={args.main!} />,
  play: ({ canvasElement }) => openSendForm(canvasElement, "State"),
};

/**
 * Only State is open (the Timeline toggle is not pressed) and fills the height. "Send state" open with
 * the test widget form (labels left, the URL as read-only text); `m.room.name` and `m.room.topic` show
 * their content in the row; `m.room.member` expanded, Bob's content shown. No "Add member" for an account.
 */
export const State: Story = {
  args: props(main({ layout: roomDevTools("left", ["state"]) })),
  parameters: { size: [348, 820] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSendForm(canvasElement, "State");
    canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
    (await canvas.findByRole("button", { name: "State key @bob:example.org of m.room.member" })).click();
  },
};

/**
 * The form menu of "Send state" open: the widget forms, then the shortcuts (edit name, edit
 * description; "Add member" only in the DevBackend), Raw JSON last. Choosing one shows its form.
 */
export const StateFormMenu: Story = {
  args: props(main({ layout: roomDevTools("left", ["state"]) })),
  parameters: { size: [348, 520] },
  play: async ({ canvasElement }) => {
    await openSendForm(canvasElement, "State");
    within(canvasElement).getByRole("button", { name: "Send state form, Test widget" }).click();
  },
};

/**
 * Only Timeline. "Send event" open with the message form (the sender is the account, as text), a
 * delayed event scheduled here (send now, restart, cancel as icon buttons; its type cut at the start),
 * the events newest first: in a narrow list the type and the sender's localpart, no preview. "Load
 * older events" ends the list.
 */
export const Timeline: Story = {
  args: props(main({ layout: roomDevTools("left", ["timeline"]), scheduled: SCHEDULED })),
  parameters: { size: [348, 720] },
  render: (args) => <WithEvents main={args.main!} />,
  play: async ({ canvasElement }) => {
    await openSendForm(canvasElement, "Timeline");
    fillIn(await within(canvasElement).findByLabelText("Body"), "Does the widget see this?");
  },
};

const READING: RoomStateData = { state: { status: "loading" }, retry: () => {} };
const TIMELINE_FAILED: RoomTimelineData = { timeline: { status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }, retry: () => console.info("retry the timeline") };

/** Reading the room: the state is still being read, the timeline failed: the dot is red, the Timeline toggle has the alert badge. */
export const LoadingFailed: Story = {
  args: props(main()),
  render: (args) => (
    <StoryEnv env={{ useRoomState: () => READING, useRoomTimeline: () => TIMELINE_FAILED }}>
      <RoomToolsView {...props(args.main!)} />
    </StoryEnv>
  ),
};
