import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, type ReactNode } from "react";

import type { CapabilityPromptViewModel } from "../../appViewModel";
import { widgetVm } from "../fixtures";
import { FakeWidget } from "../storyEnv";
import { WidgetView } from "./WidgetView";

const X = "org.matrix.mscXXXX.";

// What the leaves request (`CAP_REQUESTS` of design/src/lib.mjs).
const SHORT = [
  `widget:org.matrix.msc2876.read_events.timeline:m.room.message`,
  `host:${X}forward_event.timeline:m.room.message`,
  `widget:${X}send_event.timeline:m.room.message`,
  `widget:${X}send_event.delayed`,
  `widget:${X}send_to_device:org.example.ping`,
  `widget:${X}get_matrix_context`,
];
/** The capability the host grants for one use (the driver's `single_use`). */
const OPENID = `widget:${X}get_openid`;
/** A second request while the short one is open. */
const MORE = [`widget:${X}send_event.state:m.room.topic`, OPENID];
/** The MSC4412 test widget's capabilities (packages/test-widgets/new/capabilities.ts) plus one this app does not know. */
const UNKNOWN = "widget:org.example.custom.share_screen";
const LONG = [
  `widget:${X}send_event.timeline:m.room.message`,
  `widget:org.matrix.msc2876.read_events.timeline:m.room.message`,
  `host:${X}forward_event.timeline:m.room.message`,
  `widget:${X}send_event.state:m.room.topic`,
  `widget:org.matrix.msc2876.read_events.state:m.room.topic`,
  `host:${X}update_state:m.room.topic`,
  `host:${X}forward_event.state:m.room.topic`,
  `widget:${X}send_event.delayed`,
  `widget:org.matrix.msc4157.update_delayed_event`,
  `widget:${X}send_event.sticky`,
  `widget:${X}send_event.timeline:m.rtc.member`,
  `widget:${X}send_event.timeline:m.reaction`,
  `widget:org.matrix.msc2876.read_events.timeline:m.reaction`,
  `widget:org.matrix.msc3869.read_relations:m.reaction`,
  `host:${X}forward_event.timeline:m.reaction`,
  `widget:${X}send_to_device:org.example.ping`,
  `host:${X}forward_to_device:org.example.ping`,
  `host:${X}update_turn_servers`,
  `widget:org.matrix.msc4515.get_rtc_transports`,
  `widget:org.matrix.msc3973.search_user_directory`,
  `widget:org.matrix.msc4039.get_media_config`,
  `widget:org.matrix.msc4039.upload_file`,
  `widget:org.matrix.msc4039.download_file`,
  `widget:com.beeper.read_room_account_data:m.tag`,
  `widget:org.matrix.msc4533.get_rtc_livekit_token`,
  `widget:org.matrix.msc2931.navigate`,
  `widget:${X}set_always_on_screen`,
  `widget:${X}get_openid`,
  `widget:${X}get_matrix_context`,
  `widget:${X}get_client_context`,
  `host:${X}update_theme`,
  `host:${X}update_language`,
  `host:${X}update_visibility`,
  UNKNOWN,
];

/** A capability prompt; `blocked`: "Approve" stays blocked (the last request is "now" for as long as the story is shown). */
const capabilities = (requested: string[], o: { added?: string[]; unknown?: string[]; blocked?: boolean } = {}): CapabilityPromptViewModel => ({
  requested,
  added: o.added ?? [],
  unknown: o.unknown ?? [],
  singleUse: requested.filter((c) => c === OPENID),
  lastRequestAt: o.blocked ? Number.MAX_SAFE_INTEGER / 2 : 0,
});

/** Story only: shows the sections of the permission card scrolled to their end. */
function ScrolledToEnd({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const body = ref.current?.querySelector(".pc-body");
    if (body) body.scrollTop = body.scrollHeight;
  });
  return (
    <div ref={ref} style={{ display: "contents" }}>
      {children}
    </div>
  );
}

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
  args: { widget: widgetVm("design", "call", { load: { state: "loading" }, prompts: { capabilities: capabilities(SHORT) } }) },
};

/** leaf widgetview/prompt-long: one row of "This app" unchecked, scrolled to the end */
export const CapabilityPromptLong: Story = {
  args: { widget: widgetVm("design", "call", { prompts: { capabilities: capabilities(LONG, { unknown: [UNKNOWN] }) } }), initialUnchecked: [`widget:org.matrix.msc2931.navigate`] },
  render: (args) => (
    <ScrolledToEnd>
      <WidgetView {...args} />
    </ScrolledToEnd>
  ),
};

/** leaf widgetview/prompt-merged: a second request joined, one earlier row unchecked, "Approve" blocked */
export const CapabilityPromptMerged: Story = {
  args: {
    widget: widgetVm("design", "call", { prompts: { capabilities: capabilities([...SHORT, ...MORE], { added: MORE, blocked: true }) } }),
    initialUnchecked: [`widget:${X}send_event.delayed`],
  },
};

/**
 * leaf widgetview/prompt-openid: one OpenID capability, "Once", "Approve" blocked. Variants through
 * the args: `initialAlways: [OPENID]` (set to "Always"), `initialUnchecked: [OPENID]` (the choice disabled).
 */
export const CapabilityPromptOpenId: Story = {
  args: { widget: widgetVm("design", "call", { prompts: { capabilities: capabilities([OPENID], { blocked: true }) } }), initialAlways: [], initialUnchecked: [] },
  // The card reads the initial choices once: a changed arg starts it again.
  render: (args) => <WidgetView key={JSON.stringify([args.initialAlways, args.initialUnchecked])} {...args} />,
};

/** No leaf: the compact strip of a PiP box (224×140). */
export const CompactPrompt: Story = {
  render: (args) => (
    <div style={{ width: 224, height: 140, flex: "none", display: "flex", alignSelf: "center", margin: 16 }}>
      <WidgetView {...args} compact widget={widgetVm("design", "board", { prompts: { capabilities: capabilities([`widget:${X}get_matrix_context`]) } })} />
    </div>
  ),
};
