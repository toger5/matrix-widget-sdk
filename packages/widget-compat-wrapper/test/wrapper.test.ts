import { describe, expect, it, vi } from "vitest";

import { log, setLogLevel } from "../src/log";

import { parseConfig } from "../src/wrapper";

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

  it("fails without a widget id", () => {
    expect(() => parseConfig(new URLSearchParams({ legacy_widget_url: "https://widget.example/" }))).toThrow(/legacy_widget_id/);
  });
});
