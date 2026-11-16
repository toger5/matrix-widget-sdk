import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, RoomPanelViewModel } from "../../appViewModel";
import type { RoomTimeline as RoomTimelineData } from "../../session";
import type { RoomTimelineData as TimelineHook } from "../env";
import { ACCOUNTS, devMainVm, mainVm, rawEvent, roomPanel, timelineTab, widgetTab, widgetVm, workspace, WIDGET_EVENTS } from "../fixtures";
import { StoryEnv } from "../storyEnv";
import { RoomTimeline } from "./RoomTimeline";
import { SoloPanel } from "./storyFrame";

// The timeline is what the Timeline tab shows, so the stories show it inside its room panel.
const meta: Meta<typeof RoomTimeline> = { title: "Rooms/RoomTimeline", component: RoomTimeline };
export default meta;
type Story = StoryObj<typeof RoomTimeline>;

const vm = (panel: RoomPanelViewModel, widgets = [widgetVm("design", "call")]): MainViewModel =>
  mainVm({ workspaces: { ada: workspace([panel]) }, widgets: Object.fromEntries(widgets.map((w) => [w.id, w])) });
const hook = (timeline: TimelineHook["timeline"]): (() => TimelineHook) => {
  const value: TimelineHook = { timeline, retry: () => console.info("retry the timeline") };
  return () => value;
};

// leaf timeline/events: events of every kind (the default fixture `ROOM_TIMELINE`), one showing its JSON, "Load older events"
const design = roomPanel("design", [widgetTab("design", "call"), timelineTab("design")], timelineTab("design").id);
export const Events: Story = {
  render: () => <SoloPanel main={vm(design)} panel={design} />,
  // the leaf shows the event "Starting the call now" open
  play: async ({ canvasElement }) => {
    await new Promise((resolve) => setTimeout(resolve, 100));
    Array.from(canvasElement.querySelectorAll<HTMLButtonElement>(".tl-h"))
      .find((b) => b.textContent?.includes("Starting the call now"))
      ?.click();
  },
};

// leaf timeline/start: a mocked room, every event is there; the last two were sent by a widget
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
export const Start: Story = {
  render: () => (
    <StoryEnv env={{ useRoomTimeline: hook({ status: "ready", value: LAB }) }}>
      <SoloPanel main={devMainVm({ workspaces: { [ACCOUNTS.dev.id]: workspace([lab]) }, widgets: {} })} panel={lab} />
    </StoryEnv>
  ),
};

// leaf timeline/loading
const alone = roomPanel("design", [timelineTab("design")]);
export const Loading: Story = {
  render: () => (
    <StoryEnv env={{ useRoomTimeline: hook({ status: "loading" }) }}>
      <SoloPanel main={vm(alone, [])} panel={alone} />
    </StoryEnv>
  ),
};

// leaf timeline/error: "Try again" loads it again
export const LoadError: Story = {
  render: () => (
    <StoryEnv env={{ useRoomTimeline: hook({ status: "error", error: "The homeserver did not answer (example.org, timeout after 30 s)." }) }}>
      <SoloPanel main={vm(alone, [])} panel={alone} />
    </StoryEnv>
  ),
};
