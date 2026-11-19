import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

import { log, setLogLevel } from "../src/log";

import { INNER_ALLOW, INNER_SANDBOX, innerIframe, parseConfig } from "../src/wrapper";

/** The `client_origin` part of the driver's table of widget URLs: here the wrapper is on the client's origin. */
const CLIENT_ORIGIN = (
  JSON.parse(readFileSync(new URL("../../../crates/matrix-widget-host-driver/tests/widget_urls.json", import.meta.url), "utf8")) as {
    client_origin: { client: string } & Record<"refused" | "own_widgets" | "other_origins", Record<string, string>>;
  }
).client_origin;

describe("parseConfig", () => {
  const legacy = "https://widget.example/app/?widgetId=w1&x=$matrix_user_id";

  it("keeps the legacy url untemplated and reads the widget id from it", () => {
    const config = parseConfig(new URLSearchParams({ legacy_widget_url: legacy }));
    expect(config).toEqual({ legacyWidgetUrl: legacy, widgetId: "w1", widgetName: "w1", waitForIframeLoad: true, widgetData: undefined, clientOrigin: "*", logLevel: "warn" });
  });

  it("prefers explicit parameters and parses widget data", () => {
    const config = parseConfig(
      new URLSearchParams({
        legacy_widget_url: legacy, legacy_widget_id: "other", legacy_wait_for_iframe_load: "false",
        client_origin: "https://host.example", legacy_widget_data: JSON.stringify({ title: "t" }),
      }),
    );
    expect(config).toMatchObject({ widgetId: "other", waitForIframeLoad: false, clientOrigin: "https://host.example", widgetData: { title: "t" } });
  });

  it("reads the log level and falls back to warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(parseConfig(new URLSearchParams({ legacy_widget_url: legacy, log_level: "debug" })).logLevel).toBe("debug");
    expect(warn).not.toHaveBeenCalled();
    expect(parseConfig(new URLSearchParams({ legacy_widget_url: legacy, log_level: "loud" })).logLevel).toBe("warn");
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });

  it("logs only at or above the level", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    log.warn("shown");
    log.debug("hidden");
    setLogLevel("debug");
    log.debug("shown");
    setLogLevel("off");
    log.warn("hidden");
    setLogLevel("warn");
    expect(warn.mock.calls).toEqual([["[widget-compat-wrapper]", "shown"]]);
    expect(debug.mock.calls).toEqual([["[widget-compat-wrapper]", "shown"]]);
    warn.mockRestore();
    debug.mockRestore();
  });

  it("refuses a legacy_widget_url that is not an absolute http(s) URL", () => {
    // The cases of the check itself are in url.test.ts.
    for (const [url, problem] of [
      [" JAVASCRIPT:alert(1)", "javascript: URLs are not allowed, only http: and https:"],
      ["http:/widget_compatibility_wrapper/?widgetId=w", "the URL is not an absolute http: or https: URL"],
    ]) {
      expect(() => parseConfig(new URLSearchParams({ legacy_widget_url: url, legacy_widget_id: "w" })), url).toThrow(`refused \`legacy_widget_url\`: ${problem}`);
    }
    for (const url of ["http://localhost:5175/legacy/", "https://widget.example/?u=$matrix_user_id"]) {
      expect(parseConfig(new URLSearchParams({ legacy_widget_url: url, legacy_widget_id: "w" })).legacyWidgetUrl).toBe(url);
    }
  });

  it("fails without a widget id", () => {
    expect(() => parseConfig(new URLSearchParams({ legacy_widget_url: "https://widget.example/" }))).toThrow(/legacy_widget_id/);
  });
});

describe("innerIframe", () => {
  const wrapperOrigin = CLIENT_ORIGIN.client;

  it.each(Object.entries(CLIENT_ORIGIN.other_origins))("loads a legacy widget of another origin with them, messages to its origin: %s", (_, url) => {
    expect(innerIframe(url, wrapperOrigin)).toEqual({ sandbox: INNER_SANDBOX, allow: INNER_ALLOW, targetOrigin: new URL(url).origin });
  });

  it.each(Object.entries({ ...CLIENT_ORIGIN.refused, ...CLIENT_ORIGIN.own_widgets }))(
    "loads a legacy widget of the wrapper's own origin without allow-same-origin, messages to `*`: %s",
    (_, url) => {
      const inner = innerIframe(url, wrapperOrigin);
      expect(inner.sandbox.split(" ")).not.toContain("allow-same-origin");
      expect(inner.sandbox).toBe("allow-forms allow-popups allow-popups-to-escape-sandbox allow-scripts allow-presentation allow-downloads");
      expect(inner).toMatchObject({ allow: INNER_ALLOW, targetOrigin: "*" });
    },
  );
});
