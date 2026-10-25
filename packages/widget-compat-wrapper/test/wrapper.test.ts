import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/wrapper";

describe("parseConfig", () => {
  const legacy = "https://widget.example/app/?widgetId=w1&parentUrl=https%3A%2F%2Fhost.example%2F&x=1";

  it("reads the widget id from the legacy url and rewrites parentUrl to the wrapper", () => {
    const config = parseConfig(new URLSearchParams({ legacy_widget_url: legacy }), "https://compat.example/");
    expect(config.widgetId).toBe("w1");
    expect(config.waitForIframeLoad).toBe(true);
    expect(config.clientOrigin).toBe("*");
    const url = new URL(config.legacyWidgetUrl);
    expect(url.searchParams.get("parentUrl")).toBe("https://compat.example/");
    expect(url.searchParams.get("x")).toBe("1");
  });

  it("prefers explicit parameters", () => {
    const config = parseConfig(
      new URLSearchParams({ legacy_widget_url: legacy, legacy_widget_id: "other", legacy_wait_for_iframe_load: "false", client_origin: "https://host.example" }),
      "https://compat.example/",
    );
    expect(config).toMatchObject({ widgetId: "other", waitForIframeLoad: false, clientOrigin: "https://host.example" });
  });

  it("fails without a widget id", () => {
    expect(() => parseConfig(new URLSearchParams({ legacy_widget_url: "https://widget.example/" }), "https://compat.example/")).toThrow(/legacy_widget_id/);
  });
});
