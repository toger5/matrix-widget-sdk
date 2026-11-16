import type { Meta, StoryObj } from "@storybook/react-vite";
import { userEvent, within } from "storybook/test";

import type { MainViewModel } from "../../appViewModel";
import { EMPTY_MOCKED_ROOM_DATA } from "../env";
import {
  ACCOUNTS,
  CHANGE_POWER_LEVELS,
  SWITCH_TO_DEV_BACKEND,
  appVm,
  devMainVm,
  devToolsLayout,
  mainVm,
  panelsVm,
  pickerPanel,
  roomPanel,
  roomToolsVm,
  widgetTab,
  widgetVm,
  workspace,
} from "../fixtures";
import { StoryEnv } from "../storyEnv";
import { AppShell } from "./AppShell";
import { Screen } from "./storyScreen";

/**
 * Whole screens: the app shell with the LeftBar, the SidePanel, the RoomsArea, the PiP panel,
 * modals and toasts, from one `AppViewModel`. The widgets are the fake widgets of `StoryEnv`.
 */
const meta: Meta<typeof AppShell> = {
  title: "App/AppShell",
  component: AppShell,
  // The shell applies the theme itself: follow the toolbar's theme switch instead of the system.
  render: ({ vm }, { globals }) => <Screen vm={vm} theme={globals.theme} />,
};
export default meta;
type Story = StoryObj<typeof AppShell>;

const call = widgetVm("design", "call");
const board = widgetVm("design", "board");
const poll = widgetVm("platform", "poll");
/** "Design crit" with the call open, the whiteboard in a second tab (`designCall()` of the mockups). */
const designPanel = roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]);
/** "Platform team" with its poll open. */
const platformPanel = roomPanel("platform", [widgetTab("platform", "poll")]);

/** "Design crit" (call) next to "Platform team" (poll). */
const twoRooms = (o: Partial<MainViewModel> = {}): MainViewModel => panelsVm([designPanel, platformPanel], [call, board, poll], o);

/** Focus the first element of `role` named `name`: what the keyboard shows on hover too. */
const focus = (canvasElement: HTMLElement, role: string, name: RegExp) => within(canvasElement).getByRole(role, { name }).focus();

/** Default screen: LeftBar + one room panel. */
// leaf app/default
export const Default: Story = { args: { vm: appVm() } };

/** DevBackend active: construction fence + badge. The badge sits in the LeftBar, so the mode is not signalled by the background alone. */
// leaf app/devbackend
export const DevBackendActive: Story = {
  args: {
    vm: appVm(
      devMainVm({
        roomTools: roomToolsVm({ openSections: ["timeline"] }),
        workspaces: {
          ada: workspace([]),
          [ACCOUNTS.dev.id]: workspace([roomPanel("lab", [widgetTab("lab", "call"), widgetTab("lab", "notes")])], { devTools: { [widgetVm("lab", "call").id]: devToolsLayout({ panels: [] }) } }),
        },
      }),
      true,
    ),
  },
};

/**
 * DevBackend active, LeftBar collapsed: floating badge. Without the LeftBar its badge is gone, so a
 * floating badge takes over. It stays in the fullscreen view, where no fence is visible at all.
 */
// leaf app/devbackend-collapsed
export const DevBackendCollapsed: Story = {
  args: {
    vm: appVm(
      devMainVm({
        leftBar: { collapsed: true, expandButtonVisible: false },
        sidePanel: { width: 324 },
        workspaces: { ada: workspace([]), [ACCOUNTS.dev.id]: workspace([roomPanel("lab", [widgetTab("lab", "call"), widgetTab("lab", "notes")]), roomPanel("empty", [])]) },
      }),
      true,
    ),
  },
};

/** DevBackend just activated: empty RoomsArea. Activating the DevBackend removes all panels. */
// leaf app/devbackend-empty
export const DevBackendEmpty: Story = {
  args: {
    vm: appVm(
      devMainVm({
        roomTools: roomToolsVm({ selectedRoomIds: {}, openSections: [] }),
        workspaces: { ada: workspace([]), [ACCOUNTS.dev.id]: workspace([]) },
        widgets: {},
        data: { rooms: { status: "ready", value: [] }, recentWidgets: [], recentRooms: [], localWidgets: {} },
      }),
      true,
    ),
  },
  render: ({ vm }, { globals }) => (
    <StoryEnv env={{ useMockedRoomData: () => EMPTY_MOCKED_ROOM_DATA }}>
      <Screen vm={vm} theme={globals.theme} />
    </StoryEnv>
  ),
};

/** Confirmation before an action that loses state: activating the DevBackend closes the room panels. */
// leaf app/confirm
export const Confirm: Story = { args: { vm: appVm(twoRooms({ modal: SWITCH_TO_DEV_BACKEND }), true) } };

/** App info modal: what the app is (the app icon of the LeftBar opens it). */
// leaf app/info-modal
export const InfoModal: Story = { args: { vm: appVm(mainVm({ modal: { kind: "appInfo" } })) } };

const fullscreen = panelsVm([roomPanel("design", [widgetTab("design", "call")])], [call], { leftBar: { collapsed: true, expandButtonVisible: false } });

/**
 * Fullscreen: LeftBar collapsed, one widget. No rounded containers. The room name stays. The tab of
 * the only widget is not shown, and the + button is hidden by default. Selecting the room name ends
 * the fullscreen view.
 */
// leaf app/fullscreen
export const Fullscreen: Story = { args: { vm: appVm(fullscreen) } };

/** Fullscreen, header hovered or focused: the tab and the + button appear (here the room name has the keyboard focus). */
// leaf app/fullscreen-hover
export const FullscreenHeaderFocused: Story = {
  args: { vm: appVm(fullscreen) },
  play: ({ canvasElement }) => focus(canvasElement, "tab", /Design crit/),
};

/** Narrow window: the SidePanel overlays, one room panel, the pager. */
// leaf app/narrow
export const Narrow: Story = {
  args: { vm: appVm(twoRooms({ accounts: [ACCOUNTS.ada, ACCOUNTS.work, ACCOUNTS.bot], sidePanel: { view: "account", width: 324 } })) },
  parameters: { size: [820, 800] },
  render: ({ vm }, { globals }) => (
    <StoryEnv env={{ narrow: true }}>
      <Screen vm={vm} theme={globals.theme} />
    </StoryEnv>
  ),
};

/** LeftBar collapsed with the toast that tells how to get it back. */
// leaf leftbar/collapsed-toast
export const CollapsedToast: Story = {
  args: { vm: appVm(twoRooms({ leftBar: { collapsed: true, expandButtonVisible: false }, toasts: [{ id: "collapsed", text: "Press Esc to show the expand button" }] })) },
  parameters: { size: [900, 480] },
};

/** LeftBar collapsed, expand icon revealed (after Esc). The icon appears where the collapse button was. It also appears when the mouse reaches the left screen edge. */
// leaf leftbar/collapsed-expand
export const CollapsedExpand: Story = {
  args: { vm: appVm(twoRooms({ leftBar: { collapsed: true, expandButtonVisible: true } })) },
  parameters: { size: [900, 480] },
};

/** SidePanel closed: the RoomsArea starts next to the LeftBar. */
// leaf sidepanel/closed
export const SidePanelClosed: Story = { args: { vm: appVm() }, parameters: { size: [900, 480] } };

/** Shifted by an open SidePanel (the Settings). */
// leaf roomsarea/shifted
export const ShiftedBySidePanel: Story = { args: { vm: appVm(twoRooms({ sidePanel: { view: "settings", width: 324 } })) } };

/**
 * The Room list next to the room panels: the LeftBar button pressed, the RoomsArea shifted. A pick
 * opens in the room panel that shows the room (Design crit, Platform team), else in the focused empty
 * room panel, else in a new room panel next to the focused one. In a narrow window the SidePanel
 * closes after a pick.
 */
// leaf sidepanel/rooms-app
export const RoomList: Story = { args: { vm: appVm(twoRooms({ sidePanel: { view: "rooms", width: 324 } })) } };

/**
 * The Dev tools of a Matrix account next to the room panels (LeftBar button pressed), "Switch to
 * the DevBackend" at the bottom. No fence. The dropdown offers Design crit and Platform team, the
 * rooms of the two panels; the sections are closed.
 */
// leaf roomtools/app
export const RoomTools: Story = { args: { vm: appVm(twoRooms({ sidePanel: { view: "roomTools", width: 324 }, roomTools: roomToolsVm({ openSections: [] }) }), true) } };

/**
 * Confirming a change of the room's configuration from the Dev tools. Asked for power levels, join
 * rules, encryption, history visibility, guest access, server ACL, tombstone, create event,
 * canonical alias, another user's membership and replacing a widget. Other events are sent at once.
 */
// leaf roomtools/confirm
export const RoomToolsConfirm: Story = {
  args: { vm: appVm(twoRooms({ sidePanel: { view: "roomTools", width: 324 }, roomTools: roomToolsVm({ openSections: ["state"] }), modal: CHANGE_POWER_LEVELS }), true, false) },
};

/** One room panel: "Design crit" with the whiteboard open. */
// leaf roomsarea/one
export const OnePanel: Story = {
  args: { vm: appVm(panelsVm([roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")], widgetTab("design", "board").id)], [call, board])) },
};

/** Several room panels next to each other: two rooms and a new panel with the room picker. */
// leaf roomsarea/several
export const SeveralPanels: Story = { args: { vm: appVm(panelsVm([designPanel, platformPanel, pickerPanel()], [call, board, poll])) } };

/** RoomView (2): a different room next to RoomView (1). */
// leaf roomview2/different
export const DifferentRooms: Story = {
  args: {
    vm: appVm(panelsVm([designPanel, roomPanel("rtc", [widgetTab("rtc", "notes"), widgetTab("rtc", "call")])], [call, board, widgetVm("rtc", "notes"), widgetVm("rtc", "call")])),
  },
};

/**
 * RoomView (2): the same room as RoomView (1) (Ctrl+Shift+N, in a browser tab: Alt+Shift+N). Both
 * panels show "Design crit"; the right one shows its RoomOverview. A widget runs once. The call and
 * the whiteboard are open on the left, so on the right they offer "jump to tab" and "move widget
 * here" (closes the tab on the left and opens the widget on the right; it keeps running). The poll
 * is open in the right panel itself: only "jump to tab".
 */
// leaf roomview2/same
export const SameRoomTwice: Story = {
  args: {
    vm: appVm(panelsVm([designPanel, roomPanel("design", [widgetTab("design", "poll")], null, "panel-design-2")], [call, board, widgetVm("design", "poll")])),
  },
};

/**
 * PiP enlarged, with the WidgetDevToolBar of one widget open. Hovered, so the extra "close dev
 * tools" button of the first widget is visible. Behind it the whiteboard tab is active: the call is
 * always on screen and was moved away from.
 */
// leaf pip/enlarged-devtools
export const PipEnlargedDevTools: Story = {
  args: {
    vm: appVm(
      {
        ...panelsVm(
          [roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")], widgetTab("design", "board").id)],
          [widgetVm("design", "call", { alwaysOnScreen: true }), board, widgetVm("platform", "poll", { alwaysOnScreen: true })],
          { leftBar: { collapsed: true, expandButtonVisible: false } },
          {
            devTools: { [call.id]: devToolsLayout({ size: { top: 190, side: 340 } }) },
            pip: { stacking: "horizontal", position: { x: 20, y: 20 }, boxSize: { width: 520, height: 480 } },
          },
        ),
      },
      true,
      false,
    ),
  },
  parameters: { size: [1160, 660] },
  play: async ({ canvasElement }) => {
    const pip = canvasElement.querySelector<HTMLElement>(".pip");
    if (pip) await userEvent.hover(pip);
  },
};
