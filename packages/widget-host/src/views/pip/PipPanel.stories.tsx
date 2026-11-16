import type { Meta, StoryObj } from "@storybook/react-vite";

import { FakeWidget } from "../storyEnv";
import { PipPanel, type PipItem, type PipPanelProps } from "./PipPanel";

const item = (roomName: string, widgetName: string, devToolsOpen = false): PipItem => ({ widgetId: `${roomName}|${widgetName}`, widgetName, roomName, devToolsOpen });

const BOARD = item("Design sync", "Whiteboard");
const TIMER = item("MatrixRTC working group", "Focus timer");
const POLL = item("Platform team", "Lunch poll");
const NOTES = item("Family", "Shared notes");
const MORE = [item("Platform team", "Retro board"), item("Widget lab", "Stream deck")];

const PIP: PipPanelProps["pip"] = { stacking: "horizontal", position: { x: 20, y: 20 }, boxSize: { width: 224, height: 140 } };
/** The mockup moves the boxes by the padding of the surround (11px) when it appears; the view does not. So the hover stories start 11px further in to line up with their leaves. */
const HOVER_PIP: PipPanelProps["pip"] = { ...PIP, position: { x: 31, y: 31 } };

const meta: Meta<typeof PipPanel> = {
  title: "App/PipPanel",
  component: PipPanel,
  args: { pip: PIP, more: [], renderWidget: (id) => <FakeWidget name={id.split("|")[1]} /> },
  // The panel is positioned inside the app shell. The max sizes let a screenshot at the size of a leaf show it.
  decorators: [
    (Story) => (
      <div className="app" style={{ width: 1100, height: 700, maxWidth: "100vw", maxHeight: "100vh", position: "relative" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof PipPanel>;

/** leaf pip/idle-1 */
export const Idle: Story = { args: { items: [BOARD] } };

/** leaf pip/hover (the leaf shows three widgets; idle it is leaf pip/idle-4) */
export const Hover: Story = { args: { items: [BOARD, TIMER, { ...POLL, devToolsOpen: true }, NOTES], pip: HOVER_PIP, forceHover: true } };

/** leaf pip/overflow-menu */
export const OverflowMenu: Story = { args: { items: [BOARD, TIMER, POLL, NOTES], more: MORE, pip: HOVER_PIP, forceHover: true, defaultMenuOpen: true } };

/** leaf pip/hover-vertical (idle: leaf pip/vertical) */
export const Vertical: Story = { args: { pip: { ...HOVER_PIP, stacking: "vertical" }, items: [BOARD, TIMER], forceHover: true } };

/** leaf pip/vertical */
export const VerticalIdle: Story = { args: { pip: { ...PIP, stacking: "vertical" }, items: [BOARD, TIMER, POLL] } };
