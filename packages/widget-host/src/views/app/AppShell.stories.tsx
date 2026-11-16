import type { Meta, StoryObj } from "@storybook/react-vite";

import type { MainViewModel, SettingsViewModel } from "../../appViewModel";
import { appVm, devMainVm, mainVm, overviewTab, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
import { StoryEnv } from "../storyEnv";
import { AppShell } from "./AppShell";

const meta: Meta<typeof AppShell> = {
  title: "App/AppShell",
  component: AppShell,
  // The shell applies the theme itself: follow the toolbar's theme switch instead of the system.
  render: ({ vm }, { globals }) => (
    <div style={{ height: "100vh" }}>
      <AppShell vm={{ ...vm, settings: { ...vm.settings, theme: globals.theme as SettingsViewModel["theme"] } }} />
    </div>
  ),
};
export default meta;
type Story = StoryObj<typeof AppShell>;

/** "Design crit" (call) next to "Platform team" (poll). */
const twoRooms = (o: Partial<MainViewModel> = {}): MainViewModel => {
  const widgets = [widgetVm("design", "call"), widgetVm("design", "board"), widgetVm("platform", "poll")];
  return mainVm({
    workspaces: {
      ada: workspace([roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), overviewTab("design")]), roomPanel("platform", [widgetTab("platform", "poll"), overviewTab("platform")])]),
    },
    widgets: Object.fromEntries(widgets.map((w) => [w.id, w])),
    ...o,
  });
};

export const Default: Story = { args: { vm: appVm() } }; // leaf app/default

export const DevBackendActive: Story = { args: { vm: appVm(devMainVm(), true) } }; // leaf app/devbackend

// leaf leftbar/collapsed-toast (900 x 480)
export const CollapsedToast: Story = {
  args: { vm: appVm(twoRooms({ leftBar: { collapsed: true, expandButtonVisible: false }, toasts: [{ id: "collapsed", text: "Press Esc to show the expand button" }] })) },
};

// leaf app/devbackend-collapsed, with the expand button of leaf leftbar/collapsed-expand
export const DevBackendCollapsed: Story = {
  args: { vm: appVm(devMainVm({ leftBar: { collapsed: true, expandButtonVisible: true }, sidePanel: { width: 324 } }), true) },
};

// leaf app/narrow (820 x 800): the SidePanel overlays, one room panel, the pager
export const Narrow: Story = {
  args: { vm: appVm(twoRooms({ sidePanel: { view: "account", width: 324 } })) },
  render: ({ vm }, { globals }) => (
    <StoryEnv env={{ narrow: true }}>
      <div style={{ height: "100vh" }}>
        <AppShell vm={{ ...vm, settings: { ...vm.settings, theme: globals.theme as SettingsViewModel["theme"] } }} />
      </div>
    </StoryEnv>
  ),
};
