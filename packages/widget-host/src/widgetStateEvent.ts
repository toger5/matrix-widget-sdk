/** Decide how to embed a widget from its state event: directly (MSC4411), via the compat wrapper (legacy), or not at all (not an http(s) URL). */

export interface StateEvent {
  type: string;
  state_key: string;
  content: Record<string, unknown>;
}

export interface ResolvedWidget {
  url: string;
  name: string;
  legacy: boolean;
  /** `uses_widget_api` (MSC4412): set up the widget API and hide the iframe until `notify_ready` arrives. */
  usesWidgetApi: boolean;
}

const NEW_TYPES = ["m.widget", "org.matrix.msc4411.widget"];
const LEGACY_TYPES = ["im.vector.modular.widgets"];
/** Every state event type that describes a widget. */
export const WIDGET_EVENT_TYPES = [...NEW_TYPES, ...LEGACY_TYPES];

/** Whether a widget state event describes a widget: removing a widget leaves an event without a `url` behind. */
export const describesWidget = (event: StateEvent) => typeof event.content.url === "string";

/** Identifies a widget within a room: two event types may use the same state key. */
export const widgetKey = (event: Pick<StateEvent, "type" | "state_key">) => `${event.type}/${event.state_key}`;

/**
 * Why a widget URL cannot be embedded, or `undefined` when it can: only absolute `http:` and
 * `https:` URLs. A `javascript:`, `data:`, `blob:`, `about:` or relative URL would run in, or
 * inherit, the origin of the page that loads it; for a legacy widget that is the compat wrapper,
 * which is served from the host's origin. Parsed as the browser parses an iframe's `src`: leading
 * spaces and control characters, tabs and newlines are dropped, the scheme is case-insensitive.
 * A legacy URL is checked as the template it is: one that starts with a `$variable` has no scheme
 * and is refused, since the variable could expand to one; after the scheme a variable cannot
 * change it (the wrapper URI-encodes what it fills in).
 */
export function widgetUrlProblem(url: string): string | undefined {
  if (!URL.canParse(url)) return "the URL is not an absolute http: or https: URL";
  const { protocol } = new URL(url);
  return protocol === "http:" || protocol === "https:" ? undefined : `${protocol} URLs are not allowed, only http: and https:`;
}

/**
 * The only transition-specific code a client needs, and the one place where a state event
 * becomes something the host puts into an iframe: it throws for a URL `widgetUrlProblem` refuses.
 * The host never templates URLs: a legacy widget's `content.url` is handed to the compat wrapper
 * as is, and the wrapper resolves `$matrix_user_id` & co. itself via the `get_matrix_context` /
 * `get_client_context` actions.
 */
export function resolveWidget(event: StateEvent, wrapperUrl: string): ResolvedWidget {
  const { content } = event;
  if (typeof content.url !== "string") throw new Error("removed widget or missing `url`");
  const problem = widgetUrlProblem(content.url);
  if (problem) throw new Error(problem);
  const name = typeof content.name === "string" ? content.name : event.state_key;

  if (NEW_TYPES.includes(event.type)) {
    return { url: content.url, name, legacy: false, usesWidgetApi: content.uses_widget_api === true };
  }
  if (!LEGACY_TYPES.includes(event.type)) throw new Error(`not a widget state event: ${event.type}`);
  // `?wrapper=` can replace the wrapper by a link, so its URL is checked too.
  const wrapperProblem = widgetUrlProblem(wrapperUrl);
  if (wrapperProblem) throw new Error(`compat wrapper: ${wrapperProblem}`);

  const query = new URLSearchParams({
    legacy_widget_url: content.url,
    legacy_widget_id: event.state_key,
    legacy_wait_for_iframe_load: String(content.waitForIframeLoad !== false),
  });
  if (content.data && Object.keys(content.data).length > 0) query.set("legacy_widget_data", JSON.stringify(content.data));
  return { url: `${wrapperUrl}?${query}`, name, legacy: true, usesWidgetApi: true };
}

/**
 * Capabilities granted to a legacy widget (behind the compat wrapper) without a prompt, because a
 * legacy client did not ask for them either: the facts it put into the widget URL, the theme,
 * language and visibility updates, and asking for an OpenID token (which still asks per request).
 */
export const LEGACY_AUTO_APPROVED = [
  "widget:org.matrix.mscXXXX.get_matrix_context",
  "widget:org.matrix.mscXXXX.get_client_context",
  "widget:org.matrix.mscXXXX.get_openid",
  "host:org.matrix.mscXXXX.update_theme",
  "host:org.matrix.mscXXXX.update_language",
  "host:org.matrix.mscXXXX.update_visibility",
];
