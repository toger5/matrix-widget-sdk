import type { Meta, StoryObj } from "@storybook/react-vite";

import { ACCOUNTS, appVm, byId, devMainVm, devToolsLayout, panelDock, panelsVm, roomPanel, roomToolsVm, widgetTab, widgetVm, workspace } from "../fixtures";
import { AppShell } from "./AppShell";
import { Screen } from "./storyScreen";

/** Whole screens with several features at once, to judge how the states of the other stories work together. */
const meta: Meta<typeof AppShell> = {
  title: "App/Complete",
  component: AppShell,
  render: ({ vm }, { globals }) => <Screen vm={vm} theme={globals.theme} />,
  parameters: { size: [1440, 900] },
};
export default meta;
type Story = StoryObj<typeof AppShell>;

const call = widgetVm("design", "call");
/** Always on screen, its tab not the active one: in the PiP panel. */
const board = widgetVm("design", "board", { alwaysOnScreen: true });

const workspacePanels = [roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]), roomPanel("platform", [widgetTab("platform", "poll")])];
const lightPanels = [roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board")]), roomPanel("rtc", [widgetTab("rtc", "notes")], null)];

/**
 * Workspace: two rooms, dev tools, AccountView, PiP. The SidePanel is open (the RoomsArea shifted),
 * the dev tools are docked on top with two panels, the whiteboard is always on screen and its tab is
 * not the active one, so it is in the floating panel (with the timer of a room no panel shows).
 */
export const Workspace: Story = {
  args: {
    vm: appVm(
      panelsVm(
        workspacePanels,
        [call, board, widgetVm("platform", "poll"), widgetVm("rtc", "timer", { alwaysOnScreen: true })],
        { accounts: [ACCOUNTS.ada, ACCOUNTS.work, ACCOUNTS.bot], sidePanel: { view: "account", width: 324 } },
        {
          dock: panelDock(workspacePanels, { shares: [1.7, 1] }),
          devTools: {
            [call.id]: devToolsLayout({
              panels: [
                { panel: "messages", share: 1 },
                { panel: "stats", share: 1 },
              ],
              size: { top: 290, side: 340 },
            }),
          },
        },
      ),
      true,
      false,
    ),
  },
};

const labCall = widgetVm("lab", "call");

/**
 * DevBackend: a mocked room, the media tool, the dev tools on the right. The construction-fence
 * background and the DevBackend badge; the DevBackendView with the Media Backend Tool open; the
 * notes are always on screen.
 */
export const DevBackend: Story = {
  args: {
    vm: appVm(
      devMainVm({
        roomTools: roomToolsVm({ openSections: ["timeline"], tools: { open: "media", heightShare: 0.5 } }),
        workspaces: {
          ada: workspace([]),
          [ACCOUNTS.dev.id]: workspace([roomPanel("lab", [widgetTab("lab", "call"), widgetTab("lab", "notes")])], {
            devTools: {
              [labCall.id]: devToolsLayout({
                dock: "right",
                panels: [
                  { panel: "messages", share: 1 },
                  { panel: "driver", share: 1 },
                ],
                size: { top: 250, side: 400 },
              }),
            },
            pip: { stacking: "horizontal", position: { x: 470, y: 690 }, boxSize: { width: 224, height: 140 } },
          }),
        },
        widgets: byId([labCall, widgetVm("lab", "notes", { alwaysOnScreen: true })]),
      }),
      true,
    ),
  },
};

/** Light theme: the overall screen in the other theme, whatever the toolbar's theme switch says. */
export const Light: Story = {
  args: {
    vm: appVm(
      panelsVm(
        lightPanels,
        [call, board, widgetVm("rtc", "notes")],
        { sidePanel: { view: "settings", width: 324 } },
        {
          dock: panelDock(lightPanels, { shares: [1.5, 1] }),
          devTools: {
            [call.id]: devToolsLayout({
              panels: [
                { panel: "messages", share: 1 },
                { panel: "driver", share: 1 },
              ],
              size: { top: 250, side: 340 },
            }),
          },
          pip: { stacking: "horizontal", position: { x: 824, y: 96 }, boxSize: { width: 224, height: 140 } },
        },
      ),
      true,
    ),
  },
  globals: { theme: "light" },
};
