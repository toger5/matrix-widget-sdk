/**
 * End to end through the generated JavaScript bindings: the real wasm module, an `InMemoryBackend`
 * constructed from JS, a JS `WidgetHostPlatform`, and a scripted widget feeding MSC4412 messages
 * into `WidgetHostDriver`. What the browser test host does by hand, without a browser.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

import initWasm from "../../widget-host-bindings/src/generated/wasm-bindgen/index.js";
import * as widgetActions from "../../widget-host-bindings/src/generated/widget_actions";
import * as hostDriver from "../../widget-host-bindings/src/generated/widget_host_driver";
import * as matrixBackend from "../../widget-host-bindings/src/generated/widget_matrix_backend";

const require = createRequire(import.meta.url);
await initWasm({ module_or_path: readFileSync(require.resolve("../../widget-host-bindings/src/generated/wasm-bindgen/index_bg.wasm")) });
widgetActions.default.initialize();
matrixBackend.default.initialize();
hostDriver.default.initialize();

/** Namespace of the actions without an MSC of their own, and of the MSC4412 core actions. */
const X = "org.matrix.mscXXXX.";
const CORE = "org.matrix.msc4412.";

type Message = { source: string; action: string; request_id: string; request?: unknown; response?: unknown };

function setup() {
  const sent: Message[] = [];
  const platform: hostDriver.WidgetHostPlatform & { openidAsked: number; navigated: string[] } = {
    openidAsked: 0,
    navigated: [],
    sendToWidget: (json) => void sent.push(JSON.parse(json)),
    onCapabilitiesRequested: (requested) => queueMicrotask(() => driver.approveCapabilities(requested)),
    onReady: () => {},
    onOpenidRequested() {
      this.openidAsked += 1;
    },
    navigate(uri) {
      this.navigated.push(uri);
    },
    setAlwaysOnScreen: (value) => value,
    clientId: () => "vitest",
    clientTheme: () => "dark",
    clientLanguage: () => "en",
  };
  const backend = new matrixBackend.InMemoryBackend("!room:example.org", "@alice:example.org");
  const driver = new hostDriver.WidgetHostDriver(backend.asBackend(), platform);
  let n = 0;
  /** Send a widget request and return the host's response to it. */
  const ask = async (action: string, request: unknown = {}) => {
    const requestId = `req-${++n}`;
    await driver.handleMessageFromWidget(JSON.stringify({ source: "widget", request_id: requestId, action, request }));
    await new Promise((r) => setTimeout(r, 0));
    const response = sent.find((m) => m.request_id === requestId && m.response !== undefined);
    if (!response) throw new Error(`no response to ${action}`);
    return response.response as Record<string, unknown>;
  };
  const drain = () => sent.splice(0);
  return { platform, backend, driver, ask, drain, sent };
}

describe("WidgetHostDriver through the JS bindings", () => {
  it("negotiates capabilities, sends, reads and receives events", async () => {
    const { backend, driver, ask, drain } = setup();
    const caps = [
      "widget:org.matrix.mscXXXX.send_event.timeline:m.room.message",
      "widget:org.matrix.msc2876.read_events.timeline:m.room.message",
      "host:org.matrix.mscXXXX.forward_event.timeline:m.room.message",
      "host:org.matrix.mscXXXX.update_state:m.room.topic",
      "widget:org.matrix.mscXXXX.send_event.delayed",
      "widget:org.matrix.msc4157.update_delayed_event",
      "widget:org.matrix.mscXXXX.send_to_device:org.example.ping",
      "host:org.matrix.mscXXXX.forward_to_device:org.example.ping",
      "host:org.matrix.mscXXXX.update_turn_servers",
      "widget:org.matrix.msc2931.navigate",
      "widget:org.matrix.mscXXXX.get_matrix_context",
    ];
    expect(await ask(`${CORE}request_capabilities`, { capabilities: caps })).toEqual({});
    await new Promise((r) => setTimeout(r, 0));
    const notify = drain().find((m) => m.action === `${CORE}update_capabilities`);
    // The strings cross the FFI unchanged, in both directions.
    expect((notify?.request as { allowed: string[] }).allowed).toEqual(caps);
    expect(driver.snapshot().approved).toEqual(caps);

    const sentEvent = await ask(`${X}send_event`, { type: "m.room.message", content: { msgtype: "m.text", body: "hi" } });
    expect(sentEvent.room_id).toBe("!room:example.org");
    expect(typeof sentEvent.event_id).toBe("string");
    // Echoed through the subscription as host -> widget forward_event.
    expect(drain().some((m) => m.source === "host" && m.action === `${X}forward_event`)).toBe(true);
    expect(backend.timeline()).toHaveLength(1);

    const read = await ask("org.matrix.msc2876.read_events", { type: "m.room.message", limit: 10 });
    expect((read.events as unknown[]).length).toBe(1);
    // The stable spelling works too; a name without a namespace is not an action.
    expect(((await ask("read_events", { type: "m.room.message" })).error as { code: string }).code).toBe(`${CORE}unknown_action`);
    expect(((await ask("m.read_events", { type: "m.room.message" })).events as unknown[]).length).toBe(1);

    const delayed = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "later" }, delay: 5000 });
    expect(typeof delayed.delay_id).toBe("string");
    expect(backend.delayedEvents()).toHaveLength(1);
    expect(await ask("org.matrix.msc4157.update_delayed_event", { delay_id: delayed.delay_id, action: "send" })).toEqual({});
    expect(backend.timeline()).toHaveLength(2);

    expect(await ask(`${X}send_to_device`, { type: "org.example.ping", encrypted: false, messages: { "@bob:example.org": { "*": { n: 1 } } } })).toEqual({});
    expect(backend.toDeviceSent()).toHaveLength(1);
    drain();
    backend.injectToDevice({ eventType: "org.example.ping", sender: "@bob:example.org", content: { n: 2 }, encrypted: true });
    const incoming = drain().find((m) => m.action === `${X}forward_to_device`);
    expect(incoming?.request).toEqual({ type: "org.example.ping", sender: "@bob:example.org", content: { n: 2 }, encrypted: true });

    expect(await ask(`${X}watch_turn_servers`)).toEqual({});
    backend.setTurnServer({ uris: ["turn:x"], username: "u", password: "p" });
    expect(drain().find((m) => m.action === `${X}update_turn_servers`)?.request).toEqual({ uris: ["turn:x"], username: "u", password: "p" });

    expect(await ask("org.matrix.msc2931.navigate", { uri: "https://matrix.to/#/#x:example.org" })).toEqual({});
    const context = await ask(`${X}get_matrix_context`);
    expect(context.user_id).toBe("@alice:example.org");

    // Missing capability -> error response naming the capability.
    const denied = await ask("org.matrix.msc3973.search_user_directory", { search_term: "a" });
    expect(denied.error).toEqual({
      code: `${CORE}missing_capability`,
      message: "Missing capability: widget:org.matrix.msc3973.search_user_directory",
    });
    // The actions' old names are unknown to the host; only the compat wrapper translates them.
    const old = await ask("org.matrix.msc3973.user_directory_search", { search_term: "a" });
    expect((old.error as { message: string }).message).toContain("Unknown action");
    expect((old.error as { code: string }).code).toBe(`${CORE}unknown_action`);
    expect(((await ask("content_loaded")).error as { code: string }).code).toBe(`${CORE}unknown_action`);
    expect(await ask(`${CORE}notify_ready`)).toEqual({});
    expect(driver.snapshot().ready).toBe(true);

    // Backend failures carry the Matrix error details.
    backend.failSends("boom");
    const failed = await ask(`${X}send_event`, { type: "m.room.message", content: {} });
    expect((failed.error as { message: string }).message).toContain("boom");

    // The host takes capabilities away: the widget gets the reduced, full list.
    drain();
    driver.revokeCapabilities(["widget:org.matrix.msc2931.navigate", "widget:org.matrix.mscXXXX.get_matrix_context"]);
    const update = drain().find((m) => m.action === `${CORE}update_capabilities`);
    expect((update?.request as { allowed: string[] }).allowed).toEqual(caps.slice(0, -2));
    const revoked = await ask("org.matrix.msc2931.navigate", { uri: "https://matrix.to/#/#x:example.org" });
    expect((revoked.error as { code: string }).code).toBe(`${CORE}missing_capability`);
  });

  it("accepts the stable namespace, emits the unstable one and grants nothing for legacy names", async () => {
    const { driver, ask, drain } = setup();
    const legacy = "org.matrix.msc2762.send.event:m.room.message";
    expect(await ask(`${CORE}request_capabilities`, { capabilities: ["widget:m.navigate", "host:m.update_state:m.room.member#@a:x", legacy] })).toEqual({});
    await new Promise((r) => setTimeout(r, 0));
    const notify = drain().find((m) => m.action === `${CORE}update_capabilities`);
    const approved = ["widget:org.matrix.msc2931.navigate", "host:org.matrix.mscXXXX.update_state:m.room.member#@a:x", legacy];
    expect((notify?.request as { allowed: string[] }).allowed).toEqual(approved);
    expect(driver.snapshot().approved).toEqual(approved);

    expect(await ask("org.matrix.msc2931.navigate", { uri: "https://matrix.to/#/#x:example.org" })).toEqual({});
    // The legacy string is kept as an unknown capability and allows nothing.
    const denied = await ask(`${X}send_event`, { type: "m.room.message", content: { body: "hi" } });
    expect((denied.error as { message: string }).message).toBe("Missing capability: widget:org.matrix.mscXXXX.send_event.timeline:m.room.message");
  });

  it("runs the two-phase OpenID flow and the client pushes", async () => {
    const { platform, driver, ask, drain } = setup();
    // The host sends nothing before the widget's first action.
    driver.updateTheme({ name: "dark" });
    expect(drain()).toEqual([]);
    // Asking for a token and every push are capabilities of their own.
    expect(((await ask(`${X}get_openid`)).error as { message: string }).message).toContain("get_openid");
    driver.updateTheme({ name: "dark" });
    expect(drain().filter((m) => m.source === "host")).toEqual([]);
    await ask(`${CORE}request_capabilities`, { capabilities: ["widget:org.matrix.mscXXXX.get_openid", "host:org.matrix.mscXXXX.update_theme", "host:org.matrix.mscXXXX.update_language", "host:org.matrix.mscXXXX.update_visibility"] });
    await new Promise((r) => setTimeout(r, 0));
    drain();

    const pending = await ask(`${X}get_openid`);
    expect(pending).toEqual({ state: "request" });
    expect(platform.openidAsked).toBe(1);
    drain();
    await driver.resolveOpenid(true);
    const creds = drain().find((m) => m.action === `${X}forward_openid_credentials`)?.request as Record<string, unknown>;
    expect(creds.state).toBe("allowed");
    expect(creds.original_request_id).toBe("req-3");
    expect(creds.matrix_server_name).toBe("matrix.example.org");

    driver.setOpenidAutoApproved(true);
    expect((await ask(`${X}get_openid`)).state).toBe("allowed");
    expect(platform.openidAsked).toBe(1);
    drain();

    driver.updateTheme({ name: "dark" });
    driver.updateLanguage("de");
    driver.updateVisibility(false);
    expect(drain().map((m) => m.action)).toEqual([`${X}update_theme`, `${X}update_language`, `${X}update_visibility`]);
  });
});
