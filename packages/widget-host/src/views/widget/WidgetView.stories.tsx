import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useRef, type ReactNode } from "react";

import type { CapabilityPromptViewModel } from "../../appViewModel";
import { widgetVm } from "../fixtures";
import { InDesignPanel } from "../rooms/storyFrame";
import { WidgetView } from "./WidgetView";

const X = "org.matrix.mscXXXX.";

// What the prompts request.
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

/** One running widget in its tab body (here in the room panel of "Design crit"): the widget, or what covers it (loading, failed, the capability prompt). */
const meta: Meta<typeof WidgetView> = {
  title: "Widget/WidgetView",
  component: WidgetView,
  args: { tab: { panelId: "panel-design", tabId: "tab-design-call" } },
  // The view fills its tab body: the stories show it in the room panel of "Design crit".
  render: (args) => (
    <InDesignPanel widget={args.widget}>
      <WidgetView {...args} />
    </InDesignPanel>
  ),
};
export default meta;
type Story = StoryObj<typeof WidgetView>;

/** Dev tools: no (full widget). The widget fills its tab body, without padding. */
export const Ready: Story = { args: { widget: widgetVm("design", "call") }, parameters: { size: [900, 560] } };

/** Loading: until the widget reports that it is ready (`notify_ready`). */
export const Loading: Story = { args: { widget: widgetVm("design", "call", { load: { state: "loading" } }) }, parameters: { size: [700, 440] } };

/** Failed to load: the error, "Retry" and "Close tab". */
export const Failed: Story = {
  args: { widget: widgetVm("design", "call", { load: { state: "failed", error: "The widget did not answer within 15 seconds." } }) },
  parameters: { size: [700, 440] },
};

/** Capability prompt: summary and sections. Everything is checked at first. The risky parts of the summary come first, in bold; a warning icon marks risky rows and their section. */
export const CapabilityPrompt: Story = {
  args: { widget: widgetVm("design", "call", { prompts: { capabilities: capabilities(SHORT) } }) },
  parameters: { size: [700, 640] },
};

/**
 * Capability prompt: a long list. The MSC4412 test widget's 33 capabilities plus one this app does
 * not know, scrolled to the end of the list. Only the sections scroll; the header and the buttons
 * stay, and the header of the section in view sticks to the top. One row of "This app" is
 * unchecked, so its checkbox is mixed.
 */
export const CapabilityPromptLong: Story = {
  parameters: { size: [700, 560] },
  args: { widget: widgetVm("design", "call", { prompts: { capabilities: capabilities(LONG, { unknown: [UNKNOWN] }) } }), initialUnchecked: [`widget:org.matrix.msc2931.navigate`] },
  render: (args) => (
    <InDesignPanel widget={args.widget}>
      <ScrolledToEnd>
        <WidgetView {...args} />
      </ScrolledToEnd>
    </InDesignPanel>
  ),
};

/**
 * Capability prompt: a second request joined, "Approve" blocked. The widget asked again while the
 * card was open: its two capabilities joined their sections, checked and marked "New"; the row the
 * user had unchecked stays unchecked. "Approve" is blocked for 3 s after the card appeared or a
 * request added to it; "Deny all" never is.
 */
export const CapabilityPromptMerged: Story = {
  parameters: { size: [700, 840] },
  args: {
    widget: widgetVm("design", "call", { prompts: { capabilities: capabilities([...SHORT, ...MORE], { added: MORE, blocked: true }) } }),
    initialUnchecked: [`widget:${X}send_event.delayed`],
  },
};

/**
 * Capability prompt: one OpenID capability, "Once", "Approve" blocked. The host grants an OpenID
 * token for one use. "Once" (the default): the widget asks again for the next token. "Always": it
 * gets every token without this card, remembered with the other approvals (else while the widget
 * runs). The choice is disabled while its row is unchecked. Variants through the args:
 * `initialAlways: [OPENID]` (set to "Always"), `initialUnchecked: [OPENID]` (the choice disabled).
 */
export const CapabilityPromptOpenId: Story = {
  parameters: { size: [700, 440] },
  args: { widget: widgetVm("design", "call", { prompts: { capabilities: capabilities([OPENID], { blocked: true }) } }), initialAlways: [], initialUnchecked: [] },
  // The card reads the initial choices once: a changed arg starts it again.
  render: (args) => (
    <InDesignPanel widget={args.widget}>
      <WidgetView key={JSON.stringify([args.initialAlways, args.initialUnchecked])} {...args} />
    </InDesignPanel>
  ),
};

/** The capability prompt in a PiP box (224×140): one line and "Open to answer" (not designed: finding `compact-failed-state`). */
export const CompactPrompt: Story = {
  parameters: { size: [256, 172] },
  render: (args) => (
    <div style={{ width: 224, height: 140, flex: "none", display: "flex", alignSelf: "center", margin: 16 }}>
      <WidgetView {...args} compact widget={widgetVm("design", "board", { prompts: { capabilities: capabilities([`widget:${X}get_matrix_context`]) } })} />
    </div>
  ),
};
