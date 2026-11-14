import { beforeEach, describe, expect, it } from "vitest";

import { CompatBridge, CONTEXT_CAPABILITIES } from "../src/bridge";
import { IMPLICIT_CAPABILITIES } from "../src/capabilities";
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
  expect(CONTEXT_CAPABILITIES).toEqual(["widget:org.matrix.mscXXXX.get_matrix_context", "widget:org.matrix.mscXXXX.get_client_context"]);
  expect([matrix.action, client.action]).toEqual(["org.matrix.msc4412.get_matrix_context", "org.matrix.msc4412.get_client_context"]);
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
    s.bridge.onHostMessage(fromHost("forward_event", "h0", {}));
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
    // Unknown strings pass through, after what a legacy widget may do without asking.
    expect(s.take(s.toHost)).toEqual([
      { source: "widget", version: "v1", requestId: "own-6", action: "request_capabilities", request: { capabilities: [...IMPLICIT_CAPABILITIES, "a", "b"] } },
    ]);
    // the host's ack is swallowed
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "own-6", action: "request_capabilities", response: {} });
    expect(s.toHost).toEqual([]);
    expect(s.toWidget).toEqual([]);
  });

  it("forwards notify_capabilities to the widget and the widget's ack back to the host", () => {
    s.bridge.onHostMessage(fromHost("notify_capabilities", "h1", { requested: [...IMPLICIT_CAPABILITIES, "a", "b"], approved: [...IMPLICIT_CAPABILITIES, "a"] }));
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
    const [renegotiation] = s.take(s.toHost);
    expect(renegotiation.action).toBe("request_capabilities");
    expect(renegotiation.request).toEqual({ capabilities: [...IMPLICIT_CAPABILITIES, "c"] });
    s.bridge.onWidgetMessage(fromWidget("org.example.custom", "r3", { x: 1 }));
    expect(s.take(s.toHost)[0].action).toBe("org.example.custom");
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "r3", action: "org.example.custom", response: { error: { message: "Unknown action `org.example.custom`" } } });
    expect(s.take(s.toWidget)[0].response).toEqual({ error: { message: "Unknown action `org.example.custom`" } });
  });

  it("forwards host requests under their legacy name and answers the host under its own", () => {
    s.bridge.onHostMessage(fromHost("forward_event", "h2", { type: "m.room.message" }));
    const [legacy] = s.take(s.toWidget);
    expect(legacy).toEqual({ api: "toWidget", widgetId: "w", requestId: "h2", action: "send_event", data: { type: "m.room.message" } });
    s.bridge.onWidgetMessage({ ...legacy, response: { error: { message: "Unknown or unsupported to-widget action: send_event" } } });
    expect(s.take(s.toHost)).toEqual([
      { source: "host", version: "v1", requestId: "h2", action: "forward_event", response: { error: { message: "Unknown or unsupported to-widget action: send_event" } } },
    ]);
  });

  it.each([
    ["forward_to_device", "send_to_device"],
    ["forward_openid_credentials", "openid_credentials"],
    ["update_theme", "theme_change"],
    ["update_language", "language_change"],
    ["update_visibility", "visibility"],
    ["update_state", "update_state"],
    ["update_turn_servers", "update_turn_servers"],
  ])("gives the widget the host's %s as %s", (hostAction, legacyAction) => {
    s.bridge.onHostMessage(fromHost(hostAction, "h-rename", { x: 1 }));
    const [legacy] = s.take(s.toWidget);
    expect(legacy).toEqual({ api: "toWidget", widgetId: "w", requestId: "h-rename", action: legacyAction, data: { x: 1 } });
    s.bridge.onWidgetMessage({ ...legacy, response: {} });
    expect(s.take(s.toHost)).toEqual([{ source: "host", version: "v1", requestId: "h-rename", action: hostAction, response: {} }]);
  });

  it.each([
    ["org.matrix.msc3973.user_directory_search", "org.matrix.msc3973.search_user_directory"],
    ["org.matrix.msc4533.rtc_livekit_get_token", "org.matrix.msc4533.get_rtc_livekit_token"],
    ["org.matrix.msc4533.rtc_livekit_delegate_delayed_leave", "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave"],
    ["send_event", "send_event"],
    ["send_to_device", "send_to_device"],
  ])("sends the widget's %s to the host as %s", (legacyAction, hostAction) => {
    const request = fromWidget(legacyAction, "w-rename", { x: 1 });
    s.bridge.onWidgetMessage(request);
    expect(s.take(s.toHost)).toEqual([{ source: "widget", version: "v1", requestId: "w-rename", action: hostAction, request: { x: 1 } }]);
    // The reply echoes the widget's own request, legacy action name included.
    s.bridge.onHostMessage({ source: "widget", version: "v1", requestId: "w-rename", action: hostAction, response: { ok: true } });
    expect(s.take(s.toWidget)).toEqual([{ ...request, response: { ok: true } }]);
  });

  it("ignores messages for another widget id and host messages with another version", () => {
    s.bridge.onWidgetMessage({ ...fromWidget("send_event", "r4"), widgetId: "other" });
    expect(s.toHost).toEqual([]);
    s.bridge.onHostMessage({ ...fromHost("forward_event", "h3"), version: "v2" });
    expect(s.toWidget).toEqual([]);
    expect(s.take(s.toHost)[0].response).toEqual({ error: { message: "Unsupported widget api version `v2`" } });
  });
});

describe("capability translation", () => {
  const W = "widget:org.matrix.mscXXXX.";
  const H = "host:org.matrix.mscXXXX.";
  const SEND = "org.matrix.msc2762.send.event:m.room.message";
  const RECEIVE = "org.matrix.msc2762.receive.event:m.room.message";
  const STATE = "m.receive.state_event:m.room.member#@alice:example.org";
  const TIMELINE = "org.matrix.msc2762.timeline:*";
  const UPLOAD = "org.matrix.msc4039.upload_file";
  const NAVIGATE = "org.matrix.msc2931.navigate";
  const TURN = "town.robin.msc3846.turn_servers";
  const LEGACY = [SEND, RECEIVE, STATE, TIMELINE, UPLOAD, NAVIGATE, TURN, "m.always_on_screen", "m.sticker"];
  const NEW = [
    ...IMPLICIT_CAPABILITIES,
    `${W}send_event.timeline:m.room.message`,
    `${W}read_events.timeline:m.room.message`,
    `${W}read_relations:m.room.message`,
    `${H}forward_event.timeline:m.room.message`,
    `${W}read_events.state:m.room.member#@alice:example.org`,
    `${H}update_state:m.room.member#@alice:example.org`,
    `${H}forward_event.state:m.room.member#@alice:example.org`,
    `${W}upload_file`,
    `${W}get_media_config`,
    `${W}navigate`,
    `${H}update_turn_servers`,
    `${W}set_always_on_screen`,
    "m.sticker",
  ];

  /** A booted bridge whose widget answered the `capabilities` request with `legacy`. */
  function negotiated(legacy: string[]) {
    const s = setup(true);
    boot(s);
    s.take(s.toHost);
    s.bridge.onIframeLoad();
    const [capabilities] = s.take(s.toWidget);
    expect(capabilities.action).toBe("capabilities");
    s.bridge.onWidgetMessage({ ...capabilities, response: { capabilities: legacy } });
    const requests = s.take(s.toHost).filter((m) => m.action === "request_capabilities");
    expect(requests).toHaveLength(1);
    return { s, requested: (requests[0].request as { capabilities: string[] }).capabilities };
  }
  /** What the widget is told when the host approves `approved`. */
  function notified(s: S, approved: string[], requested: string[] = approved) {
    s.bridge.onHostMessage(fromHost("notify_capabilities", "n", { requested, approved }));
    const [legacy] = s.take(s.toWidget);
    expect(legacy).toMatchObject({ api: "toWidget", action: "notify_capabilities", requestId: "n" });
    return legacy.data as { requested: string[]; approved: string[] };
  }

  it("requests what the widget's legacy capabilities stand for, and never the timeline capability", () => {
    const { requested } = negotiated(LEGACY);
    expect(requested).toEqual(NEW);
    expect(requested.join(" ")).not.toContain("timeline:*");
    expect(requested.join(" ")).not.toContain("msc2762");
  });

  it("requests the implicit capabilities even for a widget that asks for nothing", () => {
    expect(negotiated([]).requested).toEqual(IMPLICIT_CAPABILITIES);
  });

  it("tells the widget its own legacy names when the host approves everything, except timeline", () => {
    const { s, requested } = negotiated(LEGACY);
    expect(notified(s, [...CONTEXT_CAPABILITIES, ...requested])).toEqual({
      requested: LEGACY,
      approved: LEGACY.filter((c) => c !== TIMELINE),
    });
  });

  it("reports a legacy capability only if the host approved all it stands for", () => {
    const { s, requested } = negotiated(LEGACY);
    // The host refuses relations, state updates and the media config.
    const refused = [`${W}read_relations:m.room.message`, `${H}update_state:m.room.member#@alice:example.org`, `${W}get_media_config`];
    const approved = requested.filter((c) => !refused.includes(c));
    expect(notified(s, approved, requested).approved).toEqual([SEND, NAVIGATE, TURN, "m.always_on_screen", "m.sticker"]);
    // Nothing approved at all.
    expect(notified(s, [], requested)).toEqual({ requested: LEGACY, approved: [] });
  });

  it("understands a host that answers in the stable namespace", () => {
    const { s, requested } = negotiated([SEND, NAVIGATE]);
    const stable = requested.map((c) => c.replace(":org.matrix.mscXXXX.", ":m."));
    expect(stable).toContain("widget:m.navigate");
    expect(notified(s, stable).approved).toEqual([SEND, NAVIGATE]);
  });

  it("translates a renegotiation and keeps reporting what was approved before", () => {
    const { s, requested } = negotiated([SEND, NAVIGATE]);
    expect(notified(s, requested).approved).toEqual([SEND, NAVIGATE]);
    s.take(s.toHost);

    const renegotiate = fromWidget("org.matrix.msc2974.request_capabilities", "re", { capabilities: [RECEIVE, TIMELINE] });
    s.bridge.onWidgetMessage(renegotiate);
    const [toHost] = s.take(s.toHost);
    expect(toHost).toEqual({
      source: "widget", version: "v1", requestId: "re", action: "request_capabilities",
      request: { capabilities: [...IMPLICIT_CAPABILITIES, `${W}read_events.timeline:m.room.message`, `${W}read_relations:m.room.message`, `${H}forward_event.timeline:m.room.message`] },
    });
    // The host's ack reaches the widget as the reply to its own request.
    s.bridge.onHostMessage(hostResponse(toHost, {}));
    expect(s.take(s.toWidget)).toEqual([{ ...renegotiate, response: {} }]);

    // The host's `approved` is cumulative; so is the widget's.
    const second = (toHost.request as { capabilities: string[] }).capabilities;
    expect(notified(s, [...requested, ...second], second)).toEqual({ requested: [RECEIVE, TIMELINE], approved: [SEND, NAVIGATE, RECEIVE] });
  });

  it("starts from the widget's new list when the iframe reloads", () => {
    const { s, requested } = negotiated([SEND]);
    notified(s, requested);
    s.bridge.onIframeLoad();
    const [capabilities] = s.take(s.toWidget).filter((m) => m.action === "capabilities");
    s.bridge.onWidgetMessage({ ...capabilities, response: { capabilities: [NAVIGATE] } });
    const [again] = s.take(s.toHost).filter((m) => m.action === "request_capabilities");
    expect(again.request).toEqual({ capabilities: [...IMPLICIT_CAPABILITIES, `${W}navigate`] });
    expect(notified(s, [...requested, `${W}navigate`])).toEqual({ requested: [NAVIGATE], approved: [SEND, NAVIGATE] });
  });

  it("survives a malformed capability list", () => {
    expect(negotiated("nope" as unknown as string[]).requested).toEqual(IMPLICIT_CAPABILITIES);
    const { s } = negotiated([SEND]);
    expect(notified(s, "nope" as unknown as string[]).approved).toEqual([]);
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
});
