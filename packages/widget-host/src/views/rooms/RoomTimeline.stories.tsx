import type { Meta, StoryObj } from "@storybook/react-vite";
import { waitFor } from "storybook/test";

import { rawTimelineItems, type MainViewModel, type RoomPanelViewModel } from "../../appViewModel";
import type { RoomTimeline as RoomTimelineData } from "../../session";
import { staticTimeline } from "../env";
import { ACCOUNTS, devMainVm, mainVm, rawEvent, roomPanel, timelineTab, widgetTab, widgetVm, workspace, WIDGET_EVENTS } from "../fixtures";
import { findElement, StoryEnv } from "../storyEnv";
import { RoomTimeline } from "./RoomTimeline";
import { SoloPanel } from "./storyFrame";

/**
 * The RoomTimeline: what the Timeline tab shows (so the stories show it inside its room panel).
 * Element Web's TimelineView, oldest at the top, a date separator per day, no composer. The stories
 * show the raw timeline (js session, DevBackend: one row per event); the rust session's timeline
 * folds edits, reactions and redactions into their event and shows local echoes.
 */
/** The TimelineView lays its rows out behind a spinner and shows them once they are in place (up to ~2 s when an image loads). */
const revealed = (canvasElement: HTMLElement) =>
  waitFor(
    () => {
      if (!canvasElement.querySelector<HTMLElement>('[data-testid="timeline-scroller"]')?.checkVisibility({ visibilityProperty: true })) throw new Error("the timeline is not shown yet");
    },
    { timeout: 5000 },
  );
const meta: Meta<typeof RoomTimeline> = { title: "Rooms/RoomTimeline", component: RoomTimeline, parameters: { size: [700, 440] }, play: ({ canvasElement }) => revealed(canvasElement) };
export default meta;
type Story = StoryObj<typeof RoomTimeline>;

const vm = (panel: RoomPanelViewModel, widgets = [widgetVm("design", "call")]): MainViewModel =>
  mainVm({ workspaces: { ada: workspace([panel]) }, widgets: Object.fromEntries(widgets.map((w) => [w.id, w])) });

const design = roomPanel("design", [widgetTab("design", "call"), timelineTab("design")], timelineTab("design").id);
/**
 * Events of every kind (the fixture `ROOM_TIMELINE`, as Ada sees it), one showing its JSON
 * ("Starting the call now"). Oldest at the top, newest at the bottom; scrolled to the bottom, it
 * stays there while new events arrive, scrolled to the top it loads older events. A message tile:
 * avatar and sender (left out after an event of the same sender), time, the text or the image, the
 * reactions as buttons below it (Ada's 👍 selected), the event type at the end of the line, which
 * opens the event's JSON. Undecryptable and deleted events get Element's bodies; the sticker's
 * image is not in the fixtures' media (its error state). State and other events are one muted line
 * each (an edit too: the raw timeline does not fold it in).
 */
export const Events: Story = {
  render: () => <SoloPanel main={vm(design)} panel={design} />,
  parameters: { size: [900, 800] },
  play: async ({ canvasElement }) => {
    await revealed(canvasElement);
    (await findElement(canvasElement, ".tl-tile", "Starting the call now")).querySelector<HTMLElement>(".tl-json")!.click();
  },
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
const LAB_VM = staticTimeline(rawTimelineItems(LAB));
const lab = roomPanel("lab", [timelineTab("lab")]);
/**
 * Start of the room reached. A mocked room: the DevBackend holds every event, so the start is
 * always reached there. The last events were sent by a widget (the RTC member event and a custom
 * type).
 */
export const Start: Story = {
  parameters: { size: [900, 640] },
  render: () => (
    <StoryEnv env={{ useTimelineViewModel: () => LAB_VM }}>
      <SoloPanel main={devMainVm({ workspaces: { [ACCOUNTS.dev.id]: workspace([lab]) }, widgets: {} })} panel={lab} />
    </StoryEnv>
  ),
};

const alone = roomPanel("design", [timelineTab("design")]);
const LOADING_VM = staticTimeline();
/** Loading: the first read, and older events while they load (the row at the top). */
export const Loading: Story = {
  play: undefined,
  render: () => (
    <StoryEnv env={{ useTimelineViewModel: () => LOADING_VM }}>
      <SoloPanel main={vm(alone, [])} panel={alone} />
    </StoryEnv>
  ),
};
