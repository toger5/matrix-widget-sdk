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

  it("translates the action of a request by its direction", () => {
    expect(legacyRequestToNew({ api: "fromWidget", widgetId: "w", requestId: "r", action: "org.matrix.msc3973.user_directory_search" }).action)
      .toBe("org.matrix.msc3973.search_user_directory");
    expect(newRequestToLegacy({ source: "host", version: "v1", requestId: "h", action: "forward_event", request: {} }, "w").action)
      .toBe("send_event");
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

  it("renames the widget's legacy actions in both directions", () => {
    const renamed = [
      ["org.matrix.msc2974.request_capabilities", "request_capabilities"],
      ["org.matrix.msc3973.user_directory_search", "org.matrix.msc3973.search_user_directory"],
      ["org.matrix.msc4533.rtc_livekit_get_token", "org.matrix.msc4533.get_rtc_livekit_token"],
      ["org.matrix.msc4533.rtc_livekit_delegate_delayed_leave", "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave"],
    ];
    for (const [legacy, next] of renamed) {
      expect(toNewAction(legacy, "widget")).toBe(next);
      expect(toLegacyAction(next, "widget")).toBe(legacy);
    }
  });

  it("renames the host's actions in both directions", () => {
    const renamed = [
      ["send_event", "forward_event"],
      ["send_to_device", "forward_to_device"],
      ["openid_credentials", "forward_openid_credentials"],
      ["theme_change", "update_theme"],
      ["language_change", "update_language"],
      ["visibility", "update_visibility"],
    ];
    for (const [legacy, next] of renamed) {
      expect(toLegacyAction(next, "host")).toBe(legacy);
      expect(toNewAction(legacy, "host")).toBe(next);
    }
  });

  it("renames by direction: the widget's send_event and send_to_device stay as they are", () => {
    for (const action of ["send_event", "send_to_device"]) {
      expect(toNewAction(action, "widget")).toBe(action);
      expect(toLegacyAction(action, "widget")).toBe(action);
    }
    // ... and the host has no action of that name any more.
    expect(toLegacyAction("send_event", "host")).toBe("send_event");
    expect(toLegacyAction("forward_event", "widget")).toBe("forward_event");
  });

  it("passes every other action through", () => {
    for (const action of ["org.matrix.msc2876.read_events", "org.example.custom", "update_state", "update_turn_servers", "notify_capabilities", "get_openid", "constructor", "toString"]) {
      expect(toNewAction(action, "widget")).toBe(action);
      expect(toNewAction(action, "host")).toBe(action);
      expect(toLegacyAction(action, "widget")).toBe(action);
      expect(toLegacyAction(action, "host")).toBe(action);
    }
  });

  it("recognises envelopes strictly", () => {
    expect(isLegacyMessage({ api: "fromWidget", widgetId: "w", requestId: "r", action: "a" })).toBe(true);
    expect(isLegacyMessage({ api: "sideways", widgetId: "w", requestId: "r", action: "a" })).toBe(false);
    expect(isNewMessage({ source: "host", requestId: "r", action: "a" })).toBe(true);
    expect(isNewMessage("nope")).toBe(false);
  });
});
