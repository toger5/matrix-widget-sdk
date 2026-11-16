/**
 * Envelope translation between the legacy matrix-widget-api wire format and MSC4412.
 *
 *     legacy:  { api: "fromWidget" | "toWidget", widgetId, requestId, action, data }
 *     MSC4412: { source: "widget" | "host", request_id, action, request }
 *
 * The two are told apart by `api` versus `source`; neither carries a version.
 *
 * Pure functions without state. Bodies are passed through and never inspected. Action names are
 * translated where the two protocols differ.
 */

/** Who started the exchange in the legacy protocol: `fromWidget` = the widget, `toWidget` = the host. */
export type LegacyApi = "fromWidget" | "toWidget";
/** Who started the exchange in MSC4412. */
export type Source = "widget" | "host";

/** A matrix-widget-api message. A response is the whole request again plus `response`. */
export interface LegacyMessage {
  api: LegacyApi;
  widgetId: string;
  requestId: string;
  action: string;
  /** The request body. */
  data?: unknown;
  /** Set on responses only. */
  response?: unknown;
}

/** An MSC4412 message. A message is a response if and only if it has `response`. */
export interface NewMessage {
  source: Source;
  request_id: string;
  /** `<namespace>.<name>`. */
  action: string;
  request?: unknown;
  response?: unknown;
}

/** Unstable namespace of what MSC4412 itself defines: the three core actions and the base error codes. */
export const MSC4412 = "org.matrix.msc4412";
/** Unstable namespace of actions that have no MSC of their own yet. */
export const PLACEHOLDER = "org.matrix.mscXXXX";

/** The core actions of MSC4412. */
export const NOTIFY_READY_ACTION = `${MSC4412}.notify_ready`;
export const REQUEST_CAPABILITIES_ACTION = `${MSC4412}.request_capabilities`;
export const UPDATE_CAPABILITIES_ACTION = `${MSC4412}.update_capabilities`;

/** The base error codes of MSC4412. */
export const ERROR_UNKNOWN = `${MSC4412}.unknown`;
export const ERROR_INVALID_REQUEST = `${MSC4412}.invalid_request`;
export const ERROR_MISSING_CAPABILITY = `${MSC4412}.missing_capability`;

/**
 * Legacy action names that differ from the host's, per source (who sends the action).
 *
 * - MSC4412 demands a namespace on every action, so every legacy name without one is listed.
 * - The core actions are renamed by MSC4412 itself (`content_loaded` → `notify_ready`,
 *   `notify_capabilities` → `update_capabilities`).
 * - The rest are the renames of the capability naming proposal
 *   (`docs/spec-appendix/capability-naming-proposal.md`): action names are verbs, and the host's
 *   deliveries are `forward_*` / `update_*` instead of sharing a name with the widget's requests.
 *
 * The host accepts none of the legacy names, so this table is the only place they are understood.
 * Every other action passes through: the host sends and accepts the unstable MSC spellings
 * (`org.matrix.msc2876.read_events`) the legacy api uses.
 */
const LEGACY_TO_NEW: Record<Source, Record<string, string>> = {
  widget: {
    content_loaded: NOTIFY_READY_ACTION,
    "org.matrix.msc2974.request_capabilities": REQUEST_CAPABILITIES_ACTION,
    send_event: `${PLACEHOLDER}.send_event`,
    send_to_device: `${PLACEHOLDER}.send_to_device`,
    get_openid: `${PLACEHOLDER}.get_openid`,
    watch_turn_servers: `${PLACEHOLDER}.watch_turn_servers`,
    unwatch_turn_servers: `${PLACEHOLDER}.unwatch_turn_servers`,
    set_always_on_screen: `${PLACEHOLDER}.set_always_on_screen`,
    "org.matrix.msc3973.user_directory_search": "org.matrix.msc3973.search_user_directory",
    "org.matrix.msc4533.rtc_livekit_get_token": "org.matrix.msc4533.get_rtc_livekit_token",
    "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave": "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave",
  },
  host: {
    notify_capabilities: UPDATE_CAPABILITIES_ACTION,
    send_event: `${PLACEHOLDER}.forward_event`,
    send_to_device: `${PLACEHOLDER}.forward_to_device`,
    update_state: `${PLACEHOLDER}.update_state`,
    update_turn_servers: `${PLACEHOLDER}.update_turn_servers`,
    theme_change: `${PLACEHOLDER}.update_theme`,
    language_change: `${PLACEHOLDER}.update_language`,
    visibility: `${PLACEHOLDER}.update_visibility`,
  },
};
const invert = (table: Record<string, string>) => Object.fromEntries(Object.entries(table).map(([legacy, next]) => [next, legacy]));
const NEW_TO_LEGACY: Record<Source, Record<string, string>> = { widget: invert(LEGACY_TO_NEW.widget), host: invert(LEGACY_TO_NEW.host) };

const lookup = (table: Record<string, string>, action: string): string => (Object.hasOwn(table, action) ? table[action] : action);

/** The host's name for the legacy action `action` sent by `source`. */
export const toNewAction = (action: string, source: Source): string => lookup(LEGACY_TO_NEW[source], action);
/** The legacy name for the host's action `action` sent by `source`. */
export const toLegacyAction = (action: string, source: Source): string => lookup(NEW_TO_LEGACY[source], action);

const isRecord = (m: unknown): m is Record<string, unknown> => typeof m === "object" && m !== null;

/** Does `m` have the shape of a legacy message? */
export function isLegacyMessage(m: unknown): m is LegacyMessage {
  return (
    isRecord(m) &&
    (m.api === "fromWidget" || m.api === "toWidget") &&
    typeof m.widgetId === "string" &&
    typeof m.requestId === "string" &&
    typeof m.action === "string"
  );
}

/** Does `m` have the shape of an MSC4412 message? */
export function isNewMessage(m: unknown): m is NewMessage {
  return (
    isRecord(m) &&
    (m.source === "widget" || m.source === "host") &&
    typeof m.request_id === "string" &&
    typeof m.action === "string"
  );
}

/** A legacy request becomes an MSC4412 request. The request id is kept so responses correlate. */
export function legacyRequestToNew(m: LegacyMessage): NewMessage {
  const source: Source = m.api === "fromWidget" ? "widget" : "host";
  return {
    source,
    request_id: m.requestId,
    action: toNewAction(m.action, source),
    request: m.data ?? {},
  };
}

/** An MSC4412 request becomes a legacy request addressed to `widgetId`. */
export function newRequestToLegacy(m: NewMessage, widgetId: string): LegacyMessage {
  return {
    api: m.source === "host" ? "toWidget" : "fromWidget",
    widgetId,
    requestId: m.request_id,
    action: toLegacyAction(m.action, m.source),
    data: m.request ?? {},
  };
}

/** Legacy responses echo the whole request and add `response`. */
export function legacyResponse(request: LegacyMessage, response: unknown): LegacyMessage {
  return { ...request, response };
}

/** MSC4412 responses repeat the header and add `response`; repeating `request` is optional and not done. */
export function newResponse(request: NewMessage, response: unknown): NewMessage {
  return {
    source: request.source,
    request_id: request.request_id,
    action: request.action,
    response,
  };
}

/** A legacy error body: `{ error: { message } }`. */
export const errorBody = (message: string) => ({ error: { message } });

/** An MSC4412 error body: the legacy shape plus the required, machine readable `code`. */
export const newErrorBody = (code: string, message: string) => ({ error: { code, message } });

/** Is `body` an error body? In both protocols that is a body whose `error` is an object. */
export const isErrorBody = (body: unknown): boolean => isRecord(body) && isRecord(body.error);

/**
 * A response body from the legacy widget, fit for the host: MSC4412 requires a `code` and a
 * `message` on every error, a legacy widget sends `{ error: { message } }`. A legacy error becomes
 * an `unknown` error; any other body is returned as it is.
 *
 * The other direction needs nothing: a legacy widget reads `error.message` (and
 * `error.matrix_api_error`) and ignores the `code`.
 */
export function legacyResponseBodyToNew(body: unknown): unknown {
  if (!isRecord(body) || !isRecord(body.error)) return body;
  const { code, message } = body.error;
  return {
    ...body,
    error: {
      ...body.error,
      code: typeof code === "string" ? code : ERROR_UNKNOWN,
      message: typeof message === "string" ? message : "The widget rejected the request",
    },
  };
}
