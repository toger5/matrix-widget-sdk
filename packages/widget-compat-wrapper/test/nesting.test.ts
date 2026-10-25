import { describe, expect, it } from "vitest";

import { renderLegacyUrl } from "../src/template";
import { parseConfig } from "../src/wrapper";

describe("url nesting: host -> wrapper -> legacy widget", () => {
  it("survives three levels of query-parameter nesting", () => {
    // What the host does: legacy content.url untouched, as one query parameter of the wrapper url.
    const legacy = "https://widget.example/app/?user=$matrix_user_id&base=$org.matrix.msc4039.matrix_base_url&theme=$org.matrix.msc2873.client_theme";
    const wrapperUrl = `https://compat.example/?${new URLSearchParams({ legacy_widget_url: legacy, legacy_widget_id: "w1" })}`;

    // What the wrapper does with it.
    const config = parseConfig(new URL(wrapperUrl).searchParams);
    const resolved = new URL(
      renderLegacyUrl(config.legacyWidgetUrl, {
        widgetId: config.widgetId,
        wrapperUrl: "https://compat.example/",
        matrix: { user_id: "@alice:example.org", matrix_base_url: "https://matrix.example.org:8448/" },
        client: { client_theme: "dark" },
      }),
    );
    expect(Object.fromEntries(resolved.searchParams)).toEqual({
      user: "@alice:example.org",
      base: "https://matrix.example.org:8448/",
      theme: "dark",
      widgetId: "w1",
      parentUrl: "https://compat.example/",
    });
  });
});
