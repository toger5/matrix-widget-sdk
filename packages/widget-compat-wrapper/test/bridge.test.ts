import { beforeEach, describe, expect, it } from "vitest";

import { CompatBridge } from "../src/bridge";
import type { LegacyMessage, NewMessage } from "../src/envelope";

function setup(waitForIframeLoad: boolean) {
  const toHost: NewMessage[] = [];
  const toWidget: LegacyMessage[] = [];
  let n = 0;
  const bridge = new CompatBridge({
    widgetId: "w",
    waitForIframeLoad,
    sendToHost: (m) => toHost.push(m),
    sendToWidget: (m) => toWidget.push(m),
    supportedVersions: ["org.matrix.msc2871", "org.matrix.msc2974"],
    nextId: () => `own-${++n}`,
  });
  const take = <T>(arr: T[]) => arr.splice(0, arr.length);
  return { bridge, toHost, toWidget, take };
}

const fromWidget = (action: string, requestId: string, data: unknown = {}): LegacyMessage =>
  ({ api: "fromWidget", widgetId: "w", requestId, action, data });
const fromHost = (action: string, requestId: string, request: unknown = {}): NewMessage =>
  ({ source: "host", version: "v1", requestId, action, request });

describe("startup with waitForIframeLoad = true", () => {
  const s = setup(true);
  beforeEach(() => { s.take(s.toHost); s.take(s.toWidget); });

  it("on iframe load sends content_loaded to the host and asks the widget for capabilities", () => {
    s.bridge.onIframeLoad();
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "own-1", action: "content_loaded", request: {} },
    ]);
    expect(s.take(s.toWidget)).toEqual([
      { api: "toWidget", widgetId: "w", requestId: "own-2", action: "capabilities", data: {} },
    ]);
  });

  it("turns the widget's capability list into request_capabilities", () => {
    s.bridge.onWidgetMessage({ ...fromWidget("capabilities", "own-2"), api: "toWidget", response: { capabilities: ["a", "b"] } });
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "own-3", action: "request_capabilities", request: { capabilities: ["a", "b"] } },
    ]);
    // the host's ack is swallowed
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "own-3", action: "request_capabilities", response: {} });
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

  it("forwards widget requests with renamed actions and echoes the host response", () => {
    s.bridge.onWidgetMessage(fromWidget("org.matrix.msc2876.read_events", "r1", { type: "m.room.message", limit: 2 }));
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "r1", action: "read_events", request: { type: "m.room.message", limit: 2 } },
    ]);
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "r1", action: "read_events", response: { events: [] } });
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
