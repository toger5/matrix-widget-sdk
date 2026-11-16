/** The URL check in front of every widget iframe: only absolute http: and https: URLs are embedded, for both widget kinds. */
import { describe, expect, it } from "vitest";

import { roomWidgets } from "../src/views/helpers";
import { localWidgetKey, resolveWidget, widgetKey, widgetUrlProblem, type StateEvent } from "../src/widgetStateEvent";

const WRAPPER = "http://localhost:5173/widget_compatibility_wrapper/";
const newWidget = (url: string): StateEvent => ({ type: "m.widget", state_key: "w", content: { name: "W", url, uses_widget_api: true } });
const legacyWidget = (url: string): StateEvent => ({ type: "im.vector.modular.widgets", state_key: "w", content: { type: "m.custom", name: "W", url } });

const ALLOWED = [
  "http://localhost:5175/new/",
  "https://example.org/widget?x=1#y",
  "HTTPS://Example.org/",
  // Template variables after the scheme: the compat wrapper URI-encodes what it fills in.
  "https://example.org/?room=$matrix_room_id&user=$matrix_user_id",
  // Dropped by the URL parser, as by the iframe.
  "  https://example.org/",
];

const REFUSED: Record<string, string> = {
  "javascript:": "javascript:top.__pwned=document.domain//",
  "uppercase JAVASCRIPT:": "JAVASCRIPT:alert(1)",
  "mixed case": "JaVaScRiPt:alert(1)",
  "spaces and control characters before the scheme": " \t\n\u0000\u001fjavascript:alert(1)",
  "tab and newline inside the scheme": "java\tscr\nipt:alert(1)",
  "a non-breaking space before the scheme": "\u00a0javascript:alert(1)",
  "data:": "data:text/html,<script>top.__pwned=1</script>",
  "blob:": "blob:http://localhost:5173/0c1f8a52-5c3e-4b8e-9f0e-6f1d2a3b4c5d",
  "file:": "file:///etc/passwd",
  "about:": "about:srcdoc",
  "relative path": "/widget/",
  "protocol-relative": "//evil.example/",
  "no scheme": "example.org/widget",
  "starts with a template variable": "$matrix_widget_url",
  "a template variable in the scheme": "http$x://example.org/",
  empty: "",
};

describe("widgetUrlProblem", () => {
  it.each(ALLOWED)("allows %j", (url) => {
    expect(widgetUrlProblem(url)).toBeUndefined();
  });

  it.each(Object.entries(REFUSED))("refuses %s", (_, url) => {
    expect(widgetUrlProblem(url)).toEqual(expect.any(String));
  });

  it("names the scheme, never the URL", () => {
    expect(widgetUrlProblem("JAVASCRIPT:alert(1)")).toBe("javascript: URLs are not allowed, only http: and https:");
    expect(widgetUrlProblem("$matrix_widget_url")).toBe("the URL is not an absolute http: or https: URL");
  });
});

describe("resolveWidget", () => {
  it.each(ALLOWED)("embeds %j directly or through the compat wrapper", (url) => {
    expect(resolveWidget(newWidget(url), WRAPPER)).toMatchObject({ url, legacy: false });
    const legacy = resolveWidget(legacyWidget(url), WRAPPER);
    expect(legacy.legacy).toBe(true);
    expect(new URL(legacy.url).searchParams.get("legacy_widget_url")).toBe(url);
  });

  it.each(Object.entries(REFUSED))("refuses %s for both widget kinds", (_, url) => {
    expect(() => resolveWidget(newWidget(url), WRAPPER)).toThrow(/http: and https:|http: or https:/);
    expect(() => resolveWidget(legacyWidget(url), WRAPPER)).toThrow(/http: and https:|http: or https:/);
  });

  it("refuses a compat wrapper URL that is not http(s) (`?wrapper=`)", () => {
    expect(() => resolveWidget(legacyWidget("https://example.org/"), "javascript:top.__pwned=1//")).toThrow("compat wrapper: javascript: URLs are not allowed");
  });
});

describe("localWidgetKey", () => {
  it("is the widget key with `local:` before it, so it never equals a room widget's key", () => {
    const event = newWidget("https://example.org/");
    expect(localWidgetKey(event)).toBe("local:m.widget/w");
    expect(localWidgetKey(event)).not.toBe(widgetKey(event));
    expect(localWidgetKey(legacyWidget("https://example.org/"))).toBe("local:im.vector.modular.widgets/w");
  });
});

describe("roomWidgets", () => {
  it("lists a refused widget with the problem (disabled in the room overview) and nothing to run", () => {
    const [refused] = roomWidgets({ widgetEvents: [legacyWidget("javascript:top.__pwned=1//")] });
    expect(refused).toMatchObject({ key: "im.vector.modular.widgets/w", name: "W", problem: "javascript: URLs are not allowed, only http: and https:" });
    expect(refused.widget).toBeUndefined();
  });

  it("lists the local widgets after the room's, marked and keyed apart, each checked like a room widget", () => {
    const room = newWidget("https://room.example.org/");
    const local = [newWidget("https://local.example.org/"), legacyWidget("javascript:top.__pwned=1//"), { type: "m.widget", state_key: "gone", content: {} }];
    const widgets = roomWidgets({ widgetEvents: [room] }, local);
    expect(widgets.map((w) => [w.key, w.local ?? false])).toEqual([
      ["m.widget/w", false],
      ["local:m.widget/w", true],
      ["local:im.vector.modular.widgets/w", true],
    ]);
    expect(widgets[1].widget?.url).toBe("https://local.example.org/");
    expect(widgets[2]).toMatchObject({ problem: "javascript: URLs are not allowed, only http: and https:", local: true });
    expect(widgets[2].widget).toBeUndefined();
    // A room without its widgets loaded yet still lists the local ones.
    expect(roomWidgets(undefined, [local[0]]).map((w) => w.key)).toEqual(["local:m.widget/w"]);
  });
});
