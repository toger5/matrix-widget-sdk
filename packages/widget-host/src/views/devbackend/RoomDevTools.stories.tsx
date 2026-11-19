import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { MainViewModel, MockedRoomData, RoomDevToolsLayout, RoomPanelViewModel } from "../../appViewModel";
import type { RoomStateData, RoomTimelineData, ViewEnv } from "../env";
import { ACCOUNTS, devMainVm, MOCKED_ROOM_DATA, mainVm, ROOM_TOOLS_TIMELINE, ROOMS, roomDevTools, roomPanel, roomToolsTab, roomToolsVm, timelineTab, widgetTab, widgetVm, workspace } from "../fixtures";
import { fillIn, openSendForm, StoryEnv } from "../storyEnv";
import { DEV_SETTINGS, SoloPanel } from "../rooms/storyFrame";
import { RoomDevTools } from "./RoomDevTools";

/**
 * The room dev tools in a room dev tools tab of a room panel (`TabViewModel` "roomTools"): the room
 * of the panel, no dropdown, never the DevBackend's tools; the bar on top by default.
 */
const meta: Meta<typeof RoomDevTools> = { title: "Rooms/RoomDevTools", component: RoomDevTools, parameters: { size: [1100, 640] } };
export default meta;
type Story = StoryObj<typeof RoomDevTools>;

/** A delayed event Ada scheduled here, 2.6 s ago with a delay of 30 s. */
const scheduled = () => ({ ada: { [ROOMS.design.id]: [{ delayId: "syd_dSbxDqCGhJ", type: "org.matrix.msc3401.call.member", stateKey: "_@ada:example.org_KJQWPLXBTA", delayMs: 30_000, restarts: 0, scheduledAt: Date.now() - 2_600 }] } });

/** "Design crit" in Ada's account: Element Call, the timeline and the room dev tools tab (shown, with `layout`). */
function designTab(layout: RoomDevToolsLayout, withScheduled = true): { main: MainViewModel; panel: RoomPanelViewModel } {
  const tools = roomToolsTab("design", layout);
  const panel = roomPanel("design", [widgetTab("design", "call"), timelineTab("design"), tools], tools.id);
  const call = widgetVm("design", "call");
  return { panel, main: mainVm({ workspaces: { ada: workspace([panel]) }, widgets: { [call.id]: call }, roomTools: roomToolsVm(withScheduled ? { scheduled: scheduled() } : {}) }) };
}

/** "Widget lab" (or the empty room) in the DevBackend: its widgets and the room dev tools tab (shown, with `layout`). */
function labTab(layout: RoomDevToolsLayout, room: "lab" | "empty" = "lab"): { main: MainViewModel; panel: RoomPanelViewModel } {
  const tools = roomToolsTab(room, layout);
  const panel = roomPanel(room, room === "lab" ? [widgetTab("lab", "call"), timelineTab("lab"), tools] : [tools], tools.id);
  return { panel, main: devMainVm({ workspaces: { ada: workspace([]), [ACCOUNTS.dev.id]: workspace([panel]) } }) };
}

/** The events of "Design crit" in the Dev tools of Ada's account. */
const ADA: Partial<ViewEnv> = { useRoomTimeline: () => ({ timeline: { status: "ready", value: ROOM_TOOLS_TIMELINE }, retry: () => {} }) };

/** The DevBackend without delayed events. */
const NOTHING_SCHEDULED: Partial<ViewEnv> = { useMockedRoomData: () => ({ ...MOCKED_ROOM_DATA, scheduled: [] }) };

/** The panel `{ main, panel }` filling the story, with `env`. */
const InPanel = ({ main, panel, env, fence = false }: { main: MainViewModel; panel: RoomPanelViewModel; env?: Partial<ViewEnv>; fence?: boolean }) => (
  <StoryEnv env={env}>
    <SoloPanel main={main} panel={panel} settings={DEV_SETTINGS} fence={fence} />
  </StoryEnv>
);



/**
 * The default of a new tab: the bar on top, State and Timeline side by side. Both send forms are
 * open; each panel is wider than 520px, so the form is a column left of the list. One event's JSON
 * is shown. "Sending as" under the panels.
 */
export const DockedTop: Story = {
  render: () => <InPanel {...designTab(roomDevTools("top"))} env={ADA} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSendForm(canvasElement, "State");
    await openSendForm(canvasElement, "Timeline");
    fillIn(await canvas.findByLabelText("Body"), "Does the widget see this?");
    canvas.getByRole("button", { name: /^org\.matrix\.msc4411\.widget/ }).click();
    within(canvas.getByRole("list", { name: "Timeline events" })).getByRole("button", { name: /^m\.room\.message/ }).click();
  },
};

/**
 * The bar docked on the left, in the DevBackend (on the fence, "Widget lab", any sender): the panels
 * stack, each as wide as the tab; State's form is open as a column, Timeline's is collapsed, so its
 * list takes the whole width. No "sending as" line: the DevBackend sends as anyone.
 */
export const DockedLeft: Story = {
  parameters: { size: [1100, 720] },
  render: () => <InPanel {...labTab(roomDevTools("left"))} env={NOTHING_SCHEDULED} fence />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSendForm(canvasElement, "State");
    canvas.getByRole("button", { name: /^m\.room\.member/ }).click();
    (await canvas.findByRole("button", { name: "State key @bob:dev.local of m.room.member" })).click();
  },
};

/**
 * A narrow room panel with the bar on top: the panels stay side by side (the stacking follows the
 * dock only). The labelled toggles do not fit the bar, so it shows icons and counts; the lists show
 * the type and the sender's localpart.
 */
export const Narrow: Story = {
  parameters: { size: [440, 640] },
  render: () => <InPanel {...designTab(roomDevTools("top"))} env={ADA} />,
};

/**
 * One panel closed (State's toggle is not pressed): Timeline takes the whole width, its form as a
 * column. In the DevBackend a widget's `paginate_timeline` waits in an amber row at the top of the
 * events (how many messages, "Start reached", "Resolve"; the explanation in its tooltip), and a
 * widget's delayed event is under "Scheduled".
 */
export const OnePanel: Story = {
  render: () => (
    <InPanel
      {...labTab(roomDevTools("top", ["timeline"]))}
      env={{ useMockedRoomData: (): MockedRoomData => ({ ...MOCKED_ROOM_DATA, pagination: { status: "paginating", requested: { limit: 20 } } }) }}
      fence
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openSendForm(canvasElement, "Timeline");
    fillIn(await canvas.findByLabelText("Sender"), "@bob:dev.local");
    fillIn(canvas.getByLabelText("Body"), "Can you hear me?");
  },
};

const READING_STATE: RoomStateData = { state: { status: "loading" }, retry: () => {} };
const READING_TIMELINE: RoomTimelineData = { timeline: { status: "loading" }, retry: () => {} };

/** Reading the room: the status dot is amber, both panels say what they wait for. */
export const Loading: Story = {
  parameters: { size: [1100, 360] },
  render: () => <InPanel {...designTab(roomDevTools("top"), false)} env={{ useRoomState: () => READING_STATE, useRoomTimeline: () => READING_TIMELINE }} />,
};

/** Both filters match nothing: "No state event matches the filter." / "No event matches the filter.", the counts "0 of …". */
export const NoMatch: Story = {
  parameters: { size: [1100, 360] },
  render: () => <InPanel {...designTab(roomDevTools("top"), false)} env={ADA} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    fillIn(await canvas.findByLabelText("Filter state by type or key"), "m.space");
    fillIn(canvas.getByLabelText("Filter events by type or sender"), "@zoe");
  },
};

const NO_STATE: RoomStateData = { state: { status: "ready", value: [] }, retry: () => {} };
const NO_EVENTS: RoomTimelineData = { timeline: { status: "ready", value: { events: [], atStart: true, loadingOlder: false } }, retry: () => {} };

/** An empty room (DevBackend): no state yet, no events yet; the toggles have no badge at 0. */
export const Empty: Story = {
  parameters: { size: [1100, 360] },
  render: () => <InPanel {...labTab(roomDevTools("top"), "empty")} env={{ ...NOTHING_SCHEDULED, useRoomState: () => NO_STATE, useRoomTimeline: () => NO_EVENTS }} fence />,
};
