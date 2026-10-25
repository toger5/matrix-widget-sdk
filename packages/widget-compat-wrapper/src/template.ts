/**
 * Legacy URL templating, moved from the host into the wrapper.
 *
 * Legacy clients substituted `$matrix_user_id` & co. into the widget URL before loading it. An
 * MSC4412 host passes the URL untouched; the wrapper obtains the same facts through the
 * `matrix_context` / `client_context` actions and substitutes them here. Variable names and
 * semantics follow matrix-widget-api's `runTemplate`: values are URI-encoded, unknown
 * variables are left alone, keys of the state event's `data` are variables too and explicit
 * variables win over `data`.
 */

export interface MatrixContext {
  user_id: string;
  device_id: string;
  room_id: string;
  display_name: string;
  avatar_url: string;
  matrix_base_url: string;
}

export interface ClientContext {
  client_id?: string;
  client_theme?: string;
  client_language?: string;
}

export interface TemplateInput {
  widgetId: string;
  /** Set as the legacy `parentUrl` query parameter: the widget's parent is the wrapper. */
  wrapperUrl: string;
  matrix: Partial<MatrixContext>;
  client: ClientContext;
  /** `content.data` of the legacy state event. */
  data?: Record<string, unknown>;
}

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

/** Substitute the template variables and add the `widgetId` / `parentUrl` query parameters. */
export function renderLegacyUrl(url: string, input: TemplateInput): string {
  const vars = templateVariables(input);
  const templated = url.replace(/\$([\w.]+)/g, (match, key: string) => (key in vars ? encodeURIComponent(vars[key]) : match));
  const result = new URL(templated);
  if (!result.searchParams.has("widgetId")) result.searchParams.set("widgetId", input.widgetId);
  result.searchParams.set("parentUrl", input.wrapperUrl);
  return result.toString();
}
