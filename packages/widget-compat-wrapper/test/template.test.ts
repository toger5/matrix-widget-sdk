import { describe, expect, it } from "vitest";

import { renderLegacyUrl } from "../src/template";

const input = {
  widgetId: "w1",
  wrapperUrl: "https://compat.example/",
  matrix: {
    user_id: "@alice:example.org",
    device_id: "DEV",
    room_id: "!room:example.org",
    display_name: "Alice",
    avatar_url: "mxc://example.org/a",
    matrix_base_url: "https://matrix.example.org",
  },
  client: { client_id: "io.element.web", client_theme: "dark" },
  data: { title: "Notes & more" },
};

describe("renderLegacyUrl", () => {
  it("substitutes and URI-encodes the legacy template variables", () => {
    const url = new URL(
      renderLegacyUrl(
        "https://w.example/?u=$matrix_user_id&r=$matrix_room_id&w=$matrix_widget_id&n=$matrix_display_name&d=$org.matrix.msc3819.matrix_device_id&b=$org.matrix.msc4039.matrix_base_url&c=$org.matrix.msc2873.client_id&t=$title#frag",
        input,
      ),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      u: "@alice:example.org", r: "!room:example.org", w: "w1", n: "Alice", d: "DEV",
      b: "https://matrix.example.org", c: "io.element.web", t: "Notes & more",
      widgetId: "w1", parentUrl: "https://compat.example/",
    });
    expect(url.hash).toBe("#frag");
  });

  it("leaves unknown variables alone, keeps an existing widgetId and overrides parentUrl", () => {
    const url = renderLegacyUrl("https://w.example/?x=$unknown&widgetId=given&parentUrl=https%3A%2F%2Fhost.example", input);
    const params = new URL(url).searchParams;
    expect(params.get("x")).toBe("$unknown");
    expect(params.get("widgetId")).toBe("given");
    expect(params.get("parentUrl")).toBe("https://compat.example/");
  });

  it("falls back to empty values and the user id as display name", () => {
    const url = renderLegacyUrl("https://w.example/?n=$matrix_display_name&a=$matrix_avatar_url&l=$org.matrix.msc2873.client_language", {
      ...input, matrix: { user_id: "@bob:example.org" }, client: {},
    });
    expect(Object.fromEntries(new URL(url).searchParams)).toMatchObject({ n: "@bob:example.org", a: "", l: "" });
  });
});
