/** Decide how to embed a widget from its state event: directly (MSC4411) or via the compat wrapper (legacy). */

export interface HostConfig {
  roomId: string;
  userId: string;
  /** Where the compat wrapper is hosted, e.g. `https://example.org/compat/`. */
  wrapperUrl: string;
}

export interface StateEvent {
  type: string;
  state_key: string;
  content: Record<string, unknown>;
}

export interface ResolvedWidget {
  url: string;
  name: string;
  legacy: boolean;
  /** Hide the iframe until `content_loaded` arrives. */
  usesWidgetApi: boolean;
}

const NEW_TYPES = ["m.widget", "org.matrix.msc4411.widget"];
const LEGACY_TYPES = ["im.vector.modular.widgets"];

export function resolveWidget(event: StateEvent, config: HostConfig): ResolvedWidget {
  const { content } = event;
  if (typeof content.url !== "string") throw new Error("removed widget or missing `url`");
  const name = typeof content.name === "string" ? content.name : event.state_key;

  if (NEW_TYPES.includes(event.type)) {
    return { url: content.url, name, legacy: false, usesWidgetApi: content.usesWidgetAPI === true };
  }
  if (!LEGACY_TYPES.includes(event.type)) throw new Error(`not a widget state event: ${event.type}`);

  // Legacy: the host templates the URL as before (including the `widgetId` / `parentUrl` query
  // parameters legacy clients append), then hands it to the compat wrapper.
  const legacyUrl = new URL(template(content.url, event, config));
  if (!legacyUrl.searchParams.has("widgetId")) legacyUrl.searchParams.set("widgetId", event.state_key);
  legacyUrl.searchParams.set("parentUrl", location.origin + location.pathname);
  const query = new URLSearchParams({
    legacy_widget_url: legacyUrl.toString(),
    legacy_widget_id: event.state_key,
    legacy_wait_for_iframe_load: String(content.waitForIframeLoad !== false),
  });
  return { url: `${config.wrapperUrl}?${query}`, name, legacy: true, usesWidgetApi: true };
}

/** The subset of legacy URL templating this test host supports. */
export function template(url: string, event: StateEvent, config: HostConfig): string {
  const data = (event.content.data ?? {}) as Record<string, unknown>;
  const vars: Record<string, string> = {
    ...Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)])),
    matrix_user_id: config.userId,
    matrix_room_id: config.roomId,
    matrix_widget_id: event.state_key,
    matrix_display_name: config.userId,
    matrix_avatar_url: "",
  };
  return url.replace(/\$([\w.]+)/g, (match, key: string) => (key in vars ? encodeURIComponent(vars[key]) : match));
}
