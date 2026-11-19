import type { Meta, StoryObj } from "@storybook/react-vite";
import { within } from "storybook/test";

import type { DevToolPanel, WidgetDevToolsData, WidgetDevToolsLayout } from "../../appViewModel";
import { DEV_TOOLS_DATA, devToolsLayout, widgetVm } from "../fixtures";
import { InDesignPanel } from "../rooms/storyFrame";
import { fillIn, StoryEnv } from "../storyEnv";
import { WidgetView } from "./WidgetView";

const X = "org.matrix.mscXXXX.";
const CAMERA = `webview:${X}allow:camera`;
const MICROPHONE = `webview:${X}allow:microphone`;
const POPUPS = `webview:${X}sandbox:allow-popups`;
/** The call widget after a restart for the camera, the microphone and popups: it holds them, and gets them without asking (its iframe has them). Sorted, as the runtime lists them. */
const WEBVIEW_DATA: WidgetDevToolsData = {
  ...DEV_TOOLS_DATA,
  capabilities: {
    approved: [`host:${X}forward_event.timeline:m.room.message`, CAMERA, MICROPHONE, POPUPS, `widget:${X}get_matrix_context`, `widget:${X}get_openid`, `widget:${X}send_event.timeline:m.room.message`],
    autoApproved: [CAMERA, MICROPHONE, POPUPS, `widget:${X}get_client_context`],
    denied: [`widget:${X}send_to_device:org.example.ping`],
    singleUse: [`widget:${X}get_openid`],
    webview: { applied: [CAMERA, MICROPHONE, POPUPS], sandbox: "allow-scripts allow-same-origin allow-popups", allow: "camera 'src'; microphone 'src'" },
  },
};

/**
 * The WidgetDevToolBar of a widget with its panels. The dev tools are part of the WidgetView (it
 * puts them at the dock position), so the stories render the whole view, in the room panel of
 * "Design crit". The bar is at the outer edge, the panels between it and the widget. The stats
 * panel has its own file.
 */
const meta: Meta<typeof WidgetView> = {
  title: "Widget/DevTools",
  component: WidgetView,
  args: { widget: widgetVm("design", "call") },
  render: (args) => (
    <InDesignPanel widget={args.widget} devTools={args.devTools}>
      <WidgetView {...args} />
    </InDesignPanel>
  ),
  parameters: { size: [1000, 640] },
};
export default meta;
type Story = StoryObj<typeof WidgetView>;

/** The dev tools docked at `dock` with `panels` open, oldest first, `size` px high (docked top or bottom) or wide (left or right). */
const layout = (dock: WidgetDevToolsLayout["dock"], panels: DevToolPanel[], size?: number): WidgetDevToolsLayout =>
  devToolsLayout({
    dock,
    panels: panels.map((panel) => ({ panel, share: 1 })),
    size: { top: dock === "top" || dock === "bottom" ? (size ?? 250) : 250, side: dock === "left" || dock === "right" ? (size ?? 340) : 340 },
  });

/** Bar only, docked top (the default). */
export const BarTop: Story = { args: { devTools: layout("top", []) }, parameters: { size: [900, 560] } };

/** Bar only, docked bottom. */
export const BarBottom: Story = { args: { devTools: layout("bottom", []) }, parameters: { size: [900, 560] } };

/** Bar only, docked left. The toggles show their labels while all of them fit the bar; a bar too short for them shows icons and badges only. */
export const BarLeft: Story = { args: { devTools: layout("left", []) }, parameters: { size: [900, 680] } };

/** Bar only, docked right. */
export const BarRight: Story = { args: { devTools: layout("right", []) }, parameters: { size: [900, 680] } };

/** One panel open (full width): the messages. */
export const OnePanel: Story = { args: { devTools: layout("top", ["messages"]) } };

/** Two panels next to each other. */
export const TwoPanels: Story = { args: { devTools: layout("top", ["messages", "stats"]) } };

/** Three panels next to each other: the maximum. */
export const ThreePanels: Story = { args: { devTools: layout("top", ["messages", "stats", "driver"], 290) }, parameters: { size: [1280, 680] } };

/** Fourth panel opened: the oldest one closes. Messages, Stats and Driver were open; pressing Console closed Messages, the oldest. Three panels are the maximum. */
export const FourthPanel: Story = { args: { devTools: layout("top", ["stats", "driver", "console"], 290) }, parameters: { size: [1280, 680] } };

/** Docked right with two panels: they stack. The vertical bar is long enough for the labelled toggles. */
export const SidePanels: Story = { args: { devTools: layout("right", ["messages", "driver"], 400) } };

/** Docked bottom with one panel: the bar stays at the edge, the panels sit between the widget and the bar, the separator above them (as when docked right). */
export const DockedBottom: Story = { args: { devTools: layout("bottom", ["messages"]) } };

/** WidgetDevToolMessagesPanel: the list, one message expanded. */
export const MessagesExpanded: Story = { args: { devTools: layout("top", ["messages"], 420), initialExpandedMessage: "m4" }, parameters: { size: [1000, 720] } };

/**
 * WidgetDevToolDriverPanel: the capabilities (approved, auto-approved, denied; the one-use one
 * marked "once"), "Webview of this load" and the mocked driver actions. This widget holds no webview
 * capability, so its iframe has the `sandbox` tokens of every widget (muted) and nothing in `allow`.
 */
export const Driver: Story = { args: { devTools: layout("top", ["driver"], 420) }, parameters: { size: [1000, 720] } };

/**
 * WidgetDevToolDriverPanel with webview capabilities. The call widget holds the camera, the
 * microphone and popups (approved, and auto-approved since its iframe has them); its webview
 * capabilities are marked "webview" in the lists. "Webview of this load" shows the `sandbox`
 * tokens and the `allow` features the current iframe was built with, those of every widget's
 * iframe muted. A webview capability is typed into the field: "Add" reads "Add and restart", as
 * adding it restarts the widget; the revoke buttons of the webview rows say so too.
 */
export const DriverWebview: Story = {
  args: { devTools: layout("right", ["driver"], 440) },
  parameters: { size: [1000, 760] },
  render: (args) => (
    <StoryEnv env={{ useDevToolsData: () => WEBVIEW_DATA }}>
      <InDesignPanel widget={args.widget} devTools={args.devTools}>
        <WidgetView {...args} />
      </InDesignPanel>
    </StoryEnv>
  ),
  play: async ({ canvasElement }) => {
    fillIn(await within(canvasElement).findByRole("textbox", { name: "Add capability" }), `webview:${X}allow:fullscreen`);
  },
};

/** WidgetDevToolConsolePanel: the log about the widget. */
export const Console: Story = { args: { devTools: layout("top", ["console"]) } };
