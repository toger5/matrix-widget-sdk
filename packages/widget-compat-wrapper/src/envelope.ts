/**
 * Envelope translation between the legacy matrix-widget-api wire format and MSC4412.
 *
 *     legacy:  { api: "fromWidget" | "toWidget", widgetId, requestId, action, data }
 *     MSC4412: { source: "widget" | "host", version: "v1", requestId, action, request }
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

/** An MSC4412 message. A response repeats the header and has `response` instead of `request`. */
export interface NewMessage {
  source: Source;
  /** `v1`. Absent only on messages that are not MSC4412. */
  version?: string;
  requestId: string;
  action: string;
  request?: unknown;
  response?: unknown;
}

export const API_VERSION = "v1";

/**
 * Legacy action names that differ from the host's, per source (who sends the action).
 *
 * - `request_capabilities` is renamed by MSC4412 itself.
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
    "org.matrix.msc2974.request_capabilities": "request_capabilities",
    "org.matrix.msc3973.user_directory_search": "org.matrix.msc3973.search_user_directory",
    "org.matrix.msc4533.rtc_livekit_get_token": "org.matrix.msc4533.get_rtc_livekit_token",
    "org.matrix.msc4533.rtc_livekit_delegate_delayed_leave": "org.matrix.msc4533.delegate_rtc_livekit_delayed_leave",
  },
  host: {
    send_event: "forward_event",
    send_to_device: "forward_to_device",
    openid_credentials: "forward_openid_credentials",
    theme_change: "update_theme",
    language_change: "update_language",
    visibility: "update_visibility",
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
    typeof m.requestId === "string" &&
    typeof m.action === "string"
  );
}

/** A legacy request becomes an MSC4412 request. `requestId` is kept so responses correlate. */
export function legacyRequestToNew(m: LegacyMessage): NewMessage {
  const source: Source = m.api === "fromWidget" ? "widget" : "host";
  return {
    source,
    version: API_VERSION,
    requestId: m.requestId,
    action: toNewAction(m.action, source),
    request: m.data ?? {},
  };
}

/** An MSC4412 request becomes a legacy request addressed to `widgetId`. */
export function newRequestToLegacy(m: NewMessage, widgetId: string): LegacyMessage {
  return {
    api: m.source === "host" ? "toWidget" : "fromWidget",
    widgetId,
    requestId: m.requestId,
    action: toLegacyAction(m.action, m.source),
    data: m.request ?? {},
  };
}

/** Legacy responses echo the whole request and add `response`. */
export function legacyResponse(request: LegacyMessage, response: unknown): LegacyMessage {
  return { ...request, response };
}

/** MSC4412 responses repeat the header, drop `request` and add `response`. */
export function newResponse(request: NewMessage, response: unknown): NewMessage {
  return {
    source: request.source,
    version: request.version ?? API_VERSION,
    requestId: request.requestId,
    action: request.action,
    response,
  };
}

/** The error body both protocols use. */
export const errorBody = (message: string) => ({ error: { message } });

/** Is `body` an error body (see {@link errorBody})? */
export const isErrorBody = (body: unknown): boolean => isRecord(body) && "error" in body;
