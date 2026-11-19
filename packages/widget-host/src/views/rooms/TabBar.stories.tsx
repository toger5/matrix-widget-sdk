import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { MainViewModel, RoomPanelViewModel, WidgetInstanceViewModel } from "../../appViewModel";
import { Screen } from "../app/storyScreen";
import { appVm, devToolsLayout, mainVm, roomPanel, roomToolsTab, timelineTab, widgetTab, widgetVm, workspace } from "../fixtures";
import { DEV_SETTINGS, HeadOnly } from "./storyFrame";
import { TabBar } from "./TabBar";

/** The tab bar is a part of the room panel's header (the room name, then the tabs), so the stories show the header of a panel. */
const meta: Meta<typeof TabBar> = { title: "Rooms/TabBar", component: TabBar };
export default meta;
type Story = StoryObj<typeof TabBar>;

const vm = (panel: RoomPanelViewModel, widgets: WidgetInstanceViewModel[], devToolsOf: string[] = []): MainViewModel =>
  mainVm({
    workspaces: { ada: workspace([panel], { devTools: Object.fromEntries(devToolsOf.map((id) => [id, devToolsLayout()])) }) },
    widgets: Object.fromEntries(widgets.map((w) => [w.id, w])),
  });

const plain = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]);
/** WidgetTab active, the other WidgetTab and the room name inactive. */
export const WidgetActive: Story = { render: () => <HeadOnly main={vm(plain, [widgetVm("design", "call"), widgetVm("design", "board")])} panel={plain} />, parameters: { size: [860, 72] } };

const overview = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")], null);
/**
 * Room name selected (dev tools enabled: ⋯ on the widget tabs; the whiteboard's dev tools are open).
 * The room name looks like the active tab; the body is the RoomOverview. The + button selects the
 * room name too.
 */
export const OverviewActive: Story = {
  parameters: { size: [860, 72] },
  render: () => <HeadOnly main={vm(overview, [widgetVm("design", "call"), widgetVm("design", "board")], [widgetVm("design", "board").id])} panel={overview} settings={DEV_SETTINGS} />,
};

const pinned = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), widgetTab("design", "poll")]);
/**
 * Tabs marked as always on screen (pin icon). Element Call is pinned and active: it is shown in its
 * tab. The whiteboard is pinned and not active: it is shown in the PictureInPicturePanel until its
 * tab is pressed.
 */
export const Pinned: Story = {
  parameters: { size: [960, 72] },
  render: () => (
    <HeadOnly
      main={vm(pinned, [widgetVm("design", "call", { alwaysOnScreen: true }), widgetVm("design", "board", { alwaysOnScreen: true }), widgetVm("design", "poll")])}
      panel={pinned}
    />
  ),
};

const timeline = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), timelineTab("design")], timelineTab("design").id);
/**
 * Timeline tab active (dev tools enabled: ⋯ on the widget tabs only). The timeline is a host tab: a
 * message icon, "Timeline" and ×, but no ⋯ and no pin. A room view has at most one; it goes at the
 * end when it is opened. Alt+W closes it like a widget tab.
 */
export const TimelineActive: Story = {
  parameters: { size: [860, 72] },
  render: () => <HeadOnly main={vm(timeline, [widgetVm("design", "call"), widgetVm("design", "board")])} panel={timeline} settings={DEV_SETTINGS} />,
};

const tools = roomPanel("design", [widgetTab("design", "call"), timelineTab("design"), roomToolsTab("design")], roomToolsTab("design").id);
/**
 * Room dev tools tab active (dev tools enabled: ⋯ on the widget tab only). The room dev tools are a
 * host tab like the timeline: the Dev tools icon (as on the LeftBar's Dev tools button), "Room dev
 * tools" and × ("Close the room dev tools"), no ⋯ and no pin; its title is "Room dev tools of Design
 * crit". A room view has at most one; it goes at the end when it is opened. Alt+W closes it.
 */
export const RoomDevToolsActive: Story = {
  parameters: { size: [860, 72] },
  render: () => <HeadOnly main={vm(tools, [widgetVm("design", "call")])} panel={tools} settings={DEV_SETTINGS} />,
};

const MANY = ["call", "board", "poll", "notes", "timer", "retro", "stream"] as const;
const many = roomPanel("design", MANY.map((w) => widgetTab("design", w)), widgetTab("design", "poll").id);
/**
 * More tabs than fit: the widget tabs scroll (the room name stays) and the "all tabs" button opens
 * the menu of all tabs (open here). Element Call is always on screen and not the active tab, so it
 * is in the floating panel.
 */
export const Overflow: Story = {
  parameters: { size: [860, 360] },
  // The whole app (LeftBar collapsed), so the PiP panel shows the call.
  render: (_, { globals }) => (
    <Screen
      vm={appVm({
        ...vm(many, MANY.map((w) => widgetVm("design", w, { alwaysOnScreen: w === "call" }))),
        leftBar: { collapsed: true, expandButtonVisible: false },
        workspaces: { ada: workspace([many], { pip: { stacking: "horizontal", position: { x: 608, y: 24 }, boxSize: { width: 224, height: 140 } } }) },
      })}
      theme={globals.theme}
    />
  ),
  // The button appears once the bar measured that the tabs do not fit: at the story's width (`shot.mjs`), not in a
  // wider Storybook canvas, where every tab fits and there is nothing to open.
  play: async ({ canvasElement }) =>
    (await within(canvasElement).findByRole("button", { name: /^All \d+ tabs$/ }).catch(() => undefined))?.click(),
};
