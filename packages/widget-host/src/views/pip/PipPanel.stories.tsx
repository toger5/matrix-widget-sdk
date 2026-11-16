import type { Meta, StoryObj } from "@storybook/react-vite";

import type { WidgetInstanceViewModel } from "../../appViewModel";
import { ROOMS, byId, widgetVm } from "../fixtures";
import { storySize } from "../storyEnv";
import { WidgetView } from "../widget/WidgetView";
import { PipPanel, type PipItem, type PipPanelProps } from "./PipPanel";

/** An always-on-screen widget of a fixture room, as a PiP item. */
const item = (room: keyof typeof ROOMS, widget: Parameters<typeof widgetVm>[1], devToolsOpen = false): PipItem & { vm: WidgetInstanceViewModel } => {
  const vm = widgetVm(room, widget, { alwaysOnScreen: true });
  return { widgetId: vm.id, widgetName: vm.widget.name, roomName: ROOMS[room].name, devToolsOpen, vm };
};

const BOARD = item("design", "board");
const TIMER = item("rtc", "timer");
const POLL = item("platform", "poll");
const NOTES = item("family", "notes");
const MORE = [item("platform", "retro"), item("lab", "stream")];
const WIDGETS = byId([BOARD, TIMER, POLL, NOTES, ...MORE].map((i) => i.vm));

const PIP: PipPanelProps["pip"] = { stacking: "horizontal", position: { x: 20, y: 20 }, boxSize: { width: 224, height: 140 } };
/** The design moved the boxes by the padding of the surround (11px) when it appears; the view does not. So the hover stories start 11px further in to line up with the design. */
const HOVER_PIP: PipPanelProps["pip"] = { ...PIP, position: { x: 31, y: 31 } };

/**
 * The PictureInPicturePanel: the floating container of the always-on-screen widgets whose tab is not
 * shown, at the bottom right of the app (the story). Borderless boxes; on hover an opaque box around
 * them with the room and widget names, the buttons and the drag area.
 */
const meta: Meta<typeof PipPanel> = {
  title: "App/PipPanel",
  component: PipPanel,
  args: { pip: PIP, more: [], renderWidget: (id, options) => WIDGETS[id] && <WidgetView widget={WIDGETS[id]} compact={options?.compact} /> },
  // The panel is positioned inside the app shell.
  decorators: [
    (Story, { parameters }) => {
      const [width, height] = storySize(parameters);
      return (
        <div className="app" style={{ width, height, position: "relative" }}>
          <Story />
        </div>
      );
    },
  ],
};
export default meta;
type Story = StoryObj<typeof PipPanel>;

/** Idle: a borderless box, 1 widget. */
export const Idle: Story = { args: { items: [BOARD] }, parameters: { size: [560, 360] } };

/** Idle: borderless boxes, 4 widgets, stacked horizontal. */
export const IdleFour: Story = { args: { items: [BOARD, TIMER, POLL, NOTES] }, parameters: { size: [1040, 360] } };

/** Stacked vertical. */
export const VerticalIdle: Story = { args: { pip: { ...PIP, stacking: "vertical" }, items: [BOARD, TIMER, POLL] }, parameters: { size: [480, 560] } };

/** Hover: the surrounding box with room name, widget name and buttons. */
export const Hover: Story = { args: { items: [BOARD, TIMER, POLL], pip: HOVER_PIP, forceHover: true }, parameters: { size: [860, 360] } };

/** Hover, stacked vertical. */
export const Vertical: Story = { args: { pip: { ...HOVER_PIP, stacking: "vertical" }, items: [BOARD, TIMER], forceHover: true }, parameters: { size: [480, 500] } };

/** More widgets than fit: "+2" at the end. There is no limit on always-on-screen widgets. The panel shows four boxes; the rest is one press away. */
export const Overflow: Story = { args: { items: [BOARD, TIMER, POLL, NOTES], more: MORE }, parameters: { size: [1100, 360] } };

/** The overflow menu open. */
export const OverflowMenu: Story = { args: { items: [BOARD, TIMER, POLL, NOTES], more: MORE, pip: HOVER_PIP, forceHover: true, defaultMenuOpen: true }, parameters: { size: [1100, 420] } };
