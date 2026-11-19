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
  it("maps requests in both directions, renaming the action by its source", () => {
    expect(
      legacyRequestToNew({ api: "fromWidget", widgetId: "w", requestId: "r1", action: "send_event", data: { a: 1 } }),
    ).toEqual({ source: "widget", request_id: "r1", action: "org.matrix.mscXXXX.send_event", request: { a: 1 } });
    expect(newRequestToLegacy({ source: "host", request_id: "h1", action: "org.matrix.mscXXXX.forward_event", request: { state: [] } }, "w"))
      .toEqual({ api: "toWidget", widgetId: "w", requestId: "h1", action: "send_event", data: { state: [] } });
  });

  it("echoes the legacy request in its response and does not repeat `request` in the new one", () => {
    const legacy = { api: "fromWidget" as const, widgetId: "w", requestId: "r", action: "x", data: { a: 1 } };
    expect(legacyResponse(legacy, { ok: true })).toEqual({ ...legacy, response: { ok: true } });
    expect(newResponse({ source: "host", request_id: "h", action: "x", request: { a: 1 } }, {})).toEqual({
      source: "host", request_id: "h", action: "x", response: {},
    });
  });

  it.each([
    ["widget", "content_loaded", "org.matrix.msc4412.notify_ready"],
    ["widget", "org.matrix.msc2974.request_capabilities", "org.matrix.msc4412.request_capabilities"],
    ["widget", "send_event", "org.matrix.mscXXXX.send_event"],
    ["widget", "send_to_device", "org.matrix.mscXXXX.send_to_device"],
    ["widget", "get_openid", "org.matrix.mscXXXX.get_openid"],
    ["widget", "watch_turn_servers", "org.matrix.mscXXXX.watch_turn_servers"],
    ["widget", "unwatch_turn_servers", "org.matrix.mscXXXX.unwatch_turn_servers"],
    ["widget", "set_always_on_screen", "org.matrix.mscXXXX.set_always_on_screen"],
    ["widget", "org.matrix.msc3973.user_directory_search", "org.matrix.msc3973.search_user_directory"],
    ["widget", "org.matrix.msc4533.rtc_livekit_get_token", "org.matrix.msc4533.get_rtc_livekit_token"],
    ["widget", "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave", "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave"],
    ["host", "notify_capabilities", "org.matrix.msc4412.update_capabilities"],
    ["host", "send_event", "org.matrix.mscXXXX.forward_event"],
    ["host", "send_to_device", "org.matrix.mscXXXX.forward_to_device"],
    ["host", "update_state", "org.matrix.mscXXXX.update_state"],
    ["host", "update_turn_servers", "org.matrix.mscXXXX.update_turn_servers"],
    ["host", "theme_change", "org.matrix.mscXXXX.update_theme"],
    ["host", "language_change", "org.matrix.mscXXXX.update_language"],
    ["host", "visibility", "org.matrix.mscXXXX.update_visibility"],
  ] as const)("renames the %s's %s to %s and back", (source, legacy, next) => {
    expect(toNewAction(legacy, source)).toBe(next);
    expect(toLegacyAction(next, source)).toBe(legacy);
  });

  it("renames by direction: send_event means sending for the widget and forwarding for the host", () => {
    expect(toNewAction("send_event", "widget")).toBe("org.matrix.mscXXXX.send_event");
    expect(toNewAction("send_event", "host")).toBe("org.matrix.mscXXXX.forward_event");
    // The host has no `send_event` and the widget no `forward_event`: both pass through.
    expect(toLegacyAction("org.matrix.mscXXXX.send_event", "host")).toBe("org.matrix.mscXXXX.send_event");
    expect(toLegacyAction("org.matrix.mscXXXX.forward_event", "widget")).toBe("org.matrix.mscXXXX.forward_event");
  });

  it("passes every other action through", () => {
    // `openid_credentials` too: the bridge sends it itself.
    for (const action of ["openid_credentials", "org.matrix.msc2876.read_events", "org.matrix.msc2931.navigate", "com.beeper.read_room_account_data", "org.example.custom", "supported_api_versions", "constructor", "toString"]) {
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
