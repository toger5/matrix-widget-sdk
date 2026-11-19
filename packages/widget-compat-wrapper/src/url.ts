/**
 * Which legacy widget URLs the wrapper loads. The wrapper often runs on the client's origin with
 * `allow-same-origin`, so a `javascript:`, `data:`, `blob:` or `about:` URL, or one resolved
 * against the wrapper page (`/x`, `http:/x`), would run as that origin. Only absolute `http:` /
 * `https:` URLs that name their own host are loaded: the rule (and texts) of `widget_url_problem`
 * in `crates/matrix-widget-host-driver/src/widget_url.rs`, with `http:` allowed.
 */
import { renderLegacyUrl, type TemplateInput } from "./template";

const NOT_ABSOLUTE = "the URL is not an absolute http: or https: URL";

/**
 * Why the wrapper must not load `url`, or `undefined`. A URL is absolute when it resolves to
 * itself against pages on two different hosts.
 */
export function legacyUrlProblem(url: string): string | undefined {
  if (!URL.canParse(url)) return NOT_ABSOLUTE;
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return `${parsed.protocol} URLs are not allowed, only http: and https:`;
  const sameOn = (host: string) => new URL(url, `${parsed.protocol}//${host}/`).href === parsed.href;
  return sameOn("a.invalid") && sameOn("b.invalid") ? undefined : NOT_ABSOLUTE;
}

/**
 * The templated legacy URL for the inner iframe, or why there is none. Checked before templating
 * (serialising turns `http:/x` into the absolute `http://x/`) and after (that is what loads).
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
