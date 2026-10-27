/**
 * Legacy URL templating, moved from the host into the wrapper.
 *
 * Legacy clients replaced `$matrix_user_id` & co. in the widget URL before loading it. An MSC4412
 * host loads the URL as it is. The wrapper gets the same facts from the `matrix_context` and
 * `client_context` actions and fills them in here.
 *
 * The rules are those of matrix-widget-api's `runTemplate`:
 * - values are URI-encoded;
 * - unknown variables stay as they are;
 * - every key of the state event's `data` is a variable too;
 * - the built-in variables win over `data`.
 */

/** The `matrix_context` response (see the Rust `MatrixContextResponse`). */
export interface MatrixContext {
  user_id: string;
  device_id: string;
  room_id: string;
  display_name: string;
  avatar_url: string;
  matrix_base_url: string;
}

/** The `client_context` response (see the Rust `ClientContextResponse`). */
export interface ClientContext {
  client_id?: string;
  client_theme?: string;
  client_language?: string;
}

/** Everything the template variables are filled from. */
export interface TemplateInput {
  widgetId: string;
  /** Set as the legacy `parentUrl` query parameter: the widget's parent is the wrapper. */
  wrapperUrl: string;
  /** Partial: a context the host refused leaves its variables empty. */
  matrix: Partial<MatrixContext>;
  client: ClientContext;
  /** `content.data` of the legacy state event. */
  data?: Record<string, unknown>;
}

/** Every template variable by name (without the `$`). Missing facts are empty strings. */
export function templateVariables({ widgetId, matrix, client, data }: TemplateInput): Record<string, string> {
  return {
    ...Object.fromEntries(Object.entries(data ?? {}).map(([k, v]) => [k, String(v)])),
    matrix_user_id: matrix.user_id ?? "",
    matrix_room_id: matrix.room_id ?? "",
    matrix_widget_id: widgetId,
    matrix_display_name: matrix.display_name ?? matrix.user_id ?? "",
    matrix_avatar_url: matrix.avatar_url ?? "",
    "org.matrix.msc3819.matrix_device_id": matrix.device_id ?? "",
    "org.matrix.msc4039.matrix_base_url": matrix.matrix_base_url ?? "",
    "org.matrix.msc2873.client_id": client.client_id ?? "",
    "org.matrix.msc2873.client_theme": client.client_theme ?? "",
    "org.matrix.msc2873.client_language": client.client_language ?? "",
  };
}

/**
 * Fill in the template variables of a legacy widget URL, then add the query parameters legacy
 * clients added: `widgetId` (unless already there) and `parentUrl` (always the wrapper).
 */
export function renderLegacyUrl(url: string, input: TemplateInput): string {
  const vars = templateVariables(input);
  const templated = url.replace(/\$([\w.]+)/g, (match, key: string) => (key in vars ? encodeURIComponent(vars[key]) : match));
  const result = new URL(templated);
  if (!result.searchParams.has("widgetId")) result.searchParams.set("widgetId", input.widgetId);
  result.searchParams.set("parentUrl", input.wrapperUrl);
  return result.toString();
}
