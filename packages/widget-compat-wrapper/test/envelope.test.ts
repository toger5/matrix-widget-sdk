import { describe, expect, it } from "vitest";

import {
  legacyRequestToNew,
  legacyResponse,
  newRequestToLegacy,
  newResponse,
  toLegacyAction,
  toNewAction,
  isErrorBody,
  isLegacyMessage,
  isNewMessage,
  legacyResponseBodyToNew,
  newErrorBody,
} from "../src/envelope";

describe("envelope translation", () => {
  it("maps a legacy fromWidget request to an MSC4412 widget request", () => {
    expect(
      legacyRequestToNew({ api: "fromWidget", widgetId: "w", requestId: "r1", action: "send_event", data: { a: 1 } }),
    ).toEqual({ source: "widget", request_id: "r1", action: "org.matrix.mscXXXX.send_event", request: { a: 1 } });
  });

  it("translates the action of a request by its direction", () => {
    expect(legacyRequestToNew({ api: "fromWidget", widgetId: "w", requestId: "r", action: "org.matrix.msc3973.user_directory_search" }).action)
      .toBe("org.matrix.msc3973.search_user_directory");
    expect(newRequestToLegacy({ source: "host", request_id: "h", action: "org.matrix.mscXXXX.forward_event", request: {} }, "w").action)
      .toBe("send_event");
  });

  it("maps an MSC4412 host request to a legacy toWidget request", () => {
    expect(newRequestToLegacy({ source: "host", request_id: "h1", action: "org.matrix.mscXXXX.update_state", request: { state: [] } }, "w"))
      .toEqual({ api: "toWidget", widgetId: "w", requestId: "h1", action: "update_state", data: { state: [] } });
  });

  it("echoes the legacy request in its response and does not repeat `request` in the new one", () => {
    const legacy = { api: "fromWidget" as const, widgetId: "w", requestId: "r", action: "x", data: { a: 1 } };
    expect(legacyResponse(legacy, { ok: true })).toEqual({ ...legacy, response: { ok: true } });
    expect(newResponse({ source: "host", request_id: "h", action: "x", request: { a: 1 } }, {})).toEqual({
      source: "host", request_id: "h", action: "x", response: {},
    });
  });

  it("renames the widget's legacy actions in both directions", () => {
    const renamed = [
      ["content_loaded", "org.matrix.msc4412.notify_ready"],
      ["org.matrix.msc2974.request_capabilities", "org.matrix.msc4412.request_capabilities"],
      ["send_event", "org.matrix.mscXXXX.send_event"],
      ["send_to_device", "org.matrix.mscXXXX.send_to_device"],
      ["get_openid", "org.matrix.mscXXXX.get_openid"],
      ["watch_turn_servers", "org.matrix.mscXXXX.watch_turn_servers"],
      ["unwatch_turn_servers", "org.matrix.mscXXXX.unwatch_turn_servers"],
      ["set_always_on_screen", "org.matrix.mscXXXX.set_always_on_screen"],
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
      ["notify_capabilities", "org.matrix.msc4412.update_capabilities"],
      ["send_event", "org.matrix.mscXXXX.forward_event"],
      ["send_to_device", "org.matrix.mscXXXX.forward_to_device"],
      ["update_state", "org.matrix.mscXXXX.update_state"],
      ["update_turn_servers", "org.matrix.mscXXXX.update_turn_servers"],
      ["theme_change", "org.matrix.mscXXXX.update_theme"],
      ["language_change", "org.matrix.mscXXXX.update_language"],
      ["visibility", "org.matrix.mscXXXX.update_visibility"],
    ];
    for (const [legacy, next] of renamed) {
      expect(toLegacyAction(next, "host")).toBe(legacy);
      expect(toNewAction(legacy, "host")).toBe(next);
    }
    // The host has no action for the legacy `openid_credentials` any more: the bridge sends it itself.
    expect(toNewAction("openid_credentials", "host")).toBe("openid_credentials");
  });

  it("renames by direction: send_event means sending for the widget and forwarding for the host", () => {
    expect(toNewAction("send_event", "widget")).toBe("org.matrix.mscXXXX.send_event");
    expect(toNewAction("send_event", "host")).toBe("org.matrix.mscXXXX.forward_event");
    // The host has no `send_event` and the widget no `forward_event`: both pass through.
    expect(toLegacyAction("org.matrix.mscXXXX.send_event", "host")).toBe("org.matrix.mscXXXX.send_event");
    expect(toLegacyAction("org.matrix.mscXXXX.forward_event", "widget")).toBe("org.matrix.mscXXXX.forward_event");
  });

  it("passes every other action through", () => {
    for (const action of ["org.matrix.msc2876.read_events", "org.matrix.msc2931.navigate", "com.beeper.read_room_account_data", "org.example.custom", "supported_api_versions", "constructor", "toString"]) {
      expect(toNewAction(action, "widget")).toBe(action);
      expect(toNewAction(action, "host")).toBe(action);
      expect(toLegacyAction(action, "widget")).toBe(action);
      expect(toLegacyAction(action, "host")).toBe(action);
    }
  });

  it("recognises envelopes strictly", () => {
    expect(isLegacyMessage({ api: "fromWidget", widgetId: "w", requestId: "r", action: "a" })).toBe(true);
    expect(isLegacyMessage({ api: "sideways", widgetId: "w", requestId: "r", action: "a" })).toBe(false);
    expect(isNewMessage({ source: "host", request_id: "r", action: "a" })).toBe(true);
    // The pre-MSC4412 spelling of the request id, and a legacy message, are not MSC4412.
    expect(isNewMessage({ source: "host", requestId: "r", action: "a" })).toBe(false);
    expect(isNewMessage({ api: "toWidget", widgetId: "w", requestId: "r", action: "a" })).toBe(false);
    expect(isNewMessage("nope")).toBe(false);
  });

  it("gives a legacy error the code MSC4412 requires", () => {
    expect(legacyResponseBodyToNew({ error: { message: "nope" } })).toEqual({ error: { code: "org.matrix.msc4412.unknown", message: "nope" } });
    expect(legacyResponseBodyToNew({ error: {} })).toEqual({ error: { code: "org.matrix.msc4412.unknown", message: "The widget rejected the request" } });
    // An error that already has a code, and bodies that are not errors, are left alone.
    const coded = { error: { code: "org.example.custom", message: "x", extra: 1 } };
    expect(legacyResponseBodyToNew(coded)).toEqual(coded);
    expect(legacyResponseBodyToNew({ error: "a string is not an error" })).toEqual({ error: "a string is not an error" });
    expect(legacyResponseBodyToNew({ events: [] })).toEqual({ events: [] });
    expect(isErrorBody({ error: { message: "x" } })).toBe(true);
    expect(isErrorBody({ error: "x" })).toBe(false);
    expect(newErrorBody("c", "m")).toEqual({ error: { code: "c", message: "m" } });
  });
});
