/**
 * The capability prompt's copy (`src/views/widget/format.ts`, the only source): labels, sections,
 * risky capabilities and the summary sentence. What is known at all comes from the driver
 * (`capabilityIsKnown` of the bindings).
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import initWasm from "../../widget-host-bindings/src/generated/wasm-bindgen/index.js";
import * as widgetActions from "../../widget-host-bindings/src/generated/widget_actions";
import { DEFAULT_CAPABILITIES, DELAYED_CAPABILITIES, EXTRA_CAPABILITIES, RELATION_CAPABILITIES, TO_DEVICE_CAPABILITIES, WEBVIEW_CAPABILITIES } from "../../test-widgets/new/capabilities";
import { LEGACY_WEBVIEW_CAPABILITIES } from "../../widget-compat-wrapper/src/capabilities";
import { capabilityLabel, capabilityRisk, capabilitySection, capabilitySections, capabilitySummary, iframeTokens, splitCapability } from "../src/views/widget/format";

const require = createRequire(import.meta.url);
await initWasm({ module_or_path: readFileSync(require.resolve("../../widget-host-bindings/src/generated/wasm-bindgen/index_bg.wasm")) });
widgetActions.default.initialize();
const { capabilityIsKnown } = widgetActions;
/** The webview capabilities of a legacy widget, as the compat wrapper requests them. */
const LEGACY_WEBVIEW = [...LEGACY_WEBVIEW_CAPABILITIES];

const X = "org.matrix.mscXXXX.";
/** Everything the MSC4412 test widget requests: one capability per action it has a button for. */
const TEST_WIDGET = [DEFAULT_CAPABILITIES, DELAYED_CAPABILITIES, RELATION_CAPABILITIES, TO_DEVICE_CAPABILITIES, EXTRA_CAPABILITIES].join(",").split(",");
/** The webview capabilities the test widget requests with its "webview" button. */
const TEST_WIDGET_WEBVIEW = WEBVIEW_CAPABILITIES.split(",");
/** The actions the test widget has no button for. */
const OTHERS = ["widget:org.matrix.msc4533.delegate_rtc_livekit_delayed_leave", `host:${X}forward_event.sticky`];

const SHORT = [
  `widget:${X}read_timeline:m.room.message`,
  `host:${X}forward_event.timeline:m.room.message`,
  `widget:${X}send_event.timeline:m.room.message`,
  `widget:${X}send_event.delayed`,
  `widget:${X}send_to_device:org.example.ping`,
  `widget:${X}get_matrix_context`,
];
const sentence = (parts: { text: string; bold?: boolean }[]) => parts.map((p) => (p.bold ? `**${p.text}**` : p.text)).join("");

describe("capability prompt copy", () => {
  it("knows, labels and sorts every capability of the widget API", () => {
    expect(TEST_WIDGET).toHaveLength(34);
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

  it("has its sections in a fixed order, the risky ones marked", () => {
    const all = capabilitySections([...TEST_WIDGET, ...OTHERS, ...TEST_WIDGET_WEBVIEW, "garbage"], ["garbage"]);
    expect(all.map((s) => [s.id, s.title])).toEqual([
      ["read", "Read this room"],
      ["send", "Send as you"],
      ["state", "Change the room"],
      ["devices", "Direct messages to devices"],
      ["account", "You and your account"],
      ["files", "Files"],
      ["calls", "Calls"],
      ["browser", "Browser permissions"],
      ["app", "This app"],
      ["other", "Unknown to this app"],
    ]);
    // "read": `paginate_timeline` makes requests to the homeserver.
    expect(all.filter((s) => s.risky).map((s) => s.id)).toEqual(["read", "send", "state", "devices", "account", "browser"]);
    // the phrase of "You and your account" when it holds `get_openid`
    expect(all.find((s) => s.id === "account")?.phrase).toBe("prove who you are to other servers");
    expect(capabilitySections([`widget:${X}get_matrix_context`])[0].phrase).toBe("know who you are");
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
    expect(capabilityLabel(`widget:${X}read_timeline:m.room.message`)).toBe("Read the messages of this room");
    expect(capabilityLabel(`widget:${X}read_timeline:m.reaction`)).toBe("Read “m.reaction” events of this room");
    expect(capabilityLabel(`widget:${X}paginate_timeline`)).toBe("Load older events of this room");
    expect(capabilityRisk(`widget:${X}paginate_timeline`)).toBe("Makes requests to your homeserver");
    expect(capabilityLabel(`host:${X}notify_timeline_update`)).toBe("Be told when older events arrive or the history changes");
    for (const timeline of [`widget:${X}read_timeline:m.room.message`, `widget:${X}paginate_timeline`, `host:${X}notify_timeline_update`]) {
      expect(capabilitySection(timeline), timeline).toBe("read");
    }
    expect(capabilityLabel(`host:${X}update_state:m.room.member#@a:x`)).toBe("Be told the current “m.room.member#@a:x” state");
    expect(capabilityLabel("widget:com.beeper.read_room_account_data:m.tag")).toBe("Read your “m.tag” data of this room");
    expect(capabilityLabel(`widget:${X}share_screen`)).toBeUndefined();
    expect(capabilityRisk(`widget:${X}get_openid`)).toBe("Proves your identity to other servers");
  });
});

describe("browser permissions (webview capabilities)", () => {
  const W = `webview:${X}`;
  const call = [
    `widget:${X}read_timeline:m.rtc.member`,
    "widget:org.matrix.msc4533.get_rtc_livekit_token",
    `${W}allow:camera`,
    `${W}allow:microphone`,
    `${W}allow:display-capture`,
    `${W}allow:autoplay`,
    `${W}allow:fullscreen`,
  ];

  it("knows, labels and sorts the webview capabilities of the test widget and of a legacy widget", () => {
    for (const capability of [...TEST_WIDGET_WEBVIEW, ...LEGACY_WEBVIEW]) {
      expect(capabilityIsKnown(capability), capability).toBe(true);
      expect(capabilitySection(capability), capability).toBe("browser");
      expect(capabilityLabel(capability), capability).not.toMatch(/“/);
    }
    expect(capabilityLabel("webview:m.allow:camera")).toBe("Use your camera");
    expect(capabilityLabel(`${W}sandbox:allow-popups`)).toBe("Open links and windows");
    expect(splitCapability(`${W}allow:camera`)).toEqual({ side: "webview", name: `${X}allow:camera` });
  });

  it("quotes a feature or a token it has no words for", () => {
    expect(capabilityIsKnown(`${W}allow:payment`)).toBe(true);
    expect(capabilityLabel(`${W}allow:payment`)).toBe("Use “payment” of your browser");
    expect(capabilityLabel(`${W}sandbox:allow-storage-access-by-user-activation`)).toBe("Sandbox: “allow-storage-access-by-user-activation”");
    expect(capabilitySection(`${W}allow:payment`)).toBe("browser");
    expect(capabilityRisk(`${W}allow:payment`)).toBeUndefined();
  });

  it("puts what the driver refuses as a webview capability under “Unknown to this app”", () => {
    for (const capability of [`${W}allow:Camera`, `${W}allow:camera *`, `${W}allow:camera;usb`, `${W}frame:camera`]) {
      expect(capabilityIsKnown(capability), capability).toBe(false);
      expect(capabilitySection(capability, false), capability).toBe("other");
    }
  });

  it("marks the risky ones", () => {
    const risks = Object.fromEntries(
      ["allow:camera", "allow:microphone", "allow:display-capture", "allow:clipboard-read", "allow:geolocation", "allow:usb", "allow:bluetooth", "sandbox:allow-modals", "sandbox:allow-popups-to-escape-sandbox"].map((c) => [c, capabilityRisk(W + c)]),
    );
    expect(risks).toEqual({
      "allow:camera": "Can see you",
      "allow:microphone": "Can hear you",
      "allow:display-capture": "Can see your screen",
      "allow:clipboard-read": "Can read what you copied",
      "allow:geolocation": "Knows your location",
      "allow:usb": "Talks to your devices",
      "allow:bluetooth": "Talks to your devices",
      "sandbox:allow-modals": "Can block this app with dialogs",
      "sandbox:allow-popups-to-escape-sandbox": "Its windows are not sandboxed",
    });
    for (const c of ["allow:autoplay", "allow:fullscreen", "allow:clipboard-write", "allow:encrypted-media", "sandbox:allow-popups", "sandbox:allow-forms", "sandbox:allow-downloads", "sandbox:allow-presentation"]) {
      expect(capabilityRisk(W + c), c).toBeUndefined();
    }
  });

  it("says “use your camera, microphone or screen” when one of them is asked for, else “use features of your browser”", () => {
    expect(sentence(capabilitySummary("Element Call", capabilitySections(call)))).toBe("Element Call wants to **use your camera, microphone or screen**, read this room and join calls.");
    expect(sentence(capabilitySummary("Board", capabilitySections([`${W}sandbox:allow-popups`, `${W}allow:fullscreen`])))).toBe("Board wants to use features of your browser.");
    expect(sentence(capabilitySummary("Board", capabilitySections([`${W}sandbox:allow-modals`])))).toBe("Board wants to **use features of your browser**.");
    expect(sentence(capabilitySummary("Talk", capabilitySections([`${W}allow:microphone`])))).toBe("Talk wants to **use your camera, microphone or screen**.");
  });

  it("notes that approving restarts the widget, and that the browser may still ask for the camera or the microphone", () => {
    const note = (requested: string[]) => capabilitySections(requested).find((s) => s.id === "browser")?.note;
    expect(note(call)).toBe("Approving these restarts the widget. Your browser may still ask before it uses the camera or microphone.");
    expect(note([`${W}allow:display-capture`, `${W}sandbox:allow-popups`])).toBe("Approving these restarts the widget.");
    expect(capabilitySections(["garbage"], ["garbage"])[0].note).toBe("This app does not act on these.");
    expect(capabilitySections([`widget:${X}get_matrix_context`])[0].note).toBeUndefined();
  });

  it("splits the iframe's attributes into tokens, each with the webview capability it comes from", () => {
    expect(
      iframeTokens({ sandbox: "allow-scripts allow-same-origin allow-popups", allow: "camera 'src'; microphone 'src'", applied: [`${W}allow:camera`, `${W}allow:microphone`, `${W}sandbox:allow-popups`] }),
    ).toEqual({
      sandbox: [{ token: "allow-scripts" }, { token: "allow-same-origin" }, { token: "allow-popups", capability: `${W}sandbox:allow-popups` }],
      allow: [
        { token: "camera", capability: `${W}allow:camera` },
        { token: "microphone", capability: `${W}allow:microphone` },
      ],
    });
    // The strict default; a legacy widget's set names the base tokens too, which every iframe has anyway.
    expect(iframeTokens({ sandbox: "allow-scripts allow-same-origin", allow: "", applied: [] })).toEqual({ sandbox: [{ token: "allow-scripts" }, { token: "allow-same-origin" }], allow: [] });
    expect(iframeTokens({ sandbox: "allow-scripts allow-same-origin", allow: "", applied: [`${W}sandbox:allow-scripts`] }).sandbox[0]).toEqual({ token: "allow-scripts" });
  });
});
