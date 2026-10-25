import { describe, expect, it } from "vitest";

import {
  legacyRequestToNew,
  legacyResponse,
  newRequestToLegacy,
  newResponse,
  toLegacyAction,
  toNewAction,
  isLegacyMessage,
  isNewMessage,
} from "../src/envelope";

describe("envelope translation", () => {
  it("maps a legacy fromWidget request to an MSC4412 widget request", () => {
    expect(
      legacyRequestToNew({ api: "fromWidget", widgetId: "w", requestId: "r1", action: "send_event", data: { a: 1 } }),
    ).toEqual({ source: "widget", version: "v1", requestId: "r1", action: "send_event", request: { a: 1 } });
  });

  it("maps an MSC4412 host request to a legacy toWidget request", () => {
    expect(newRequestToLegacy({ source: "host", version: "v1", requestId: "h1", action: "update_state", request: { state: [] } }, "w"))
      .toEqual({ api: "toWidget", widgetId: "w", requestId: "h1", action: "update_state", data: { state: [] } });
  });

  it("echoes the legacy request in its response and drops `request` in the new one", () => {
    const legacy = { api: "fromWidget" as const, widgetId: "w", requestId: "r", action: "x", data: { a: 1 } };
    expect(legacyResponse(legacy, { ok: true })).toEqual({ ...legacy, response: { ok: true } });
    expect(newResponse({ source: "host", version: "v1", requestId: "h", action: "x", request: { a: 1 } }, {})).toEqual({
      source: "host", version: "v1", requestId: "h", action: "x", response: {},
    });
  });

  it("renames the prefixed legacy actions in both directions and passes others through", () => {
    expect(toNewAction("org.matrix.msc2974.request_capabilities")).toBe("request_capabilities");
    expect(toLegacyAction("request_capabilities")).toBe("org.matrix.msc2974.request_capabilities");
    expect(toNewAction("org.matrix.msc2876.read_events")).toBe("org.matrix.msc2876.read_events");
    expect(toNewAction("org.example.custom")).toBe("org.example.custom");
    expect(toLegacyAction("send_event")).toBe("send_event");
  });

  it("recognises envelopes strictly", () => {
    expect(isLegacyMessage({ api: "fromWidget", widgetId: "w", requestId: "r", action: "a" })).toBe(true);
    expect(isLegacyMessage({ api: "sideways", widgetId: "w", requestId: "r", action: "a" })).toBe(false);
    expect(isNewMessage({ source: "host", requestId: "r", action: "a" })).toBe(true);
    expect(isNewMessage("nope")).toBe(false);
  });
});
