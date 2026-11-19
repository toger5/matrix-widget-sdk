/**
 * Envelope translation between the legacy matrix-widget-api wire format and MSC4412.
 *
 *     legacy:  { api: "fromWidget" | "toWidget", widgetId, requestId, action, data }
 *     MSC4412: { source: "widget" | "host", request_id, action, request }
 *
 * Pure functions. Bodies pass through uninspected; action names are translated where they differ.
 */

/** Who started the exchange in the legacy protocol: `fromWidget` = the widget, `toWidget` = the host. */
type LegacyApi = "fromWidget" | "toWidget";
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

/** Unstable namespace of what MSC4412 itself defines: the core actions and the base error codes. */
const MSC4412 = "org.matrix.msc4412";
/** Unstable namespace of actions that have no MSC of their own yet. */
export const PLACEHOLDER = "org.matrix.mscXXXX";

export const NOTIFY_READY_ACTION = `${MSC4412}.notify_ready`;
export const REQUEST_CAPABILITIES_ACTION = `${MSC4412}.request_capabilities`;
export const UPDATE_CAPABILITIES_ACTION = `${MSC4412}.update_capabilities`;

const ERROR_UNKNOWN = `${MSC4412}.unknown`;
export const ERROR_INVALID_REQUEST = `${MSC4412}.invalid_request`;
export const ERROR_MISSING_CAPABILITY = `${MSC4412}.missing_capability`;

/**
 * Legacy action names that differ from the host's, per source (who sends the action): every
 * legacy name without a namespace, MSC4412's core renames, and the renames of
 * `docs/spec-appendix/capability-naming-proposal.md` (verbs; host deliveries are `forward_*` /
 * `update_*`). The host accepts none of them: this table is the only place they are understood.
 * Every other action passes through unchanged.
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

/** A legacy request as an MSC4412 request; the request id is kept so responses correlate. */
export function legacyRequestToNew(m: LegacyMessage): NewMessage {
  const source: Source = m.api === "fromWidget" ? "widget" : "host";
  return {
    source,
    request_id: m.requestId,
    action: toNewAction(m.action, source),
    request: m.data ?? {},
  };
}

/** An MSC4412 request as a legacy request addressed to `widgetId`. */
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

/** MSC4412 responses repeat the header and add `response` (repeating `request` is optional). */
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

/** An MSC4412 error body: the legacy shape plus the required `code`. */
export const newErrorBody = (code: string, message: string) => ({ error: { code, message } });

/** In both protocols an error body is one whose `error` is an object. */
export const isErrorBody = (body: unknown): boolean => isRecord(body) && isRecord(body.error);

/**
 * A legacy widget's response body, fit for the host: MSC4412 requires `code` and `message` on
 * every error, so a legacy error becomes `unknown`. The other direction needs nothing: a legacy
 * widget reads `error.message` and ignores `code`.
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
