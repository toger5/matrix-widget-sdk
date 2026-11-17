import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { legacyUrlProblem, templatedLegacyUrl } from "../src/url";

/** The driver's table of widget URLs (`widget_url_problem` with `http:` allowed): the wrapper's check is the same rule. */
const TABLE = JSON.parse(readFileSync(new URL("../../../crates/widget-host-driver/tests/widget_urls.json", import.meta.url), "utf8")) as Record<"allowed" | "refused", Record<string, string>>;
const NOT_ABSOLUTE = "the URL is not an absolute http: or https: URL";

describe("legacyUrlProblem", () => {
  it.each(Object.entries(TABLE.allowed))("allows what the driver allows: %s", (_, url) => {
    expect(legacyUrlProblem(url)).toBeUndefined();
  });

  /**
   * Cases the driver refuses but the wrapper's check, which is the URL parser of the runtime, only
   * refuses on some Node versions. `https://xn--/`: UTS #46 makes an empty decoded punycode label
   * an error, and Node ≤ 24.5 (ada 3.x) refuses it, but Node 24.22 (ada 4.0) accepts it. Either way
   * it is an absolute https: URL, so loading it is not a page of the wrapper's origin.
   */
  const NODE_DEPENDENT = new Set(["invalid punycode"]);
  it.each(Object.entries(TABLE.refused).filter(([label]) => !NODE_DEPENDENT.has(label)))("refuses what the driver refuses: %s", (_, url) => {
    expect(legacyUrlProblem(url)).toEqual(expect.any(String));
  });

  it("names the scheme, never the URL, with the driver's texts", () => {
    expect(legacyUrlProblem("javascript:top.__pwned=document.domain//")).toBe("javascript: URLs are not allowed, only http: and https:");
    expect(legacyUrlProblem("data:text/html,<script>top.__pwned=1</script>")).toBe("data: URLs are not allowed, only http: and https:");
    expect(legacyUrlProblem("/widget/")).toBe(NOT_ABSOLUTE);
    expect(legacyUrlProblem("$matrix_widget_url")).toBe(NOT_ABSOLUTE);
    expect(legacyUrlProblem("$scheme://widget.example/")).toBe(NOT_ABSOLUTE);
    // Relative to the wrapper page when it has the same scheme: a page of the wrapper's own origin.
    expect(legacyUrlProblem("http:/widget_compatibility_wrapper/?legacy_widget_url=javascript:x")).toBe(NOT_ABSOLUTE);
  });
});

describe("templatedLegacyUrl", () => {
  const input = { widgetId: "w", wrapperUrl: "https://compat.example/", matrix: { user_id: "@alice:example.org" }, client: {} };

  it("is the templated URL, serialised, for an http(s) template", () => {
    expect(templatedLegacyUrl("HTTPS://Widget.example/?u=$matrix_user_id", input)).toEqual({
      url: "https://widget.example/?u=%40alice%3Aexample.org&widgetId=w&parentUrl=https%3A%2F%2Fcompat.example%2F",
    });
    expect(templatedLegacyUrl("http://localhost:5175/legacy/", input)).toMatchObject({ url: expect.stringMatching(/^http:\/\/localhost:5175\/legacy\/\?widgetId=w/) });
  });

  it("refuses a URL that is not http(s), also one the template does not make a URL", () => {
    expect(templatedLegacyUrl("javascript:top.__pwned=1//", input)).toEqual({ problem: "javascript: URLs are not allowed, only http: and https:" });
    expect(templatedLegacyUrl("$matrix_widget_url", input)).toEqual({ problem: NOT_ABSOLUTE });
    expect(templatedLegacyUrl("https://$matrix_user_id/", input)).toEqual({ problem: NOT_ABSOLUTE });
  });
});
