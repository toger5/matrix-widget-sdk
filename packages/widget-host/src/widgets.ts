/** Decide how to embed a widget from its state event: directly (MSC4411) or via the compat wrapper (legacy). */

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

/**
 * The only transition-specific code a client needs. The host never templates URLs: a legacy
 * widget's `content.url` is handed to the compat wrapper as is, and the wrapper resolves
 * `$matrix_user_id` & co. itself via the `matrix_context` / `client_context` actions.
 */
export function resolveWidget(event: StateEvent, wrapperUrl: string): ResolvedWidget {
  const { content } = event;
  if (typeof content.url !== "string") throw new Error("removed widget or missing `url`");
  const name = typeof content.name === "string" ? content.name : event.state_key;

  if (NEW_TYPES.includes(event.type)) {
    return { url: content.url, name, legacy: false, usesWidgetApi: content.usesWidgetAPI === true };
  }
  if (!LEGACY_TYPES.includes(event.type)) throw new Error(`not a widget state event: ${event.type}`);

  const query = new URLSearchParams({
    legacy_widget_url: content.url,
    legacy_widget_id: event.state_key,
    legacy_wait_for_iframe_load: String(content.waitForIframeLoad !== false),
  });
  if (content.data && Object.keys(content.data).length > 0) query.set("legacy_widget_data", JSON.stringify(content.data));
  return { url: `${wrapperUrl}?${query}`, name, legacy: true, usesWidgetApi: true };
}
