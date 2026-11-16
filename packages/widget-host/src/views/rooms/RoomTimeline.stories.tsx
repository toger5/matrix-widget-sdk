import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomPanelViewModel } from "../../appViewModel";
import type { RoomTimeline as RoomTimelineData } from "../../session";
import type { RoomTimelineData as TimelineHook } from "../env";
import { ACCOUNTS, devMainVm, mainVm, rawEvent, roomPanel, timelineTab, widgetTab, widgetVm, workspace, WIDGET_EVENTS } from "../fixtures";
import { findElement, StoryEnv } from "../storyEnv";
import { RoomTimeline } from "./RoomTimeline";
import { SoloPanel } from "./storyFrame";

/**
 * The RoomTimeline: what the Timeline tab shows (so the stories show it inside its room panel). The
 * events of the room for debugging, oldest at the top, a heading per day, no composer.
 */
const meta: Meta<typeof RoomTimeline> = { title: "Rooms/RoomTimeline", component: RoomTimeline, parameters: { size: [700, 440] } };
export default meta;
type Story = StoryObj<typeof RoomTimeline>;

const vm = (panel: RoomPanelViewModel, widgets = [widgetVm("design", "call")]): MainViewModel =>
  mainVm({ workspaces: { ada: workspace([panel]) }, widgets: Object.fromEntries(widgets.map((w) => [w.id, w])) });
const hook = (timeline: TimelineHook["timeline"]): (() => TimelineHook) => {
  const value: TimelineHook = { timeline, retry: () => console.info("retry the timeline") };
  return () => value;
};

const design = roomPanel("design", [widgetTab("design", "call"), timelineTab("design")], timelineTab("design").id);
/**
 * Events of every kind (the fixture `ROOM_TIMELINE`), one showing its JSON ("Starting the call
 * now"), "Load older events". Oldest at the top, newest at the bottom; scrolled to the bottom, it
 * stays there while new events arrive. One line per event: time, sender, what happened, event type.
 * State events are muted; undecryptable and deleted events, reactions, edits and unknown types (a
 * content preview) get a line too. Pressing a line shows the event's JSON. "Load older events"
 * first shows loaded events that are not rendered (the newest 200 are), then asks the session for
 * 50 more; while it loads it reads "Loading older events…" and is disabled.
 */
export const Events: Story = {
  render: () => <SoloPanel main={vm(design)} panel={design} />,
  parameters: { size: [900, 800] },
  play: async ({ canvasElement }) => (await findElement(canvasElement, ".tl-h", "Starting the call now")).click(),
};

const LAB: RoomTimelineData = {
  atStart: true,
  loadingOlder: false,
  events: [
    rawEvent("09:12:01", 0, "@alice:dev.local", "m.room.create", { room_version: "11" }, { state_key: "" }),
    rawEvent("09:12:01", 0, "@alice:dev.local", "m.room.member", { membership: "join", displayname: "Alice" }, { state_key: "@alice:dev.local" }),
    rawEvent("09:12:01", 0, "@alice:dev.local", "m.room.power_levels", { users: { "@alice:dev.local": 100 } }, { state_key: "" }),
    rawEvent("09:12:02", 0, "@alice:dev.local", "m.room.name", { name: "Widget lab" }, { state_key: "" }),
    rawEvent("09:12:02", 0, "@alice:dev.local", "m.widget", WIDGET_EVENTS.call.content, { state_key: "call" }),
    rawEvent("09:12:02", 0, "@alice:dev.local", "m.widget", WIDGET_EVENTS.notes.content, { state_key: "notes" }),
    rawEvent("09:14:30", 0, "@bob:dev.local", "m.room.member", { membership: "join", displayname: "Bob" }, { state_key: "@bob:dev.local" }),
    rawEvent("09:15:03", 0, "@bob:dev.local", "m.room.message", { msgtype: "m.text", body: "Can you hear me?" }),
    rawEvent("09:15:10", 0, "@alice:dev.local", "org.matrix.msc4143.rtc.member", { application: "m.call", call_id: "", scope: "m.room", device_id: "ALICEDEV", focus_active: { type: "livekit" }, foci_preferred: [] }),
    rawEvent("09:16:44", 0, "@alice:dev.local", "org.example.ping", { seq: 1 }),
  ],
};
const lab = roomPanel("lab", [timelineTab("lab")]);
/**
 * Start of the room reached. A mocked room: the DevBackend holds every event, so the start is
 * always reached there. The last events were sent by a widget (the RTC member event and a custom
 * type).
 */
export const Start: Story = {
  parameters: { size: [900, 640] },
  render: () => (
    <StoryEnv env={{ useRoomTimeline: hook({ status: "ready", value: LAB }) }}>
      <SoloPanel main={devMainVm({ workspaces: { [ACCOUNTS.dev.id]: workspace([lab]) }, widgets: {} })} panel={lab} />
    </StoryEnv>
  ),
};

const alone = roomPanel("design", [timelineTab("design")]);
/** Loading. */
export const Loading: Story = {
  render: () => (
    <StoryEnv env={{ useRoomTimeline: hook({ status: "loading" }) }}>
      <SoloPanel main={vm(alone, [])} panel={alone} />
    </StoryEnv>
  ),
};

/** Failed to load: "Try again" loads the timeline again. */
export const LoadError: Story = {
  render: () => (
    <StoryEnv env={{ useRoomTimeline: hook({ status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }) }}>
      <SoloPanel main={vm(alone, [])} panel={alone} />
    </StoryEnv>
  ),
};
