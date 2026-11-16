import type { Meta, StoryObj } from "@storybook/react-vite";

import { devMainVm, mainVm, overviewTab, roomPanel, widgetTab, widgetVm, workspace } from "../fixtures";
import { RoomsArea } from "./RoomsArea";
import { AppFrame, SETTINGS, fakeWidget } from "./storyFrame";

const meta: Meta<typeof RoomsArea> = {
  title: "Rooms/RoomsArea",
  component: RoomsArea,
  render: (args) => (
    <AppFrame fence={args.main.activeAccountId === "devBackend"} fullscreen={args.fullscreen}>
      <RoomsArea {...args} renderWidget={fakeWidget(args.main)} />
    </AppFrame>
  ),
  args: { settings: SETTINGS, fullscreen: false },
};
export default meta;
type Story = StoryObj<typeof RoomsArea>;

// leaf widgetview/plain (the RoomsArea of app/default): one panel, "Design crit" with the call widget open
export const OnePanel: Story = { args: { main: mainVm() } };

const twoRooms = [widgetVm("design", "call"), widgetVm("design", "board"), widgetVm("rtc", "notes"), widgetVm("rtc", "call")];
// leaf roomview2/different: a different room next to the first one, with the drag handle between them
export const TwoPanels: Story = {
  args: {
    main: mainVm({
      workspaces: {
        ada: workspace([
          roomPanel("design", [widgetTab("design", "call"), widgetTab("design", "board"), overviewTab("design")]),
          roomPanel("rtc", [widgetTab("rtc", "notes"), widgetTab("rtc", "call")]),
        ]),
      },
      widgets: Object.fromEntries(twoRooms.map((w) => [w.id, w])),
    }),
  },
};

// leaf app/devbackend-empty: the DevBackend was just activated, no panel is open
export const Empty: Story = { args: { main: devMainVm({ workspaces: { devBackend: workspace([]) }, widgets: {} }) } };

// leaf app/fullscreen (hover or focus the header for app/fullscreen-hover): one widget, no rounded container
export const Fullscreen: Story = {
  args: {
    fullscreen: true,
    main: mainVm({ leftBar: { collapsed: true, expandButtonVisible: false }, workspaces: { ada: workspace([roomPanel("design", [widgetTab("design", "call")])]) } }),
  },
};
