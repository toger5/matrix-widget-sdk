/**
 * Webview capabilities in the host (`src/lib/webview.ts`, `WidgetRuntime`): the iframe attributes the
 * driver makes of them, the legacy set, and when the driver of a running widget has its iframe built
 * again (`WidgetRuntimeEvents.loadIframe`). Only what the host adds is tested here (the message
 * pump, what it remembers, its spelling of capabilities); the policy (base, never, denial) and the
 * reload are tested in Rust (`crates/widget-host-driver/src/webview.rs`, `driver/tests.rs`); the
 * reload in the browser in `e2e/webview.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryBackend, legacyAutoApproved, webviewAttributes } from "@matrix-widget-sdk/host";

import { LEGACY_WEBVIEW_CAPABILITIES } from "../../widget-compat-wrapper/src/capabilities";
import { INNER_ALLOW, INNER_SANDBOX } from "../../widget-compat-wrapper/src/wrapper";
import { WEBVIEW_CAPABILITIES } from "../../test-widgets/new/capabilities";
import { WidgetRuntime, type WidgetRuntimeEvents } from "../src/app/runtime/widgetRuntime";
import { canonicalWebview, isWebviewCapability } from "../src/lib/webview";
import type { WidgetDefinition, WidgetIframe } from "../src/widgetStateEvent";
import { CORE, tick, X } from "./harness";

const CAMERA = `webview:${X}allow:camera`;
const MICROPHONE = `webview:${X}allow:microphone`;
const POPUPS = `webview:${X}sandbox:allow-popups`;
const NAVIGATE = "widget:org.matrix.msc2931.navigate";
const STRICT = { sandbox: "allow-scripts allow-same-origin", allow: "" };
/** The webview capabilities a legacy widget gets without asking (the driver's `legacy_auto_approved`). */
const LEGACY_WEBVIEW = legacyAutoApproved().filter(isWebviewCapability);

describe("webview capabilities and the iframe attributes", () => {
  it("are known to the driver; a value that is no single web token is no webview capability", () => {
    expect(isWebviewCapability(CAMERA)).toBe(true);
    expect(isWebviewCapability("webview:m.sandbox:allow-forms")).toBe(true);
    for (const raw of ["webview:m.allow:camera *", "webview:m.allow:camera; usb", "webview:m.allow:Camera", `widget:${X}allow:camera`, "webview:garbage"]) {
      expect(isWebviewCapability(raw), raw).toBe(false);
    }
    // This host's own lists spell one the driver's way.
    expect(canonicalWebview("webview:m.allow:camera")).toBe(CAMERA);
    expect([CAMERA, NAVIGATE, "widget:m.navigate"].map(canonicalWebview)).toEqual([CAMERA, NAVIGATE, "widget:m.navigate"]);
  });

  it("of a legacy widget: what the compat wrapper requests and its inner iframe has, granted without asking", () => {
    expect(new Set(LEGACY_WEBVIEW)).toEqual(new Set(LEGACY_WEBVIEW_CAPABILITIES));
    // Besides: the facts of the widget URL and the host's pushes, never an OpenID token.
    expect(legacyAutoApproved().filter((c) => !isWebviewCapability(c))).toEqual([
      `widget:${X}get_matrix_context`,
      `widget:${X}get_client_context`,
      `host:${X}update_theme`,
      `host:${X}update_language`,
      `host:${X}update_visibility`,
    ]);
    const legacy = webviewAttributes(LEGACY_WEBVIEW);
    expect(new Set(legacy.sandbox.split(" "))).toEqual(new Set(INNER_SANDBOX.split(" ")));
    expect(new Set(legacy.allow.split("; ").map((f) => f.replace(" 'src'", "")))).toEqual(new Set(INNER_ALLOW.split("; ")));
  });

  it("of the test widget are camera and microphone", () => {
    expect(WEBVIEW_CAPABILITIES.split(",")).toEqual([CAMERA, MICROPHONE]);
  });
});

// ---- WidgetRuntime: when the driver has the iframe built again ----------------------------------

type Listener = (ev: { source: unknown; origin: string; data: unknown }) => void;

/** `window` and `document` as far as `WidgetRuntime` uses them, and the widget's window. */
function fakeBrowser() {
  const listeners = new Set<Listener>();
  const posted: { action: string; request?: unknown; response?: unknown }[] = [];
  const contentWindow = { postMessage: (message: { action: string }) => void posted.push(message) };
  vi.stubGlobal("document", { baseURI: "http://localhost:5173/" });
  vi.stubGlobal("window", {
    addEventListener: (_: string, listener: Listener) => listeners.add(listener),
    removeEventListener: (_: string, listener: Listener) => listeners.delete(listener),
    setTimeout: () => 0,
    clearTimeout: () => {},
  });
  let n = 0;
  /** The widget sends a request, as a message event from its window. */
  const fromWidget = async (action: string, request: unknown = {}, origin = page.origin) => {
    listeners.forEach((listener) => listener({ source: contentWindow, origin, data: { source: "widget", action, request_id: `w${++n}`, request } }));
    await tick();
  };
  /** The origin of the page in the widget's window: that of the iframe built last. */
  const page = { origin: "" };
  return { contentWindow, posted, fromWidget, page };
}

const NEW: WidgetDefinition = { eventType: "m.widget", widgetId: "w", name: "W", url: "https://widget.example/", avatarUrl: undefined, usesWidgetApi: true, legacy: undefined };
const LEGACY: WidgetDefinition = { ...NEW, eventType: "im.vector.modular.widgets", usesWidgetApi: false, legacy: { widgetType: "m.custom", waitForIframeLoad: true, data: undefined } };

function start(widget: WidgetDefinition = NEW) {
  const browser = fakeBrowser();
  /** Every iframe the driver asked for, oldest first. The page of each is "mounted" at once. */
  const iframes: WidgetIframe[] = [];
  const events = {
    ready: vi.fn(),
    failed: vi.fn(),
    capabilitiesRequested: vi.fn<WidgetRuntimeEvents["capabilitiesRequested"]>(),
    alwaysOnScreen: vi.fn(),
    activity: vi.fn(),
    loadIframe: (iframe: WidgetIframe) => {
      iframes.push(iframe);
      browser.page.origin = iframe.origin;
      runtime.attach({ contentWindow: browser.contentWindow } as unknown as HTMLIFrameElement);
    },
  };
  const runtime: WidgetRuntime = new WidgetRuntime({
    id: "!room:example.org|m.widget/w",
    widget,
    backend: new InMemoryBackend("!room:example.org", "@alice:example.org").asBackend(),
    autoApproveCapabilities: () => false,
    theme: () => "light",
    events,
  });
  const updates = () => browser.posted.filter((m) => m.action === `${CORE}update_capabilities`).map((m) => (m.request as { allowed: string[] }).allowed);
  /** The questions the user was asked (not the "answered" calls). */
  const questions = () => events.capabilitiesRequested.mock.calls.map(([question]) => question).filter((question) => question !== undefined);
  const attributes = () => iframes.map(({ sandbox, allow }) => ({ sandbox, allow }));
  return { runtime, events, iframes, attributes, updates, questions, ...browser };
}

describe("WidgetRuntime and webview capabilities", () => {
  const runtimes: WidgetRuntime[] = [];
  const started = async (...args: Parameters<typeof start>) => {
    const s = start(...args);
    runtimes.push(s.runtime);
    await tick();
    return s;
  };
  beforeEach(() => void (runtimes.length = 0));
  afterEach(() => {
    runtimes.forEach((r) => r.dispose());
    vi.unstubAllGlobals();
  });

  it("builds a widget's first iframe strict, as the driver says", async () => {
    const { runtime, iframes, events } = await started();
    expect(iframes).toEqual([{ url: "https://widget.example/", origin: "https://widget.example", ...STRICT }]);
    expect(runtime.appliedWebview).toEqual([]);
    expect(runtime.devTools.get().capabilities.webview).toEqual({ applied: [], ...STRICT });
    // A widget with the widget API is ready when it says so.
    expect(events.ready).not.toHaveBeenCalled();
  });

  it("shows a widget without the widget API at once, and passes none of its messages on", async () => {
    const { events, iframes, posted, fromWidget } = await started({ ...NEW, usesWidgetApi: false });
    expect(iframes).toHaveLength(1);
    expect(events.ready).toHaveBeenCalledOnce();
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [NAVIGATE] });
    expect(posted).toEqual([]);
    expect(events.capabilitiesRequested).not.toHaveBeenCalled();
  });

  it("accepts messages only from the origin of the iframe the driver asked for", async () => {
    const { posted, fromWidget } = await started();
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [`webview:${X}sandbox:allow-scripts`] }, "https://elsewhere.example");
    expect(posted).toEqual([]);
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [`webview:${X}sandbox:allow-scripts`] });
    expect(posted.length).toBeGreaterThan(0);
  });

  it("has the iframe built again once a grant is out; the page in it gets what the widget held without a question", async () => {
    const { runtime, attributes, updates, questions, fromWidget } = await started();
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [CAMERA, NAVIGATE] });
    expect(questions()).toEqual([{ requested: [CAMERA, NAVIGATE], unknown: [], singleUse: [] }]);
    runtime.answerCapabilities([CAMERA, NAVIGATE]);
    // The widget is told first; the new iframe comes after that.
    expect(updates()).toEqual([[CAMERA, NAVIGATE]]);
    expect(attributes()).toEqual([STRICT]);
    await tick();
    expect(attributes()).toEqual([STRICT, { sandbox: STRICT.sandbox, allow: "camera 'src'" }]);
    expect(runtime.appliedWebview).toEqual([CAMERA]);

    // The page in the new iframe asks again: granted at once, also what is no webview capability; no further iframe.
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [CAMERA, NAVIGATE] });
    expect(questions()).toHaveLength(1);
    expect(updates()).toEqual([[CAMERA, NAVIGATE], [CAMERA, NAVIGATE]]);
    await tick();
    expect(attributes()).toHaveLength(2);
  });

  it("builds the iframe again for a webview capability added in the driver panel (kept without a store), and again without a revoked one", async () => {
    const { runtime, attributes } = await started();
    runtime.grant(POPUPS);
    await tick();
    runtime.grant(CAMERA);
    await tick();
    const popups = "allow-scripts allow-same-origin allow-popups";
    expect(attributes()).toEqual([STRICT, { sandbox: popups, allow: "" }, { sandbox: popups, allow: "camera 'src'" }]);
    // One the widget has not requested in this iframe.
    runtime.revoke([CAMERA]);
    await tick();
    runtime.revoke("all");
    await tick();
    expect(attributes().slice(3)).toEqual([{ sandbox: popups, allow: "" }, STRICT]);
  });

  it("treats both spellings of a webview capability alike: added in the stable one, revoked as the driver lists it", async () => {
    const { runtime, attributes } = await started();
    runtime.grant("webview:m.allow:camera");
    await tick();
    expect(runtime.appliedWebview).toEqual([CAMERA]);
    runtime.revoke([CAMERA]);
    await tick();
    expect(attributes()).toEqual([STRICT, { sandbox: STRICT.sandbox, allow: "camera 'src'" }, STRICT]);
  });

  it("builds a legacy widget's iframe like a legacy client's, in the compat wrapper; the wrapper's request needs no prompt and no new iframe", async () => {
    const { iframes, updates, questions, fromWidget } = await started(LEGACY);
    expect(iframes).toHaveLength(1);
    expect(iframes[0].url.startsWith("http://localhost/widget_compatibility_wrapper/?legacy_widget_url=https%3A%2F%2Fwidget.example%2F&")).toBe(true);
    expect(iframes[0].origin).toBe("http://localhost");
    expect(iframes[0].sandbox.split(" ")).toEqual(expect.arrayContaining(INNER_SANDBOX.split(" ")));
    expect(iframes[0].allow).toContain("fullscreen 'src'");
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [`widget:${X}get_matrix_context`, ...LEGACY_WEBVIEW_CAPABILITIES] });
    expect(questions()).toEqual([]);
    expect(new Set(updates()[0])).toEqual(new Set([`widget:${X}get_matrix_context`, ...LEGACY_WEBVIEW_CAPABILITIES]));
    await tick();
    expect(iframes).toHaveLength(1);
  });
});
