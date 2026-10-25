/**
 * Envelope translation between the legacy matrix-widget-api wire format and MSC4412.
 *
 * Legacy:  { api: "fromWidget"|"toWidget", widgetId, requestId, action, data }   + response (echo)
 * MSC4412: { source: "widget"|"host", version: "v1", requestId, action, request } / response
 *
 * Pure functions, no state. Bodies are never inspected.
 */

export type LegacyApi = "fromWidget" | "toWidget";
export type Source = "widget" | "host";

export interface LegacyMessage {
  api: LegacyApi;
  widgetId: string;
  requestId: string;
  action: string;
  data?: unknown;
  response?: unknown;
}

export interface NewMessage {
  source: Source;
  version?: string;
  requestId: string;
  action: string;
  request?: unknown;
  response?: unknown;
}

export const API_VERSION = "v1";

/** Legacy action names that MSC4412 spells differently. Everything else passes through. */
const LEGACY_TO_NEW: Record<string, string> = {
  "org.matrix.msc2974.request_capabilities": "request_capabilities",
  "org.matrix.msc2876.read_events": "read_events",
};
const NEW_TO_LEGACY = Object.fromEntries(Object.entries(LEGACY_TO_NEW).map(([legacy, next]) => [next, legacy]));

export const toNewAction = (action: string): string => LEGACY_TO_NEW[action] ?? action;
export const toLegacyAction = (action: string): string => NEW_TO_LEGACY[action] ?? action;

const isRecord = (m: unknown): m is Record<string, unknown> => typeof m === "object" && m !== null;

export function isLegacyMessage(m: unknown): m is LegacyMessage {
  return (
    isRecord(m) &&
    (m.api === "fromWidget" || m.api === "toWidget") &&
    typeof m.widgetId === "string" &&
    typeof m.requestId === "string" &&
    typeof m.action === "string"
  );
}

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
