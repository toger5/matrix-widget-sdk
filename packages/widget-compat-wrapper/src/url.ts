/**
 * The check in front of the inner iframe: which legacy widget URLs the wrapper loads at all.
 *
 * A client often serves the wrapper from its own origin, with `allow-same-origin` on the wrapper's
 * iframe, and the inner iframe has no sandbox. A `javascript:` URL there would run on the client's
 * origin; `data:`, `blob:` and `about:` pages, and a URL the iframe resolves against the wrapper
 * page (`/x`, `http:/x`), would be pages of that origin too. So the wrapper loads only absolute
 * `http:` and `https:` URLs that name their own host: the rule of `widget_url_problem` in
 * `crates/matrix-widget-host-driver/src/widget_url.rs` (with `http:` allowed), and its texts, which name
 * the scheme, never the URL.
 *
 * `parseConfig` checks the template in `legacy_widget_url`, so a refused widget fails before the
 * wrapper talks to the host; `templatedLegacyUrl` checks the template again and the templated URL,
 * which is what the iframe loads.
 */
import { renderLegacyUrl, type TemplateInput } from "./template";

const NOT_ABSOLUTE = "the URL is not an absolute http: or https: URL";

/**
 * Why the wrapper must not load `url` into its inner iframe, or `undefined`: only an absolute
 * `http:` or `https:` URL that is the same URL whatever page it is resolved against (pages of its
 * scheme on two hosts: a relative URL takes the host of the page, so it cannot equal itself on
 * both). A template that starts with a `$variable` has no scheme and is refused.
 */
export function legacyUrlProblem(url: string): string | undefined {
  if (!URL.canParse(url)) return NOT_ABSOLUTE;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `${parsed.protocol} URLs are not allowed, only http: and https:`;
  const sameOn = (host: string) => new URL(url, `${parsed.protocol}//${host}/`).href === parsed.href;
  return sameOn("a.invalid") && sameOn("b.invalid") ? undefined : NOT_ABSOLUTE;
}

/**
 * The legacy widget URL with its template variables filled in (`renderLegacyUrl`), checked before
 * and after: the URL to put into the inner iframe, or why there is none. Before, because
 * `renderLegacyUrl` serialises the URL, which makes `http:/x` look like the absolute `http://x/`;
 * after, because the templated URL is what the iframe loads. A template that does not give a URL
 * is refused as well.
 */
export function templatedLegacyUrl(url: string, input: TemplateInput): { url: string } | { problem: string } {
  const problem = legacyUrlProblem(url);
  if (problem !== undefined) return { problem };
  let templated: string;
  try {
    templated = renderLegacyUrl(url, input);
  } catch {
    return { problem: NOT_ABSOLUTE };
  }
  const after = legacyUrlProblem(templated);
  return after === undefined ? { url: new URL(templated).href } : { problem: after };
}
