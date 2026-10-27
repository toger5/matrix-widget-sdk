/**
 * Envelope translation between the legacy matrix-widget-api wire format and MSC4412.
 *
 *     legacy:  { api: "fromWidget" | "toWidget", widgetId, requestId, action, data }
 *     MSC4412: { source: "widget" | "host", version: "v1", requestId, action, request }
 *
 * Pure functions without state. Bodies are passed through and never inspected.
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
 * Legacy action names that MSC4412 renamed.
 *
 * Only `request_capabilities` is renamed by MSC4412 itself. Every other action passes through:
 * the host already sends and accepts the unstable MSC spellings (`org.matrix.msc2876.read_events`).
 */
const LEGACY_TO_NEW: Record<string, string> = {
  "org.matrix.msc2974.request_capabilities": "request_capabilities",
};
const NEW_TO_LEGACY = Object.fromEntries(Object.entries(LEGACY_TO_NEW).map(([legacy, next]) => [next, legacy]));

export const toNewAction = (action: string): string => LEGACY_TO_NEW[action] ?? action;
export const toLegacyAction = (action: string): string => NEW_TO_LEGACY[action] ?? action;

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
  return {
    source: m.api === "fromWidget" ? "widget" : "host",
    version: API_VERSION,
    requestId: m.requestId,
    action: toNewAction(m.action),
    request: m.data ?? {},
  };
}

/** An MSC4412 request becomes a legacy request addressed to `widgetId`. */
export function newRequestToLegacy(m: NewMessage, widgetId: string): LegacyMessage {
  return {
    api: m.source === "host" ? "toWidget" : "fromWidget",
    widgetId,
    requestId: m.requestId,
    action: toLegacyAction(m.action),
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
