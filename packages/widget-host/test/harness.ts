/**
 * Shared by the backend tests: the real driver wasm, a JS `WidgetHostPlatform` that approves every
 * capability request, and a scripted widget feeding MSC4412 messages into a `WidgetHostDriver`.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

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
export const X = "org.matrix.mscXXXX.";
export const CORE = "org.matrix.msc4412.";

export type Message = { source: string; action: string; request_id: string; request?: unknown; response?: unknown };

export const tick = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));

/** A driver on `backend` with a scripted widget in front of it. */
export function behindDriver(backend: matrixBackend.MatrixBackend) {
  const sent: Message[] = [];
  const platform: hostDriver.WidgetHostPlatform = {
    sendToWidget: (json) => void sent.push(JSON.parse(json)),
    onCapabilitiesRequested: (requested) => queueMicrotask(() => driver.approveCapabilities(requested)),
    onReady: () => {},
    onOpenidRequested: () => {},
    navigate: () => {},
    setAlwaysOnScreen: (value) => value,
    clientId: () => "vitest",
    clientTheme: () => "dark",
    clientLanguage: () => "en",
  };
  const driver = new hostDriver.WidgetHostDriver(backend, platform);
  let n = 0;
  /** Send a widget request and return the host's response to it. */
  const ask = async (action: string, request: unknown = {}) => {
    const requestId = `req-${++n}`;
    await driver.handleMessageFromWidget(JSON.stringify({ source: "widget", request_id: requestId, action, request }));
    await tick();
    const response = sent.find((m) => m.request_id === requestId && m.response !== undefined);
    if (!response) throw new Error(`no response to ${action}`);
    return response.response as Record<string, unknown>;
  };
  /** Request capabilities; the platform approves all of them. */
  const grant = async (capabilities: string[]) => {
    await ask(`${CORE}request_capabilities`, { capabilities });
    await tick();
  };
  /** The host -> widget requests of `action` sent so far, removing everything sent so far. */
  const pushed = (action: string) =>
    sent
      .splice(0)
      .filter((m) => m.source === "host" && m.action === action)
      .map((m) => m.request as Record<string, unknown>);
  return { driver, ask, grant, pushed, sent };
}
