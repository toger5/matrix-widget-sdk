/**
 * JSON for the logs and dumps. `originServerTs` and friends are `bigint` in the bindings, which
 * `JSON.stringify` refuses; file contents (`base64`) are cut short so an image does not flood a log.
 */
export const stringify = (data: unknown, indent?: number) =>
  JSON.stringify(
    data,
    (key, v: unknown) =>
      typeof v === "bigint" ? Number(v) : key === "base64" && typeof v === "string" && v.length > 80 ? `${v.slice(0, 80)}… (${v.length} chars)` : v,
    indent,
  );

export interface Envelope {
  action: string;
  direction: "request" | "response";
  requestId: string;
  body: unknown;
}

/** The parts of a widget API envelope, if `data` is one. */
export function envelope(data: unknown): Envelope | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const msg = data as Record<string, unknown>;
  if (typeof msg.action !== "string" || typeof msg.request_id !== "string") return undefined;
  const direction = "response" in msg ? "response" : "request";
  return { action: msg.action, direction, requestId: msg.request_id, body: msg[direction] };
}
