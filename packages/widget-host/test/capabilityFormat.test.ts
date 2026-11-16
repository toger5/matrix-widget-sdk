/**
 * The capability prompt's copy (`src/views/widget/format.ts`): labels, sections, risky
 * capabilities and the summary sentence. They follow the mockups (`design/src/lib.mjs`), and what
 * is known at all comes from the driver (`capabilityIsKnown` of the bindings).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import initWasm from "../../widget-host-bindings/src/generated/wasm-bindgen/index.js";
import * as widgetActions from "../../widget-host-bindings/src/generated/widget_actions";
import { DEFAULT_CAPABILITIES, DELAYED_CAPABILITIES, EXTRA_CAPABILITIES, RELATION_CAPABILITIES, TO_DEVICE_CAPABILITIES } from "../../test-widgets/new/capabilities";
// @ts-expect-error -- plain JavaScript without types
import { CAP_LABELS, CAP_RISKS, CAP_SECTIONS, OPENID_PHRASE } from "../design/src/lib.mjs";
import { capabilityLabel, capabilityRisk, capabilitySection, capabilitySections, capabilitySummary } from "../src/views/widget/format";

const require = createRequire(import.meta.url);
await initWasm({ module_or_path: readFileSync(require.resolve("../../widget-host-bindings/src/generated/wasm-bindgen/index_bg.wasm")) });
widgetActions.default.initialize();
const { capabilityIsKnown } = widgetActions;

const X = "org.matrix.mscXXXX.";
/** Everything the MSC4412 test widget requests: one capability per action it has a button for. */
const TEST_WIDGET = [DEFAULT_CAPABILITIES, DELAYED_CAPABILITIES, RELATION_CAPABILITIES, TO_DEVICE_CAPABILITIES, EXTRA_CAPABILITIES].join(",").split(",");
/** The actions the test widget has no button for. */
const OTHERS = ["widget:org.matrix.msc4533.delegate_rtc_livekit_delayed_leave", `host:${X}forward_event.sticky`];

const SHORT = [
  "widget:org.matrix.msc2876.read_events.timeline:m.room.message",
  `host:${X}forward_event.timeline:m.room.message`,
  `widget:${X}send_event.timeline:m.room.message`,
  `widget:${X}send_event.delayed`,
  `widget:${X}send_to_device:org.example.ping`,
  `widget:${X}get_matrix_context`,
];
const sentence = (parts: { text: string; bold?: boolean }[]) => parts.map((p) => (p.bold ? `**${p.text}**` : p.text)).join("");

describe("capability prompt copy", () => {
  it("knows, labels and sorts every capability of the widget API", () => {
    expect(TEST_WIDGET).toHaveLength(33);
    for (const capability of [...TEST_WIDGET, ...OTHERS]) {
      expect(capabilityIsKnown(capability), capability).toBe(true);
      expect(capabilityLabel(capability), capability).toBeTruthy();
      expect(capabilitySection(capability), capability).not.toBe("other");
    }
    // The stable namespace too.
    expect(capabilityIsKnown("widget:m.navigate")).toBe(true);
    expect(capabilityLabel("widget:m.navigate")).toBe("Open links to rooms and users");
    expect(capabilitySection("widget:m.send_event.state:m.room.topic")).toBe("state");
  });

  it("puts what the driver does not know under “Unknown to this app”, also a known action name under a foreign namespace", () => {
    const unknown = ["widget:org.example.custom.share_screen", `widget:${X}navigate`, "org.matrix.msc2762.send.event:m.room.message", "garbage"];
    for (const capability of unknown) {
      expect(capabilityIsKnown(capability), capability).toBe(false);
      expect(capabilitySection(capability, false), capability).toBe("other");
    }
    // The label table alone would take the foreign `navigate` for the real one: the driver decides.
    expect(capabilitySection(`widget:${X}navigate`)).toBe("app");
    const sections = capabilitySections([`widget:${X}navigate`, "widget:org.matrix.msc2931.navigate"], [`widget:${X}navigate`]);
    expect(sections.map((s) => [s.id, s.capabilities])).toEqual([
      ["app", ["widget:org.matrix.msc2931.navigate"]],
      ["other", [`widget:${X}navigate`]],
    ]);
    expect(sections[1]).toMatchObject({ title: "Unknown to this app", phrase: "ask for one thing this app does not know", risky: false });
    expect(capabilitySections(["a", "b"], ["a", "b"])[0].phrase).toBe("ask for 2 things this app does not know");
  });

  it("has the labels, sections and risks of the mockups", () => {
    const keys = Object.keys(CAP_LABELS as Record<string, unknown>);
    expect(keys).toHaveLength(31);
    for (const key of keys) {
      const [source, head] = key.split(":");
      for (const data of ["m.room.message", "org.example.x"]) {
        const capability = `${source}:m.${head}:${data}`;
        expect(capabilityLabel(capability), capability).toBe((CAP_LABELS as Record<string, (t: string) => string>)[key](data));
        expect(capabilityRisk(capability), capability).toBe((CAP_RISKS as Record<string, string | undefined>)[key]);
        const action = key.split(".")[0];
        const section = (CAP_SECTIONS as [string, string, string, string[]][]).find(([, , , members]) => members.includes(key) || members.includes(action));
        expect(capabilitySection(capability), capability).toBe(section?.[0]);
      }
    }
    // Section titles and phrases, in their order.
    const all = capabilitySections(keys.map((key) => `${key.split(":")[0]}:m.${key.split(":")[1]}:m.x`));
    expect(all.map((s) => [s.id, s.title])).toEqual((CAP_SECTIONS as string[][]).map(([id, title]) => [id, title]));
    expect(all.find((s) => s.id === "account")?.phrase).toBe(OPENID_PHRASE);
  });

  it("orders the sections, whatever the order of the request, and counts on the risky ones", () => {
    const sections = capabilitySections([...SHORT].reverse());
    expect(sections.map((s) => s.id)).toEqual(["read", "send", "devices", "account"]);
    expect(sections.map((s) => s.risky)).toEqual([false, true, true, false]);
    expect(sections[1].capabilities).toEqual([`widget:${X}send_event.delayed`, `widget:${X}send_event.timeline:m.room.message`]);
  });

  it("writes the summary in plain words, the risky parts first and in bold", () => {
    expect(sentence(capabilitySummary("Element Call", capabilitySections(SHORT)))).toBe(
      "Element Call wants to **send messages as you**, **exchange hidden messages with devices**, read this room and know who you are.",
    );
    const merged = capabilitySections([...SHORT, `widget:${X}send_event.state:m.room.topic`, `widget:${X}get_openid`]);
    expect(sentence(capabilitySummary("Element Call", merged))).toBe(
      "Element Call wants to **send messages as you**, **change the room for everyone**, **exchange hidden messages with devices**, **prove who you are to other servers** and read this room.",
    );
    expect(sentence(capabilitySummary("Poll", capabilitySections([`widget:${X}get_matrix_context`])))).toBe("Poll wants to know who you are.");
  });

  it("labels with the event type of the capability", () => {
    expect(capabilityLabel("widget:org.matrix.msc2876.read_events.timeline:m.room.message")).toBe("Read the messages of this room");
    expect(capabilityLabel("widget:org.matrix.msc2876.read_events.state:m.room.topic")).toBe("Read the “m.room.topic” state of this room");
    expect(capabilityLabel(`host:${X}update_state:m.room.member#@a:x`)).toBe("Be told the current “m.room.member#@a:x” state");
    expect(capabilityLabel("widget:com.beeper.read_room_account_data:m.tag")).toBe("Read your “m.tag” data of this room");
    expect(capabilityLabel(`widget:${X}share_screen`)).toBeUndefined();
    expect(capabilityRisk(`widget:${X}get_openid`)).toBe("Proves your identity to other servers");
  });
});
