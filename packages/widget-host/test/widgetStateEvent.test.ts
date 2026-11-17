/**
 * The host's glue to the driver's widget state event parser (`src/lib/widgetEvents.ts`) and the URL
 * check in front of every widget iframe. The parser itself is tested in Rust
 * (`crates/widget-host-driver/src/widget_{event,url}.rs`); here every URL of the shared table is
 * also compared with the WHATWG URL parser of Node, which the Rust check follows.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { InMemoryBackend, WidgetHostDriver, widgetEventTypes, type EmbedOptions, type WidgetIframe } from "@matrix-widget-tools/widget-host-bindings";

import { embedOptions, hostWidgetEvents, ownWidgetDirs, reasonOf, widgetEventParser, wrapperUrl } from "../src/lib/widgetEvents";
import { roomWidgets } from "../src/views/helpers";
import { localWidgetKey, WIDGET_EVENT_TYPES, widgetKey, type StateEvent } from "../src/widgetStateEvent";
import "./harness";

const WRAPPER = "http://localhost:5173/widget_compatibility_wrapper/";

/**
 * What the host loads for a widget state event, as it gets there: the parser's definition
 * (`parseWidget`), then the iframe a `WidgetHostDriver` made from it asks for when it starts.
 * Throws the reason for an event that is no widget or must not be loaded.
 */
/** `EmbedOptions` of this host, or of this host with the compat wrapper at a URL. */
const optionsOf = (options: EmbedOptions | string = embedOptions()) => (typeof options === "string" ? embedOptions(options) : options);
const widgetUrlProblem = (url: string, options?: EmbedOptions | string) => widgetEventParser(optionsOf(options)).urlProblem(url);

function resolveWidget(event: StateEvent, options?: EmbedOptions | string) {
  const { widget, problem } = widgetEventParser(optionsOf(options)).resolve(event) ?? { problem: "the event describes no widget" };
  if (!widget || problem) throw new Error(problem);
  const iframes: WidgetIframe[] = [];
  const platform = { loadIframe: (iframe: WidgetIframe) => void iframes.push(iframe), sendToWidget: () => {}, onCapabilitiesRequested: () => {}, onReady: () => {}, navigate: () => {}, setAlwaysOnScreen: () => false, clientId: () => undefined, clientTheme: () => undefined, clientLanguage: () => undefined };
  let driver: WidgetHostDriver;
  try {
    driver = new WidgetHostDriver(widget, optionsOf(options), new InMemoryBackend("!room:example.org", "@alice:example.org").asBackend(), platform);
  } catch (e) {
    throw new Error(reasonOf(e));
  }
  driver.start();
  driver.uniffiDestroy();
  return { ...iframes[0], widget };
}
const newWidget = (url: string): StateEvent => ({ type: "m.widget", state_key: "w", content: { name: "W", url, uses_widget_api: true } });
const legacyWidget = (url: string): StateEvent => ({ type: "im.vector.modular.widgets", state_key: "w", content: { type: "m.custom", name: "W", url } });

/** The table the Rust tests use too: label → URL. */
const TABLE = JSON.parse(readFileSync(new URL("../../../crates/widget-host-driver/tests/widget_urls.json", import.meta.url), "utf8")) as Record<"allowed" | "refused", Record<string, string>> & {
  compat_wrapper: { wrapper: string } & Record<"allowed" | "refused", Record<string, string>>;
  client_origin: { client: string; own_widget_dirs: string[] } & Record<"refused" | "own_widgets" | "other_origins", Record<string, string>>;
};
const ALLOWED = Object.entries(TABLE.allowed);
const REFUSED = Object.entries(TABLE.refused);
const LOADS_THE_WRAPPER = "a widget cannot load this client's compat wrapper";
const ON_THE_CLIENTS_ORIGIN = "a widget cannot be a page of this client's own origin";

const NOT_ABSOLUTE = "the URL is not an absolute http: or https: URL";
/** The rule of `widget_url_problem`, on Node's URL parser: absolute, http(s), and the same URL when resolved against pages of its scheme on two hosts. */
function reference(url: string): string | undefined {
  if (!URL.canParse(url)) return NOT_ABSOLUTE;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `${parsed.protocol} URLs are not allowed, only http: and https:`;
  const sameOn = (host: string) => new URL(url, `${parsed.protocol}//${host}/`).href === parsed.href;
  return sameOn("a.invalid") && sameOn("b.invalid") ? undefined : NOT_ABSOLUTE;
}

describe("widgetUrlProblem", () => {
  it.each(ALLOWED)("allows %s", (_, url) => {
    expect(widgetUrlProblem(url)).toBeUndefined();
  });

  it.each(REFUSED)("refuses %s", (_, url) => {
    expect(widgetUrlProblem(url)).toEqual(expect.any(String));
  });

  it.each([...ALLOWED, ...REFUSED])("answers like the WHATWG URL parser of Node: %s", (_, url) => {
    expect(widgetUrlProblem(url)).toBe(reference(url));
  });

  it("names the scheme, never the URL", () => {
    expect(widgetUrlProblem("JAVASCRIPT:alert(1)")).toBe("javascript: URLs are not allowed, only http: and https:");
    expect(widgetUrlProblem("$matrix_widget_url")).toBe(NOT_ABSOLUTE);
  });
});

describe("the compat wrapper is no widget", () => {
  const { wrapper } = TABLE.compat_wrapper;
  const parser = widgetEventParser(embedOptions(wrapper));

  it.each(Object.entries(TABLE.compat_wrapper.refused))("refuses %s, for both widget kinds", (_, url) => {
    expect(widgetUrlProblem(url, wrapper)).toBe(LOADS_THE_WRAPPER);
    expect(parser.urlProblem(url)).toBe(LOADS_THE_WRAPPER);
    expect(() => resolveWidget(newWidget(url), wrapper)).toThrow(LOADS_THE_WRAPPER);
    expect(() => resolveWidget(legacyWidget(url), wrapper)).toThrow(LOADS_THE_WRAPPER);
    expect(parser.resolve(newWidget(url))).toMatchObject({ widget: { name: "W", url, widgetId: "w" }, problem: LOADS_THE_WRAPPER });
  });

  it.each(Object.entries(TABLE.compat_wrapper.allowed))("allows %s", (_, url) => {
    expect(widgetUrlProblem(url, wrapper)).toBeUndefined();
    expect(resolveWidget(newWidget(url), wrapper).url).toBe(new URL(url).href);
  });

  it("is the compat wrapper of this host by default", () => {
    const own = wrapperUrl();
    expect(widgetUrlProblem(`${own}?legacy_widget_url=javascript:top.__pwned=1//&legacy_widget_id=evil`)).toBe(LOADS_THE_WRAPPER);
    expect(hostWidgetEvents.urlProblem(own)).toBe(LOADS_THE_WRAPPER);
  });
});

describe("no widget on this host's origin but its own test widgets", () => {
  const { client, own_widget_dirs: dirs } = TABLE.client_origin;
  const options = { ...embedOptions(`${client}/widget_compatibility_wrapper/`, client), ownWidgetDirs: dirs };
  const parser = widgetEventParser(options);

  it.each(Object.entries(TABLE.client_origin.refused))("refuses %s, for both widget kinds", (_, url) => {
    expect(widgetUrlProblem(url, options)).toBe(ON_THE_CLIENTS_ORIGIN);
    expect(parser.urlProblem(url)).toBe(ON_THE_CLIENTS_ORIGIN);
    expect(() => resolveWidget(newWidget(url), options)).toThrow(ON_THE_CLIENTS_ORIGIN);
    expect(() => resolveWidget(legacyWidget(url), options)).toThrow(ON_THE_CLIENTS_ORIGIN);
    expect(parser.resolve(newWidget(url))).toMatchObject({ widget: { name: "W", url, widgetId: "w" }, problem: ON_THE_CLIENTS_ORIGIN });
  });

  it.each(Object.entries({ ...TABLE.client_origin.own_widgets, ...TABLE.client_origin.other_origins }))("allows %s", (_, url) => {
    expect(widgetUrlProblem(url, options)).toBeUndefined();
    expect(resolveWidget(newWidget(url), options).url).toBe(new URL(url).href);
  });

  it("knows its origin only in a browser: outside one (these tests) the check is off", () => {
    expect(embedOptions().clientOrigin).toBeUndefined();
    expect(widgetUrlProblem(`${client}/some/widget/`)).toBeUndefined();
    expect(widgetUrlProblem(`${client}/some/widget/`, embedOptions(wrapperUrl(), client))).toBe(ON_THE_CLIENTS_ORIGIN);
  });

  it("takes the test widgets' directory as its own, unless it holds the host itself", () => {
    // The dev site: the host at <base>host/, the test widgets at <base>widgets/.
    expect(ownWidgetDirs("https://dev.example/sdk/host/", "https://dev.example/sdk/widgets/")).toEqual(["https://dev.example/sdk/widgets/"]);
    expect(ownWidgetDirs("http://localhost:5173/", "http://localhost:5175/")).toEqual(["http://localhost:5175/"]);
    // A directory that holds the host would make the host itself a widget.
    expect(ownWidgetDirs("https://dev.example/sdk/host/", "https://dev.example/sdk/")).toEqual([]);
    expect(ownWidgetDirs("http://localhost:5173/", "http://localhost:5173/")).toEqual([]);
  });
});

describe("what the driver loads for a widget state event", () => {
  it.each(ALLOWED)("loads a new widget's URL as the driver checked it, which is how Node serialises it: %s", (_, url) => {
    expect(resolveWidget(newWidget(url), WRAPPER).url).toBe(new URL(url).href);
  });

  it("embeds a new widget directly and a legacy widget through the compat wrapper, untemplated", () => {
    const strict = { sandbox: "allow-scripts allow-same-origin", allow: "" };
    expect(resolveWidget(newWidget("https://example.org/?x=$y"), WRAPPER)).toMatchObject({ url: "https://example.org/?x=$y", origin: "https://example.org", ...strict, widget: { name: "W", legacy: undefined, usesWidgetApi: true } });
    const legacy = resolveWidget({ ...legacyWidget("https://example.org/?t=$title"), content: { url: "https://example.org/?t=$title", data: { title: "Notes & more" } } }, WRAPPER);
    expect(legacy.widget).toMatchObject({ name: "w", url: "https://example.org/?t=$title", usesWidgetApi: false, legacy: { waitForIframeLoad: true } });
    expect(legacy.origin).toBe("http://localhost:5173");
    expect(legacy.sandbox).toContain("allow-forms");
    const query = new URL(legacy.url).searchParams;
    expect(legacy.url.startsWith(`${WRAPPER}?`)).toBe(true);
    expect([...query.keys()]).toEqual(["legacy_widget_url", "legacy_widget_id", "legacy_wait_for_iframe_load", "legacy_widget_data"]);
    expect(query.get("legacy_widget_url")).toBe("https://example.org/?t=$title");
    expect(JSON.parse(query.get("legacy_widget_data")!)).toEqual({ title: "Notes & more" });
  });

  it.each(REFUSED)("refuses %s for both widget kinds", (_, url) => {
    expect(() => resolveWidget(newWidget(url), WRAPPER)).toThrow(widgetUrlProblem(url));
    expect(() => resolveWidget(legacyWidget(url), WRAPPER)).toThrow(widgetUrlProblem(url));
  });

  it("refuses a compat wrapper URL that is not http(s) (`?wrapper=`), and an m.widget without a name (MSC4411: removed)", () => {
    expect(() => resolveWidget(legacyWidget("https://example.org/"), "javascript:top.__pwned=1//")).toThrow("compat wrapper: javascript: URLs are not allowed");
    expect(() => resolveWidget({ type: "m.widget", state_key: "w", content: { url: "https://example.org/" } }, WRAPPER)).toThrow("the event describes no widget");
  });

  it("hands the event's own URL and state key to the driver (the bindings drop a leading U+FEFF of a string they return)", () => {
    // Accepted after the round trip, refused as the event has it: the iframe would resolve it against the host page.
    expect(() => resolveWidget(newWidget("﻿https://example.org/"), WRAPPER)).toThrow(NOT_ABSOLUTE);
    const legacy = resolveWidget({ ...legacyWidget("https://example.org/"), state_key: "﻿w" }, WRAPPER);
    expect(new URL(legacy.url).searchParams.get("legacy_widget_id")).toBe("﻿w");
  });

  it("puts the widget into the compat wrapper's query, replacing what a `?wrapper=` URL planted there", () => {
    const planted = `${WRAPPER}?legacy_widget_url=javascript:top.__pwned=1//&legacy_widget_id=evil&log_level=debug`;
    const query = new URL(resolveWidget(legacyWidget("https://example.org/"), planted).url).searchParams;
    expect([...query]).toEqual([
      ["log_level", "debug"],
      ["legacy_widget_url", "https://example.org/"],
      ["legacy_widget_id", "w"],
      ["legacy_wait_for_iframe_load", "true"],
    ]);
  });

  it("knows the event types of the driver", () => {
    expect(WIDGET_EVENT_TYPES).toEqual(widgetEventTypes());
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
  const parser = widgetEventParser(embedOptions(WRAPPER));

  it("lists a refused widget with the problem (disabled in the room overview) and nothing to run", () => {
    const [refused] = roomWidgets(parser, { widgetEvents: [legacyWidget("javascript:top.__pwned=1//")] });
    expect(refused).toMatchObject({ key: "im.vector.modular.widgets/w", name: "W", problem: "javascript: URLs are not allowed, only http: and https:" });
    expect(refused.widget).toBeUndefined();
  });

  it("lists the local widgets after the room's, marked and keyed apart, each checked like a room widget; removed ones not at all", () => {
    const room = newWidget("https://room.example.org/");
    const nameless = { type: "m.widget", state_key: "nameless", content: { url: "https://example.org/" } };
    const local = [newWidget("https://local.example.org/"), legacyWidget("javascript:top.__pwned=1//"), { type: "m.widget", state_key: "gone", content: {} }];
    const widgets = roomWidgets(parser, { widgetEvents: [room, nameless] }, local);
    expect(widgets.map((w) => [w.key, w.local ?? false])).toEqual([
      ["m.widget/w", false],
      ["local:m.widget/w", true],
      ["local:im.vector.modular.widgets/w", true],
    ]);
    expect(widgets[1].widget?.url).toBe("https://local.example.org/");
    expect(widgets[2]).toMatchObject({ problem: "javascript: URLs are not allowed, only http: and https:", local: true });
    expect(widgets[2].widget).toBeUndefined();
    // A room without its widgets loaded yet still lists the local ones.
    expect(roomWidgets(parser, undefined, [local[0]]).map((w) => w.key)).toEqual(["local:m.widget/w"]);
  });
});
