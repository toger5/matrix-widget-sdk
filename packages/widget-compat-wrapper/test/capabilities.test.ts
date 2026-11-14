import { describe, expect, it } from "vitest";

import {
  capabilitiesToRequest,
  collapseApproved,
  expandLegacyCapability,
  hostCapability,
  IMPLICIT_CAPABILITIES,
  normalizeCapability,
  widgetCapability,
} from "../src/capabilities";

const W = "widget:org.matrix.mscXXXX.";
const H = "host:org.matrix.mscXXXX.";

/** Every legacy capability: [unstable spelling, stable spelling (if it has one), expansion]. */
const MIGRATION: [string, string | undefined, string[]][] = [
  ["org.matrix.msc2762.send.event:m.room.message", "m.send.event:m.room.message", [`${W}send_event.timeline:m.room.message`]],
  ["org.matrix.msc2762.send.state_event:m.room.topic", "m.send.state_event:m.room.topic", [`${W}send_event.state:m.room.topic`]],
  [
    "org.matrix.msc2762.receive.event:m.room.message",
    "m.receive.event:m.room.message",
    [`${W}read_events.timeline:m.room.message`, `${W}read_relations:m.room.message`, `${H}forward_event.timeline:m.room.message`],
  ],
  [
    "org.matrix.msc2762.receive.state_event:m.room.member",
    "m.receive.state_event:m.room.member",
    [`${W}read_events.state:m.room.member`, `${H}update_state:m.room.member`, `${H}forward_event.state:m.room.member`],
  ],
  ["org.matrix.msc3819.send.to_device:m.call.invite", "m.send.to_device:m.call.invite", [`${W}send_to_device:m.call.invite`]],
  ["org.matrix.msc3819.receive.to_device:m.call.invite", "m.receive.to_device:m.call.invite", [`${H}forward_to_device:m.call.invite`]],
  ["com.beeper.capabilities.receive.room_account_data:m.tag", "m.receive.room_account_data:m.tag", [`${W}read_room_account_data:m.tag`]],
  ["org.matrix.msc4157.send.delayed_event", "m.send.delayed_event", [`${W}send_event.delayed`]],
  ["org.matrix.msc4157.update_delayed_event", "m.update_delayed_event", [`${W}update_delayed_event`]],
  ["org.matrix.msc4407.send.sticky_event", "m.send.sticky_event", [`${W}send_event.sticky`]],
  ["org.matrix.msc4407.receive.sticky_event", "m.receive.sticky_event", [`${H}forward_event.sticky`]],
  ["town.robin.msc3846.turn_servers", "m.turn_servers", [`${H}update_turn_servers`]],
  ["org.matrix.msc4515.rtc_transports", "m.rtc_transports", [`${W}get_rtc_transports`]],
  ["org.matrix.msc3973.user_directory_search", "m.user_directory_search", [`${W}search_user_directory`]],
  ["org.matrix.msc4039.upload_file", "m.upload_file", [`${W}upload_file`, `${W}get_media_config`]],
  ["org.matrix.msc4039.download_file", "m.download_file", [`${W}download_file`]],
  ["org.matrix.msc2931.navigate", "m.navigate", [`${W}navigate`]],
  ["org.matrix.msc4533.rtc_livekit_get_token", "m.rtc_livekit_get_token", [`${W}get_rtc_livekit_token`]],
  [
    "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave",
    "m.rtc_livekit_delegate_delayed_leave",
    [`${W}delegate_rtc_livekit_delayed_leave`],
  ],
  ["m.always_on_screen", undefined, [`${W}set_always_on_screen`]],
];

describe("new capability names", () => {
  it("are `source:namespace.action[.modifier][:data]` in the unstable namespace", () => {
    expect(widgetCapability("send_event.timeline:m.room.message")).toBe("widget:org.matrix.mscXXXX.send_event.timeline:m.room.message");
    expect(hostCapability("update_theme")).toBe("host:org.matrix.mscXXXX.update_theme");
  });

  it("every capability the wrapper can request follows the schema", () => {
    const schema =
      /^(widget|host):org\.matrix\.mscXXXX\.[a-z_]+(\.(timeline|state|delayed|sticky))?(:.+)?$/;
    const all = [...IMPLICIT_CAPABILITIES, ...MIGRATION.flatMap(([, , expansion]) => expansion)];
    for (const capability of all) expect(capability).toMatch(schema);
    // Actions with modifiers never appear without one, and no capability names a room.
    for (const capability of all) {
      expect(capability).not.toMatch(/\.(send_event|read_events|forward_event)(:|$)/);
      expect(capability).not.toMatch(/\.room(:|$)/);
    }
  });
});

describe("expandLegacyCapability", () => {
  it.each(MIGRATION)("%s", (unstable, stable, expansion) => {
    expect(expandLegacyCapability(unstable)).toEqual(expansion);
    if (stable) expect(expandLegacyCapability(stable)).toEqual(expansion);
  });

  it("keeps the msgtype and the state key of the event type", () => {
    expect(expandLegacyCapability("org.matrix.msc2762.send.event:m.room.message#m.text")).toEqual([
      `${W}send_event.timeline:m.room.message#m.text`,
    ]);
    expect(expandLegacyCapability("org.matrix.msc2762.receive.event:m.room.message#m.text")).toEqual([
      `${W}read_events.timeline:m.room.message#m.text`,
      `${W}read_relations:m.room.message#m.text`,
      `${H}forward_event.timeline:m.room.message#m.text`,
    ]);
    expect(expandLegacyCapability("org.matrix.msc2762.receive.state_event:m.room.member#@alice:example.org")).toEqual([
      `${W}read_events.state:m.room.member#@alice:example.org`,
      `${H}update_state:m.room.member#@alice:example.org`,
      `${H}forward_event.state:m.room.member#@alice:example.org`,
    ]);
    // A trailing `#` is the empty state key.
    expect(expandLegacyCapability("m.send.state_event:m.room.topic#")).toEqual([`${W}send_event.state:m.room.topic#`]);
  });

  it("expands the timeline capability to nothing: other rooms cannot be reached", () => {
    expect(expandLegacyCapability("org.matrix.msc2762.timeline:!room:example.org")).toEqual([]);
    expect(expandLegacyCapability("org.matrix.msc2762.timeline:*")).toEqual([]);
    expect(expandLegacyCapability("m.timeline:!room:example.org")).toEqual([]);
  });

  it("passes unknown strings through unchanged", () => {
    for (const raw of [
      "m.sticker",
      "m.capability.screenshot",
      "io.element.requires_client",
      "org.example.custom",
      // already a new capability
      `${W}navigate`,
      // a known body behind another MSC's prefix
      "org.matrix.msc3819.send.event:m.room.message",
      // a typed capability without a type, an untyped one with a suffix
      "org.matrix.msc2762.send.event:",
      "org.matrix.msc2931.navigate.more",
      "org.matrix.msc4039.upload_files",
    ]) {
      expect(expandLegacyCapability(raw)).toEqual([raw]);
    }
  });
});

describe("capabilitiesToRequest", () => {
  it("always includes what the legacy api allowed without a capability", () => {
    expect(IMPLICIT_CAPABILITIES).toEqual([`${W}get_openid`, `${H}update_theme`, `${H}update_language`, `${H}update_visibility`]);
    expect(capabilitiesToRequest([])).toEqual(IMPLICIT_CAPABILITIES);
  });

  it("expands every legacy capability, drops the timeline capability and removes duplicates", () => {
    expect(
      capabilitiesToRequest([
        "org.matrix.msc2762.send.event:m.room.message",
        "m.send.event:m.room.message",
        "org.matrix.msc2762.timeline:*",
        "org.matrix.msc4039.upload_file",
        "m.sticker",
      ]),
    ).toEqual([...IMPLICIT_CAPABILITIES, `${W}send_event.timeline:m.room.message`, `${W}upload_file`, `${W}get_media_config`, "m.sticker"]);
  });
});

describe("collapseApproved", () => {
  const receive = "org.matrix.msc2762.receive.event:m.room.message";
  const [read, relations, forward] = expandLegacyCapability(receive);

  it("reports a legacy capability when its whole expansion is approved", () => {
    expect(collapseApproved([receive], [read, relations, forward])).toEqual([receive]);
    // in the widget's own spelling, whichever it used
    expect(collapseApproved(["m.receive.event:m.room.message"], [read, relations, forward])).toEqual(["m.receive.event:m.room.message"]);
  });

  it("does not report a partially approved capability", () => {
    expect(collapseApproved([receive], [read, forward])).toEqual([]);
    expect(collapseApproved([receive], [])).toEqual([]);
    expect(collapseApproved(["org.matrix.msc4039.upload_file"], [`${W}upload_file`])).toEqual([]);
  });

  it("never reports the timeline capability", () => {
    const timeline = "org.matrix.msc2762.timeline:*";
    expect(collapseApproved([timeline], [timeline, ...IMPLICIT_CAPABILITIES])).toEqual([]);
  });

  it("accepts the host's answer in the stable namespace", () => {
    expect(normalizeCapability("widget:m.navigate")).toBe(`${W}navigate`);
    expect(normalizeCapability("host:m.update_state:m.room.member#@a:x")).toBe(`${H}update_state:m.room.member#@a:x`);
    expect(normalizeCapability(`${W}navigate`)).toBe(`${W}navigate`);
    expect(normalizeCapability("m.sticker")).toBe("m.sticker");
    expect(
      collapseApproved([receive], ["widget:m.read_events.timeline:m.room.message", "widget:m.read_relations:m.room.message", "host:m.forward_event.timeline:m.room.message"]),
    ).toEqual([receive]);
  });

  it("keeps the requested order, reports each capability once and ignores the implicit ones", () => {
    const navigate = "org.matrix.msc2931.navigate";
    const approved = [...IMPLICIT_CAPABILITIES, `${W}navigate`, read, relations, forward, "m.sticker"];
    expect(collapseApproved([navigate, "m.sticker", receive, navigate], approved)).toEqual([navigate, "m.sticker", receive]);
    // Only what the widget asked for is reported, whatever else the host approved.
    expect(collapseApproved([navigate], approved)).toEqual([navigate]);
  });

  it("round-trips: approving the full request approves every legacy capability but timeline", () => {
    const legacy = MIGRATION.map(([unstable]) => unstable);
    expect(collapseApproved([...legacy, "org.matrix.msc2762.timeline:*"], capabilitiesToRequest(legacy))).toEqual(legacy);
  });
});
