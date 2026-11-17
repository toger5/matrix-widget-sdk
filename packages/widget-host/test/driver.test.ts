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

const OPTIONS: hostDriver.EmbedOptions = { wrapperUrl: "https://client.example/wrapper/", clientOrigin: undefined, ownWidgetDirs: [], allowHttp: false };
const widgetOf = (type: string, content: Record<string, unknown>) => hostDriver.parseWidgetStateEvent(type, "w", { name: "W", url: "https://widget.example/app", ...content }, OPTIONS);

function setup(widget = widgetOf("m.widget", { uses_widget_api: true })) {
  const sent: Message[] = [];
  const platform: hostDriver.WidgetHostPlatform & { navigated: string[]; iframes: hostDriver.WidgetIframe[]; ready: number } = {
    navigated: [],
    iframes: [],
    ready: 0,
    loadIframe(iframe) {
      this.iframes.push(iframe);
    },
    sendToWidget: (json) => void sent.push(JSON.parse(json)),
    onCapabilitiesRequested: (requested) => queueMicrotask(() => driver.approveCapabilities(requested)),
    onReady() {
      this.ready += 1;
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
  const driver = new hostDriver.WidgetHostDriver(widget, OPTIONS, backend.asBackend(), platform);
  driver.start();
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

  it("hands out an OpenID token for one use, and the client pushes", async () => {
    const { driver, ask, drain } = setup();
    const GET_OPENID = `widget:${X}get_openid`;
    const PUSHES = [`host:${X}update_theme`, `host:${X}update_language`, `host:${X}update_visibility`];
    const allowedOf = (messages: Message[]) => messages.filter((m) => m.action === `${CORE}update_capabilities`).map((m) => (m.request as { allowed: string[] }).allowed);
    // The host sends nothing before the widget's first action.
    driver.updateTheme({ name: "dark" });
    expect(drain()).toEqual([]);
    // Asking for a token and every push are capabilities of their own.
    expect(((await ask(`${X}get_openid`)).error as { message: string }).message).toContain("get_openid");
    driver.updateTheme({ name: "dark" });
    expect(drain().filter((m) => m.source === "host")).toEqual([]);
    expect(driver.snapshot().singleUse).toEqual([GET_OPENID]);
    await ask(`${CORE}request_capabilities`, { capabilities: [GET_OPENID, ...PUSHES] });
    await new Promise((r) => setTimeout(r, 0));
    drain();

    // The token at once (the body of /openid/request_token), then the update without the capability.
    const token = await ask(`${X}get_openid`);
    expect(Object.keys(token).sort()).toEqual(["access_token", "expires_in", "matrix_server_name", "token_type"]);
    expect(token.matrix_server_name).toBe("matrix.example.org");
    expect(allowedOf(drain())).toEqual([PUSHES]);
    expect(((await ask(`${X}get_openid`)).error as { code: string }).code).toBe(`${CORE}missing_capability`);

    // Without single use the grant stays.
    driver.setSingleUse([]);
    await ask(`${CORE}request_capabilities`, { capabilities: [GET_OPENID] });
    await new Promise((r) => setTimeout(r, 0));
    drain();
    expect((await ask(`${X}get_openid`)).access_token).not.toBe((await ask(`${X}get_openid`)).access_token);
    expect(allowedOf(drain())).toEqual([]);
    expect(driver.snapshot().approved).toEqual([...PUSHES, GET_OPENID]);

    driver.updateTheme({ name: "dark" });
    driver.updateLanguage("de");
    driver.updateVisibility(false);
    expect(drain().map((m) => m.action)).toEqual([`${X}update_theme`, `${X}update_language`, `${X}update_visibility`]);
  });

  it("grants the base webview tokens without asking, never the top navigation, and loads the iframe again with what was granted", async () => {
    const { driver, ask, drain, platform } = setup();
    const strict = { url: "https://widget.example/app", origin: "https://widget.example", sandbox: "allow-scripts allow-same-origin", allow: "" };
    expect(platform.iframes).toEqual([strict]);
    const asked: string[][] = [];
    const camera = `webview:${X}allow:camera`;
    const scripts = `webview:${X}sandbox:allow-scripts`;
    const top = `webview:${X}sandbox:allow-top-navigation`;
    // The platform of `setup` approves whatever it is asked about.
    const spy = driver as unknown as { approveCapabilities(c: string[]): void };
    const approve = spy.approveCapabilities.bind(driver);
    spy.approveCapabilities = (c) => (asked.push(c), approve([...c, top]));
    await ask(`${CORE}request_capabilities`, { capabilities: [scripts, camera, top] });
    await new Promise((r) => setTimeout(r, 0));
    expect(asked).toEqual([[camera]]);
    expect(drain().find((m) => m.action === `${CORE}update_capabilities`)?.request).toEqual({ allowed: [scripts, camera] });
    // The camera is new to the iframe: the platform builds it again, and the page in it gets what the old one held.
    expect(platform.iframes).toEqual([strict, { ...strict, allow: "camera 'src'" }]);
    expect(driver.snapshot()).toMatchObject({ ready: false, approved: [], carried: [scripts, camera], iframe: platform.iframes[1] });
    asked.length = 0;
    await ask(`${CORE}request_capabilities`, { capabilities: [scripts, camera] });
    expect(asked).toEqual([]);
    expect(drain().find((m) => m.action === `${CORE}update_capabilities`)?.request).toEqual({ allowed: [scripts, camera] });
    expect(platform.iframes).toHaveLength(2);
    expect(hostDriver.webviewAttributes([])).toEqual({ sandbox: "allow-scripts allow-same-origin", allow: "" });
  });

  it("is made from a widget definition: a legacy widget in the compat wrapper, no widget API without uses_widget_api, no driver for a refused URL", async () => {
    // A legacy widget: the compat wrapper, the iframe of a legacy client, its capabilities without a question.
    const legacy = setup(widgetOf("im.vector.modular.widgets", { type: "m.custom" }));
    expect(legacy.platform.iframes).toHaveLength(1);
    expect(legacy.platform.iframes[0].url.startsWith("https://client.example/wrapper/?legacy_widget_url=https%3A%2F%2Fwidget.example%2Fapp&legacy_widget_id=w&")).toBe(true);
    expect(legacy.platform.iframes[0].origin).toBe("https://client.example");
    expect(legacy.platform.iframes[0].sandbox).toContain("allow-popups-to-escape-sandbox");
    expect(legacy.platform.iframes[0].allow).toContain("camera 'src'");
    expect(legacy.driver.snapshot().autoApproved).toEqual(hostDriver.legacyAutoApproved());
    expect(legacy.platform.ready).toBe(0);

    // Without the widget API: ready at once, and no message is answered.
    const plain = setup(widgetOf("m.widget", {}));
    expect(plain.platform.iframes).toHaveLength(1);
    expect(plain.platform.ready).toBe(1);
    const refused = plain.driver.handleMessageFromWidget(JSON.stringify({ source: "widget", action: `${CORE}notify_ready`, request_id: "1", request: {} }));
    await expect(refused).rejects.toSatisfy((e) => hostDriver.DriverError.NoWidgetApi.instanceOf(e));
    expect(plain.sent).toEqual([]);

    // A widget that must not be loaded: the parser says so, with the whole widget; so does the constructor.
    const parse = () => widgetOf("m.widget", { url: "javascript:alert(1)", name: "Evil" });
    let error: unknown;
    try {
      parse();
    } catch (e) {
      error = e;
    }
    if (!hostDriver.WidgetEventError.Refused.instanceOf(error)) throw new Error("not refused");
    expect(error.inner.reason).toBe("javascript: URLs are not allowed, only https:");
    expect(error.inner.widget).toMatchObject({ eventType: "m.widget", widgetId: "w", name: "Evil", url: "javascript:alert(1)" });
    const backend = new matrixBackend.InMemoryBackend("!room:example.org", "@alice:example.org");
    expect(() => new hostDriver.WidgetHostDriver(error.inner.widget, OPTIONS, backend.asBackend(), plain.platform)).toThrow();
  });

  it("refuses a widget on the client's own origin, except in the client's own widget directories", () => {
    const options = { wrapperUrl: undefined, clientOrigin: "http://localhost:5173", ownWidgetDirs: ["http://localhost:5173/widgets/"], allowHttp: true };
    expect(hostDriver.embedUrlProblem("http://localhost:5173/", options)).toBe("a widget cannot be a page of this client's own origin");
    expect(hostDriver.embedUrlProblem("http://localhost:5173/widgets/new/", options)).toBeUndefined();
    expect(hostDriver.embedUrlProblem("http://localhost:5175/new/", options)).toBeUndefined();
  });

  it("delivers log records to a host sink, filtered by level", async () => {
    const records: hostDriver.LogRecord[] = [];
    const { LogLevel } = hostDriver;
    hostDriver.setLogSink({ log: (r) => void records.push(r) });
    hostDriver.setupLogging(hostDriver.LogConfig.create({ level: LogLevel.Debug, writeToSystem: false }));
    const { ask } = setup();

    // A request without the capability is refused, which is a warning; every message is a debug line.
    expect((await ask(`${X}get_openid`)).error).toBeDefined();
    const warning = records.find((r) => r.level === LogLevel.Warn);
    expect(warning?.message).toContain("get_openid");
    expect(warning?.target).toBe("widget_host_driver::driver::requests");
    expect(records.some((r) => r.level === LogLevel.Debug && r.message.startsWith("from widget:"))).toBe(true);
    // Bodies are trace only.
    expect(records.some((r) => r.level === LogLevel.Trace)).toBe(false);

    records.length = 0;
    hostDriver.setupLogging(hostDriver.LogConfig.create({ level: LogLevel.Error, writeToSystem: false }));
    await ask(`${X}get_openid`);
    expect(records).toEqual([]);

    expect(() => hostDriver.setupLogging(hostDriver.LogConfig.create({ level: LogLevel.Info, filter: "a=b=c" }))).toThrow();
    // An invalid filter changes nothing; without the sink nothing arrives any more.
    hostDriver.clearLogSink();
    hostDriver.setupLogging(hostDriver.LogConfig.create({ level: LogLevel.Debug, writeToSystem: false }));
    await ask(`${X}get_openid`);
    expect(records).toEqual([]);
    // Back to the default, so the other tests stay quiet.
    hostDriver.setupLogging(hostDriver.LogConfig.create({ level: LogLevel.Warn, writeToSystem: false }));
  });
});
