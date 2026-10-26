import { beforeEach, describe, expect, it } from "vitest";

import { CompatBridge, CONTEXT_CAPABILITIES } from "../src/bridge";
import type { LegacyMessage, NewMessage } from "../src/envelope";

const MATRIX = { user_id: "@alice:example.org", device_id: "DEV", room_id: "!r:example.org", display_name: "Alice", avatar_url: "", matrix_base_url: "https://hs.example" };
const CLIENT = { client_id: "test-client", client_theme: "dark" };

function setup(waitForIframeLoad: boolean) {
  const toHost: NewMessage[] = [];
  const toWidget: LegacyMessage[] = [];
  const loaded: string[] = [];
  let n = 0;
  const bridge = new CompatBridge({
    widgetId: "w",
    waitForIframeLoad,
    legacyWidgetUrl: "https://widget.example/?u=$matrix_user_id&t=$title",
    widgetData: { title: "Notes" },
    wrapperUrl: "https://compat.example/",
    sendToHost: (m) => toHost.push(m),
    sendToWidget: (m) => toWidget.push(m),
    loadWidget: (url) => loaded.push(url),
    supportedVersions: ["org.matrix.msc2871", "org.matrix.msc2974"],
    nextId: () => `own-${++n}`,
  });
  const take = <T>(arr: T[]) => arr.splice(0, arr.length);
  return { bridge, toHost, toWidget, loaded, take };
}
type S = ReturnType<typeof setup>;

const fromWidget = (action: string, requestId: string, data: unknown = {}): LegacyMessage =>
  ({ api: "fromWidget", widgetId: "w", requestId, action, data });
const fromHost = (action: string, requestId: string, request: unknown = {}): NewMessage =>
  ({ source: "host", version: "v1", requestId, action, request });
const hostResponse = (request: NewMessage, response: unknown): NewMessage =>
  ({ source: request.source, version: "v1", requestId: request.requestId, action: request.action, response });

/** Drive the bootstrap: capability request, notify, both contexts. Returns the loaded URL. */
function boot(s: S, contexts: { matrix?: unknown; client?: unknown } = { matrix: MATRIX, client: CLIENT }): string {
  s.bridge.start();
  const [caps] = s.take(s.toHost);
  expect(caps).toMatchObject({ source: "widget", action: "request_capabilities", request: { capabilities: CONTEXT_CAPABILITIES } });
  s.bridge.onHostMessage(hostResponse(caps, {}));
  s.bridge.onHostMessage(fromHost("notify_capabilities", "n1", { requested: CONTEXT_CAPABILITIES, approved: CONTEXT_CAPABILITIES }));
  const [ack, matrix, client] = s.take(s.toHost);
  expect(ack).toEqual({ source: "host", version: "v1", requestId: "n1", action: "notify_capabilities", response: {} });
  expect([matrix.action, client.action]).toEqual(["org.matrix.msc4412.matrix_context", "org.matrix.msc4412.client_context"]);
  expect(s.loaded).toEqual([]);
  s.bridge.onHostMessage(hostResponse(matrix, contexts.matrix ?? { error: { message: "denied" } }));
  s.bridge.onHostMessage(hostResponse(client, contexts.client ?? { error: { message: "denied" } }));
  expect(s.loaded).toHaveLength(1);
  return s.loaded[0];
}

describe("bootstrap", () => {
  it("templates the legacy url from both contexts and only then loads the widget", () => {
    const url = new URL(boot(setup(true)));
    expect(Object.fromEntries(url.searchParams)).toEqual({ u: "@alice:example.org", t: "Notes", widgetId: "w", parentUrl: "https://compat.example/" });
  });

  it("loads the widget with empty variables when the host denies or does not know the actions", () => {
    const url = new URL(boot(setup(true), {}));
    expect(url.searchParams.get("u")).toBe("");
  });

  it("rejects other host requests until the widget is loaded", () => {
    const s = setup(true);
    s.bridge.start();
    s.take(s.toHost);
    s.bridge.onHostMessage(fromHost("send_event", "h0", {}));
    expect(s.take(s.toHost)[0].response).toEqual({ error: { message: "The wrapped widget is not loaded yet" } });
    expect(s.toWidget).toEqual([]);
  });
});

describe("startup with waitForIframeLoad = true", () => {
  const s = setup(true);
  boot(s);
  beforeEach(() => { s.take(s.toHost); s.take(s.toWidget); });

  it("on iframe load sends content_loaded to the host and asks the widget for capabilities", () => {
    s.bridge.onIframeLoad();
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "own-4", action: "content_loaded", request: {} },
    ]);
    expect(s.take(s.toWidget)).toEqual([
      { api: "toWidget", widgetId: "w", requestId: "own-5", action: "capabilities", data: {} },
    ]);
  });

  it("turns the widget's capability list into request_capabilities", () => {
    s.bridge.onWidgetMessage({ ...fromWidget("capabilities", "own-5"), api: "toWidget", response: { capabilities: ["a", "b"] } });
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "own-6", action: "request_capabilities", request: { capabilities: ["a", "b"] } },
    ]);
    // the host's ack is swallowed
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "own-6", action: "request_capabilities", response: {} });
    expect(s.toHost).toEqual([]);
    expect(s.toWidget).toEqual([]);
  });

  it("forwards notify_capabilities to the widget and the widget's ack back to the host", () => {
    s.bridge.onHostMessage(fromHost("notify_capabilities", "h1", { requested: ["a", "b"], approved: ["a"] }));
    const [legacy] = s.take(s.toWidget);
    expect(legacy).toEqual({ api: "toWidget", widgetId: "w", requestId: "h1", action: "notify_capabilities", data: { requested: ["a", "b"], approved: ["a"] } });
    s.bridge.onWidgetMessage({ ...legacy, response: {} });
    expect(s.take(s.toHost)).toEqual([{ source: "host", version: "v1", requestId: "h1", action: "notify_capabilities", response: {} }]);
  });

  it("answers supported_api_versions locally", () => {
    s.bridge.onWidgetMessage(fromWidget("supported_api_versions", "v1"));
    expect(s.toHost).toEqual([]);
    expect(s.take(s.toWidget)[0].response).toEqual({ supported_versions: ["org.matrix.msc2871", "org.matrix.msc2974"] });
  });

  it("rejects content_loaded like a legacy host and does not forward it", () => {
    s.bridge.onWidgetMessage(fromWidget("content_loaded", "c1"));
    expect(s.toHost).toEqual([]);
    expect(s.take(s.toWidget)[0].response).toEqual({ error: { message: "Improper sequence: not expecting ContentLoaded event" } });
  });

  it("re-runs the capability round on reload but sends content_loaded only once", () => {
    s.bridge.onIframeLoad();
    expect(s.take(s.toHost)).toEqual([]);
    expect(s.take(s.toWidget).map((m) => m.action)).toEqual(["capabilities"]);
  });
});

describe("startup with waitForIframeLoad = false", () => {
  it("waits for the widget's content_loaded, acks it, then does the handshake", () => {
    const s = setup(false);
    boot(s);
    s.bridge.onIframeLoad();
    expect(s.toHost).toEqual([]);
    expect(s.toWidget).toEqual([]);

    s.bridge.onWidgetMessage(fromWidget("content_loaded", "c1"));
    expect(s.take(s.toWidget).map((m) => [m.action, m.response ?? m.data])).toEqual([
      ["content_loaded", {}],
      ["capabilities", {}],
    ]);
    expect(s.take(s.toHost).map((m) => m.action)).toEqual(["content_loaded"]);

    s.bridge.onWidgetMessage(fromWidget("content_loaded", "c2"));
    expect(s.take(s.toWidget)[0].response).toEqual({ error: { message: "Improper sequence: ContentLoaded Action can only be sent once" } });
  });
});

describe("steady state forwarding", () => {
  const s = setup(true);
  boot(s);

  it("forwards widget requests with renamed actions and echoes the host response", () => {
    s.bridge.onWidgetMessage(fromWidget("org.matrix.msc2876.read_events", "r1", { type: "m.room.message", limit: 2 }));
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "r1", action: "org.matrix.msc2876.read_events", request: { type: "m.room.message", limit: 2 } },
    ]);
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "r1", action: "org.matrix.msc2876.read_events", response: { events: [] } });
    expect(s.take(s.toWidget)).toEqual([
      { api: "fromWidget", widgetId: "w", requestId: "r1", action: "org.matrix.msc2876.read_events", data: { type: "m.room.message", limit: 2 }, response: { events: [] } },
    ]);
  });

  it("forwards renegotiation and unknown actions, including the host's error reply", () => {
    s.bridge.onWidgetMessage(fromWidget("org.matrix.msc2974.request_capabilities", "r2", { capabilities: ["c"] }));
    expect(s.take(s.toHost)[0].action).toBe("request_capabilities");
    s.bridge.onWidgetMessage(fromWidget("org.example.custom", "r3", { x: 1 }));
    expect(s.take(s.toHost)[0].action).toBe("org.example.custom");
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "r3", action: "org.example.custom", response: { error: { message: "Unknown action `org.example.custom`" } } });
    expect(s.take(s.toWidget)[0].response).toEqual({ error: { message: "Unknown action `org.example.custom`" } });
  });

  it("forwards host requests and the widget's error reply for unsupported actions", () => {
    s.bridge.onHostMessage(fromHost("send_event", "h2", { type: "m.room.message" }));
    const [legacy] = s.take(s.toWidget);
    expect(legacy.action).toBe("send_event");
    s.bridge.onWidgetMessage({ ...legacy, response: { error: { message: "Unknown or unsupported to-widget action: send_event" } } });
    expect(s.take(s.toHost)).toEqual([
      { source: "host", version: "v1", requestId: "h2", action: "send_event", response: { error: { message: "Unknown or unsupported to-widget action: send_event" } } },
    ]);
  });

  it("ignores messages for another widget id and host messages with another version", () => {
    s.bridge.onWidgetMessage({ ...fromWidget("send_event", "r4"), widgetId: "other" });
    expect(s.toHost).toEqual([]);
    s.bridge.onHostMessage({ ...fromHost("send_event", "h3"), version: "v2" });
    expect(s.toWidget).toEqual([]);
    expect(s.take(s.toHost)[0].response).toEqual({ error: { message: "Unsupported widget api version `v2`" } });
  });
});

describe("file payloads", () => {
  const s = setup(true);
  boot(s);
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  it("sends an uploaded Blob to the host as base64 and echoes the original request back", async () => {
    const blob = new Blob(["hello"], { type: "text/plain" });
    const request = fromWidget("org.matrix.msc4039.upload_file", "u1", { file: blob });
    s.bridge.onWidgetMessage(request);
    await flush();
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "u1", action: "org.matrix.msc4039.upload_file", request: { file: { mimetype: "text/plain", base64: "aGVsbG8=" } } },
    ]);
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "u1", action: "org.matrix.msc4039.upload_file", response: { content_uri: "mxc://hs/abc" } });
    expect(s.take(s.toWidget)).toEqual([{ ...request, response: { content_uri: "mxc://hs/abc" } }]);
  });

  it("turns a downloaded base64 file back into a Blob for the widget", async () => {
    s.bridge.onWidgetMessage(fromWidget("org.matrix.msc4039.download_file", "d1", { content_uri: "mxc://hs/abc" }));
    expect(s.take(s.toHost)[0].request).toEqual({ content_uri: "mxc://hs/abc" });
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "d1", action: "org.matrix.msc4039.download_file", response: { file: { mimetype: "text/plain", base64: "aGVsbG8=" } } });
    const file = (s.take(s.toWidget)[0].response as { file: Blob }).file;
    expect(file).toBeInstanceOf(Blob);
    expect(file.type).toBe("text/plain");
    expect(await file.text()).toBe("hello");
  });

  it("sends the widget's screenshot Blob to the host as base64", async () => {
    s.bridge.onHostMessage(fromHost("screenshot", "s1"));
    const [legacy] = s.take(s.toWidget);
    s.bridge.onWidgetMessage({ ...legacy, response: { screenshot: new Blob([new Uint8Array([1, 2, 3])], { type: "image/png" }) } });
    await flush();
    expect(s.take(s.toHost)).toEqual([
      { source: "host", version: "v1", requestId: "s1", action: "screenshot", response: { screenshot: { mimetype: "image/png", base64: "AQID" } } },
    ]);
  });
});
