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

type Message = { source: string; action: string; requestId: string; request?: unknown; response?: unknown };

function setup() {
  const sent: Message[] = [];
  const platform: hostDriver.WidgetHostPlatform & { openidAsked: number; navigated: string[] } = {
    openidAsked: 0,
    navigated: [],
    sendToWidget: (json) => void sent.push(JSON.parse(json)),
    onCapabilitiesRequested: (requested) => queueMicrotask(() => driver.approveCapabilities(requested)),
    onContentLoaded: () => {},
    onOpenidRequested() {
      this.openidAsked += 1;
    },
    navigate(uri) {
      this.navigated.push(uri);
    },
    sendSticker: () => {},
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
    await driver.handleMessageFromWidget(JSON.stringify({ source: "widget", version: "v1", requestId, action, request }));
    await new Promise((r) => setTimeout(r, 0));
    const response = sent.find((m) => m.requestId === requestId && m.response !== undefined);
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
      "org.matrix.msc2762.send.event:m.room.message",
      "org.matrix.msc2762.receive.event:m.room.message",
      "org.matrix.msc2762.receive.state_event:m.room.topic",
      "org.matrix.msc4157.send.delayed_event",
      "org.matrix.msc4157.update_delayed_event",
      "org.matrix.msc3819.send.to_device:org.example.ping",
      "org.matrix.msc3819.receive.to_device:org.example.ping",
      "town.robin.msc3846.turn_servers",
      "org.matrix.msc2931.navigate",
      "org.matrix.msc4412.matrix_context",
    ];
    expect(await ask("request_capabilities", { capabilities: caps })).toEqual({});
    await new Promise((r) => setTimeout(r, 0));
    const notify = drain().find((m) => m.action === "notify_capabilities");
    expect((notify?.request as { approved: string[] }).approved).toEqual(caps);
    expect(driver.snapshot().approved).toEqual(caps);

    const sentEvent = await ask("send_event", { type: "m.room.message", content: { msgtype: "m.text", body: "hi" } });
    expect(sentEvent.room_id).toBe("!room:example.org");
    expect(typeof sentEvent.event_id).toBe("string");
    // Echoed through the subscription as host -> widget send_event.
    expect(drain().some((m) => m.source === "host" && m.action === "send_event")).toBe(true);
    expect(backend.timeline()).toHaveLength(1);

    const read = await ask("org.matrix.msc2876.read_events", { type: "m.room.message", limit: 10 });
    expect((read.events as unknown[]).length).toBe(1);
    // The plain spelling works too.
    expect(((await ask("read_events", { type: "m.room.message" })).events as unknown[]).length).toBe(1);

    const delayed = await ask("send_event", { type: "m.room.message", content: { body: "later" }, delay: 5000 });
    expect(typeof delayed.delay_id).toBe("string");
    expect(backend.delayedEvents()).toHaveLength(1);
    expect(await ask("org.matrix.msc4157.update_delayed_event", { delay_id: delayed.delay_id, action: "send" })).toEqual({});
    expect(backend.timeline()).toHaveLength(2);

    expect(await ask("send_to_device", { type: "org.example.ping", encrypted: false, messages: { "@bob:example.org": { "*": { n: 1 } } } })).toEqual({});
    expect(backend.toDeviceSent()).toHaveLength(1);
    drain();
    backend.injectToDevice({ eventType: "org.example.ping", sender: "@bob:example.org", content: { n: 2 }, encrypted: true });
    const incoming = drain().find((m) => m.action === "send_to_device");
    expect(incoming?.request).toEqual({ type: "org.example.ping", sender: "@bob:example.org", content: { n: 2 }, encrypted: true });

    expect(await ask("watch_turn_servers")).toEqual({});
    backend.setTurnServer({ uris: ["turn:x"], username: "u", password: "p" });
    expect(drain().find((m) => m.action === "update_turn_servers")?.request).toEqual({ uris: ["turn:x"], username: "u", password: "p" });

    expect(await ask("org.matrix.msc2931.navigate", { uri: "https://matrix.to/#/#x:example.org" })).toEqual({});
    const context = await ask("org.matrix.msc4412.matrix_context");
    expect(context.user_id).toBe("@alice:example.org");

    // Missing capability -> error response with a message.
    const denied = await ask("org.matrix.msc3973.user_directory_search", { search_term: "a" });
    expect((denied.error as { message: string }).message).toContain("user_directory_search");

    // Backend failures carry the Matrix error details.
    backend.failSends("boom");
    const failed = await ask("send_event", { type: "m.room.message", content: {} });
    expect((failed.error as { message: string }).message).toContain("boom");
  });

  it("runs the two-phase OpenID flow and the client pushes", async () => {
    const { platform, driver, ask, drain } = setup();
    const pending = await ask("get_openid");
    expect(pending).toEqual({ state: "request" });
    expect(platform.openidAsked).toBe(1);
    drain();
    await driver.resolveOpenid(true);
    const creds = drain().find((m) => m.action === "openid_credentials")?.request as Record<string, unknown>;
    expect(creds.state).toBe("allowed");
    expect(creds.original_request_id).toBe("req-1");
    expect(creds.matrix_server_name).toBe("matrix.example.org");

    driver.setOpenidAutoApproved(true);
    expect((await ask("get_openid")).state).toBe("allowed");
    expect(platform.openidAsked).toBe(1);
    drain();

    driver.notifyThemeChange({ name: "dark" });
    driver.notifyLanguageChange("de");
    driver.notifyVisibility(false);
    expect(drain().map((m) => m.action)).toEqual(["theme_change", "language_change", "visibility"]);
  });
});
