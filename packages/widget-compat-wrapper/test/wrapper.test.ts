import { describe, expect, it } from "vitest";

import { parseConfig } from "../src/wrapper";

describe("parseConfig", () => {
  const legacy = "https://widget.example/app/?widgetId=w1&x=$matrix_user_id";

  it("keeps the legacy url untemplated and reads the widget id from it", () => {
    const config = parseConfig(new URLSearchParams({ legacy_widget_url: legacy }));
    expect(config).toEqual({ legacyWidgetUrl: legacy, widgetId: "w1", widgetName: "w1", waitForIframeLoad: true, widgetData: undefined, clientOrigin: "*" });
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

  it("fails without a widget id", () => {
    expect(() => parseConfig(new URLSearchParams({ legacy_widget_url: "https://widget.example/" }))).toThrow(/legacy_widget_id/);
  });
});
