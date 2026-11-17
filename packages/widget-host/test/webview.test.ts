/**
 * Webview capabilities in the host (`src/lib/webview.ts`, `WidgetRuntime`): the iframe attributes the
 * driver makes of them, the legacy set, and when a running widget reports `webviewChanged` (its
 * iframe must be built again) and when not. The policy itself (base, never) is tested in Rust
 * (`crates/widget-host-driver/src/webview.rs`, `driver/tests.rs`); the reload in the browser in
 * `e2e/webview.spec.ts`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { InMemoryBackend } from "@matrix-widget-tools/widget-host-bindings";

import { LEGACY_WEBVIEW_CAPABILITIES } from "../../widget-compat-wrapper/src/capabilities";
import { INNER_ALLOW, INNER_SANDBOX } from "../../widget-compat-wrapper/src/wrapper";
import { WEBVIEW_CAPABILITIES } from "../../test-widgets/new/capabilities";
import { WidgetRuntime, type WidgetRuntimeEvents } from "../src/app/runtime/widgetRuntime";
import { isWebviewCapability, webviewCapabilities, webviewFor } from "../src/lib/webview";
import { LEGACY_AUTO_APPROVED, LEGACY_WEBVIEW, type ResolvedWidget } from "../src/widgetStateEvent";
import { CORE, tick, X } from "./harness";

const CAMERA = `webview:${X}allow:camera`;
const MICROPHONE = `webview:${X}allow:microphone`;
const POPUPS = `webview:${X}sandbox:allow-popups`;
const TOP_NAVIGATION = `webview:${X}sandbox:allow-top-navigation`;
const NAVIGATE = "widget:org.matrix.msc2931.navigate";
const STRICT = { sandbox: "allow-scripts allow-same-origin", allow: "" };

describe("webview capabilities and the iframe attributes", () => {
  it("start strict: scripts and the widget's own origin, no feature", () => {
    expect(webviewFor([])).toEqual(STRICT);
    expect(webviewFor([`widget:${X}get_matrix_context`, "garbage"])).toEqual(STRICT);
  });

  it("add a granted token or feature, for the widget's own origin only; never the top navigation", () => {
    expect(webviewFor([MICROPHONE, POPUPS, CAMERA, TOP_NAVIGATION])).toEqual({
      sandbox: "allow-scripts allow-same-origin allow-popups",
      allow: "camera 'src'; microphone 'src'",
    });
    // The stable spelling is the same capability.
    expect(webviewFor(["webview:m.allow:camera"]).allow).toBe("camera 'src'");
  });

  it("are known to the driver; a value that is no single web token is no webview capability", () => {
    expect(isWebviewCapability(CAMERA)).toBe(true);
    expect(isWebviewCapability("webview:m.sandbox:allow-forms")).toBe(true);
    for (const raw of ["webview:m.allow:camera *", "webview:m.allow:camera; usb", "webview:m.allow:Camera", `widget:${X}allow:camera`, "webview:garbage"]) {
      expect(isWebviewCapability(raw), raw).toBe(false);
    }
    expect(webviewCapabilities([CAMERA, NAVIGATE, CAMERA, "webview:m.allow:camera *"])).toEqual([CAMERA]);
  });

  it("of a legacy widget: what the compat wrapper requests and its inner iframe has, granted without asking", () => {
    expect(new Set(LEGACY_WEBVIEW)).toEqual(new Set(LEGACY_WEBVIEW_CAPABILITIES));
    expect(LEGACY_WEBVIEW.every((c) => LEGACY_AUTO_APPROVED.includes(c))).toBe(true);
    const legacy = webviewFor(LEGACY_WEBVIEW);
    expect(new Set(legacy.sandbox.split(" "))).toEqual(new Set(INNER_SANDBOX.split(" ")));
    expect(new Set(legacy.allow.split("; ").map((f) => f.replace(" 'src'", "")))).toEqual(new Set(INNER_ALLOW.split("; ")));
  });

  it("of the test widget are camera and microphone", () => {
    expect(WEBVIEW_CAPABILITIES.split(",")).toEqual([CAMERA, MICROPHONE]);
  });
});

// ---- WidgetRuntime: when the iframe has to be built again ---------------------------------------

type Listener = (ev: { source: unknown; data: unknown }) => void;

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
  });
  let n = 0;
  /** The widget sends a request, as a message event from its window. */
  const fromWidget = async (action: string, request: unknown = {}) => {
    listeners.forEach((listener) => listener({ source: contentWindow, data: { source: "widget", action, request_id: `w${++n}`, request } }));
    await tick();
  };
  return { contentWindow, posted, fromWidget };
}

function start(widget: Partial<ResolvedWidget> = {}, keptWebview?: string[]) {
  const browser = fakeBrowser();
  const events = {
    ready: vi.fn(),
    failed: vi.fn(),
    capabilitiesRequested: vi.fn<WidgetRuntimeEvents["capabilitiesRequested"]>(),
    alwaysOnScreen: vi.fn(),
    activity: vi.fn(),
    webviewChanged: vi.fn<WidgetRuntimeEvents["webviewChanged"]>(),
  };
  const runtime = new WidgetRuntime({
    id: "!room:example.org|m.widget/w",
    widget: { url: "https://widget.example/", name: "W", legacy: false, usesWidgetApi: true, ...widget },
    backend: new InMemoryBackend("!room:example.org", "@alice:example.org").asBackend(),
    autoApproveCapabilities: () => false,
    theme: () => "light",
    keptWebview,
    events,
  });
  runtime.attach({ contentWindow: browser.contentWindow } as unknown as HTMLIFrameElement);
  const updates = () => browser.posted.filter((m) => m.action === `${CORE}update_capabilities`).map((m) => (m.request as { allowed: string[] }).allowed);
  return { runtime, events, updates, ...browser };
}

describe("WidgetRuntime and webview capabilities", () => {
  const runtimes: WidgetRuntime[] = [];
  const started = (...args: Parameters<typeof start>) => {
    const s = start(...args);
    runtimes.push(s.runtime);
    return s;
  };
  beforeEach(() => void (runtimes.length = 0));
  afterEach(() => {
    runtimes.forEach((r) => r.dispose());
    vi.unstubAllGlobals();
  });

  it("builds a widget's first iframe strict", async () => {
    const { runtime } = started();
    expect(runtime.webview).toEqual({ applied: [], ...STRICT });
    await tick();
    expect(runtime.devTools.get().capabilities.webview).toEqual({ applied: [], ...STRICT });
  });

  it("reports webviewChanged once a grant is out, and the next start applies it without asking again", async () => {
    const { runtime, events, updates, fromWidget } = started();
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [CAMERA, NAVIGATE] });
    expect(events.capabilitiesRequested).toHaveBeenLastCalledWith({ requested: [CAMERA, NAVIGATE], unknown: [], singleUse: [] });
    runtime.answerCapabilities([CAMERA, NAVIGATE]);
    // The widget is told first; the restart is reported after that.
    expect(updates()).toEqual([[CAMERA, NAVIGATE]]);
    expect(events.webviewChanged).not.toHaveBeenCalled();
    await tick();
    expect(events.webviewChanged).toHaveBeenCalledExactlyOnceWith([CAMERA]);

    // The next start: built with the camera, and its request for it is granted at once.
    const next = started({}, [CAMERA]);
    expect(next.runtime.webview).toEqual({ applied: [CAMERA], sandbox: STRICT.sandbox, allow: "camera 'src'" });
    await next.fromWidget(`${CORE}request_capabilities`, { capabilities: [CAMERA] });
    expect(next.events.capabilitiesRequested).not.toHaveBeenCalled();
    expect(next.updates()).toEqual([[CAMERA]]);
    await tick();
    expect(next.events.webviewChanged).not.toHaveBeenCalled();
  });

  it("does not restart for a denial, a base token, a never token or anything but webview capabilities", async () => {
    const { runtime, events, updates, fromWidget } = started();
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [`webview:${X}sandbox:allow-scripts`, TOP_NAVIGATION] });
    // Granted (the base token) and refused (the top navigation) without asking.
    expect(events.capabilitiesRequested).not.toHaveBeenCalled();
    expect(updates()).toEqual([[`webview:${X}sandbox:allow-scripts`]]);
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [CAMERA, NAVIGATE] });
    runtime.answerCapabilities([NAVIGATE], [CAMERA, NAVIGATE]);
    await tick();
    expect(events.webviewChanged).not.toHaveBeenCalled();
    expect(runtime.webview).toEqual({ applied: [], ...STRICT });
  });

  it("restarts without a revoked webview capability, also one the widget has not requested in this start", async () => {
    const { runtime, events } = started({}, [CAMERA, MICROPHONE]);
    expect(runtime.webview.allow).toBe("camera 'src'; microphone 'src'");
    runtime.revoke([CAMERA]);
    await tick();
    expect(events.webviewChanged).toHaveBeenCalledExactlyOnceWith([MICROPHONE]);
    // At most once per runtime: the controller starts a new one.
    runtime.revoke([MICROPHONE]);
    await tick();
    expect(events.webviewChanged).toHaveBeenCalledOnce();
  });

  it("restarts for a webview capability added in the driver panel, and keeps it without a store", async () => {
    const { runtime, events } = started();
    runtime.grant(POPUPS);
    await tick();
    expect(events.webviewChanged).toHaveBeenCalledExactlyOnceWith([POPUPS]);
    expect(started({}, [POPUPS]).runtime.webview.sandbox).toBe("allow-scripts allow-same-origin allow-popups");
  });

  it("treats both spellings of a webview capability alike: added in the stable one, revoked as the driver lists it", async () => {
    const first = started();
    first.runtime.grant("webview:m.allow:camera");
    await tick();
    expect(first.events.webviewChanged).toHaveBeenCalledExactlyOnceWith([CAMERA]);
    // Kept in the stable spelling, revoked in the driver's: the next start is without it.
    const { runtime, events } = started({}, ["webview:m.allow:camera"]);
    expect(runtime.webview).toEqual({ applied: [CAMERA], sandbox: STRICT.sandbox, allow: "camera 'src'" });
    runtime.revoke([CAMERA]);
    await tick();
    expect(events.webviewChanged).toHaveBeenCalledExactlyOnceWith([]);
  });

  it("asks about a legacy client's set when an MSC4411 widget requests it: only a legacy widget gets it without asking", async () => {
    const { runtime, events, updates, fromWidget } = started();
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [...LEGACY_WEBVIEW_CAPABILITIES] });
    const base = [`webview:${X}sandbox:allow-same-origin`, `webview:${X}sandbox:allow-scripts`];
    const asked = LEGACY_WEBVIEW_CAPABILITIES.filter((c) => !base.includes(c));
    expect(asked).toHaveLength(13);
    expect(events.capabilitiesRequested).toHaveBeenCalledOnce();
    expect(new Set(events.capabilitiesRequested.mock.calls[0][0]?.requested)).toEqual(new Set(asked));
    expect(runtime.webview).toEqual({ applied: [], ...STRICT });
    // Denied: the widget holds the base only, and its iframe stays strict.
    runtime.answerCapabilities([], asked);
    expect(new Set(updates().at(-1))).toEqual(new Set(base));
    await tick();
    expect(events.webviewChanged).not.toHaveBeenCalled();
  });

  it("builds a legacy widget's iframe like a legacy client's; the compat wrapper's request needs no prompt and no restart", async () => {
    const { runtime, events, updates, fromWidget } = started({ legacy: true });
    expect(runtime.webview.sandbox.split(" ")).toEqual(expect.arrayContaining(INNER_SANDBOX.split(" ")));
    expect(runtime.webview.allow).toContain("fullscreen 'src'");
    await fromWidget(`${CORE}request_capabilities`, { capabilities: [`widget:${X}get_matrix_context`, ...LEGACY_WEBVIEW_CAPABILITIES] });
    expect(events.capabilitiesRequested).not.toHaveBeenCalled();
    expect(new Set(updates()[0])).toEqual(new Set([`widget:${X}get_matrix_context`, ...LEGACY_WEBVIEW_CAPABILITIES]));
    await tick();
    expect(events.webviewChanged).not.toHaveBeenCalled();
  });
});
