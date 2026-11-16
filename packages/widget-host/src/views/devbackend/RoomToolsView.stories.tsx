import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomToolsViewModel } from "../../appViewModel";
import type { RoomStateData, RoomTimelineData } from "../env";
import { mainVm, ROOM_TOOLS_TIMELINE, ROOMS, roomPanel, roomToolsVm, widgetTab, workspace } from "../fixtures";
import { SideStage, StoryEnv } from "../storyEnv";
import { RoomToolsView } from "./RoomToolsView";

/** Ada's account with "Design crit" and "Platform team" in two room panels (as in leaf roomtools/app), the Dev tools open. */
const main = (roomTools: Partial<RoomToolsViewModel> = {}, o: Partial<MainViewModel> = {}): MainViewModel =>
  mainVm({
    sidePanel: { view: "roomTools", width: 324 },
    workspaces: { ada: workspace([roomPanel("design", [widgetTab("design", "call")]), roomPanel("platform", [widgetTab("platform", "poll")])]) },
    roomTools: roomToolsVm(roomTools),
    ...o,
  });

/** The props for the view model `m`. */
const props = (m: MainViewModel, canSwitchToDevBackend = false) => ({ main: m, roomTools: m.roomTools!, canSwitchToDevBackend });

const meta: Meta<typeof RoomToolsView> = { title: "SidePanel/RoomToolsView", component: RoomToolsView, decorators: [SideStage] };
export default meta;
type Story = StoryObj<typeof RoomToolsView>;

const click = (root: HTMLElement, selector: string, text: string) => Array.from(root.querySelectorAll<HTMLElement>(selector)).find((el) => el.textContent?.includes(text))?.click();
const nextFrame = () => new Promise((resolve) => setTimeout(resolve, 50));

/** leaf roomtools/none: no room panel shows a room; the DevBackend is enabled, so its switch link is at the bottom */
export const NoRoomOpen: Story = {
  args: props(main({}, { workspaces: { ada: workspace([]) } }), true),
  parameters: { stageHeight: 520 },
};

/** leaf roomtools/dropdown: the rooms of the room panels, left to right; no "Add room" */
export const RoomDropdown: Story = {
  args: props(main({ openSections: [] })),
  parameters: { stageHeight: 520 },
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLElement>(".room-pick")?.click();
  },
};

/** leaf roomtools/state: "sent as you", no "Add member", one member's content shown */
export const State: Story = {
  args: props(main({ openSections: ["state"] })),
  parameters: { stageHeight: 1040 },
  play: async ({ canvasElement }) => {
    click(canvasElement, ".tree-row.lvl0", "m.room.member");
    await nextFrame();
    click(canvasElement, ".tree-key", "@bob:example.org");
  },
};

/** leaf roomtools/timeline: the sender is the account, a delayed event scheduled here, "Load older events" */
export const Timeline: Story = {
  args: props(
    main({
      openSections: ["timeline"],
      scheduled: { ada: { [ROOMS.design.id]: [{ delayId: "syd_dSbxDqCGhJ", type: "org.matrix.msc3401.call.member", stateKey: "_@ada:example.org_KJQWPLXBTA", delayMs: 30_000, restarts: 0, scheduledAt: Date.now() - 2_600 }] } },
    }),
  ),
  parameters: { stageHeight: 1000 },
  render: (args) => (
    <StoryEnv env={{ useRoomTimeline: () => ({ timeline: { status: "ready", value: ROOM_TOOLS_TIMELINE }, retry: () => {} }) }}>
      <RoomToolsView {...props(args.main!)} />
    </StoryEnv>
  ),
};

const READING: RoomStateData = { state: { status: "loading" }, retry: () => {} };
const TIMELINE_FAILED: RoomTimelineData = { timeline: { status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }, retry: () => console.info("retry the timeline") };

/** leaf roomtools/loading-failed: the state is being read, the timeline failed */
export const LoadingFailed: Story = {
  args: props(main({ openSections: ["state", "timeline"] })),
  parameters: { stageHeight: 620 },
  render: (args) => (
    <StoryEnv env={{ useRoomState: () => READING, useRoomTimeline: () => TIMELINE_FAILED }}>
      <RoomToolsView {...props(args.main!)} />
    </StoryEnv>
  ),
};
