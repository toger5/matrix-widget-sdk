import type { Meta, StoryObj } from "@storybook/react-vite";

import { widgetVm } from "../fixtures";
import { FakeWidget } from "../storyEnv";
import { WidgetView } from "./WidgetView";

const X = "org.matrix.mscXXXX.";

const meta: Meta<typeof WidgetView> = {
  title: "Widget/WidgetView",
  component: WidgetView,
  args: { standIn: <FakeWidget name="Element Call" />, tab: { panelId: "panel-design", tabId: "tab-design-call" } },
  // The view fills its tab body: the wrapper stands in for it (the screenshot viewport sets the size).
  decorators: [
    (Story) => (
      <div style={{ width: "100%", height: "100vh", minHeight: 300, display: "flex" }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;
type Story = StoryObj<typeof WidgetView>;

/** leaf widgetview/plain */
export const Ready: Story = { args: { widget: widgetVm("design", "call") } };

/** leaf widgetview/loading */
export const Loading: Story = { args: { widget: widgetVm("design", "call", { load: { state: "loading" } }) } };

/** leaf widgetview/failed */
export const Failed: Story = { args: { widget: widgetVm("design", "call", { load: { state: "failed", error: "The widget did not answer within 15 seconds." } }) } };

/** leaf widgetview/prompt */
export const CapabilityPrompt: Story = {
  args: {
    widget: widgetVm("design", "call", {
      load: { state: "loading" },
      prompts: {
        capabilities: {
          requested: [`widget:${X}get_matrix_context`, `widget:${X}read_events.timeline:m.room.message`, `widget:${X}send_event.timeline:m.room.message`, `widget:${X}send_event.delayed`, `widget:${X}send_to_device:org.example.ping`],
        },
        openId: true,
      },
    }),
  },
};

/** No leaf: the OpenID card, and the compact strip of a PiP box (224×140). */
export const OpenIdPromptAndCompact: Story = {
  render: (args) => (
    <>
      <WidgetView {...args} widget={widgetVm("design", "call", { prompts: { openId: true } })} />
      <div style={{ width: 224, height: 140, flex: "none", display: "flex", alignSelf: "center", margin: 16 }}>
        <WidgetView {...args} compact widget={widgetVm("design", "board", { prompts: { capabilities: { requested: [`widget:${X}get_matrix_context`] } } })} />
      </div>
    </>
  ),
};
