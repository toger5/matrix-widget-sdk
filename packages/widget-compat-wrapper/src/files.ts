/**
 * File payloads.
 *
 * Legacy widgets send files as `Blob` (more generally any `XMLHttpRequestBodyInit`). A `Blob`
 * survives `postMessage`, but not the JSON strings every MSC4412 host passes them through (UniFFI,
 * the Android / iOS WebView bridges). So towards the host a file is always
 *
 *   { "mimetype": "image/png", "base64": "iVBORw0…" }
 *
 * Two actions carry a file: `upload_file` (widget → host, in the request) and `download_file`
 * (host → widget, in the response).
 */

/** A file as it travels between the wrapper and an MSC4412 host. */
export interface Base64File {
  mimetype?: string;
  base64: string;
}

export const UPLOAD_FILE_ACTION = "org.matrix.msc4039.upload_file";
export const DOWNLOAD_FILE_ACTION = "org.matrix.msc4039.download_file";

export const isBase64File = (v: unknown): v is Base64File =>
  typeof v === "object" && v !== null && typeof (v as Base64File).base64 === "string";

/** The body of a legacy `upload_file` request, with its `file` converted to base64. */
export async function uploadRequestToNew(data: unknown): Promise<Record<string, unknown>> {
  const body = (data ?? {}) as Record<string, unknown>;
  return { ...body, file: await toBase64File(body.file) };
}

/** The body of a host's `download_file` response, with its base64 `file` converted to a `Blob`. */
export function downloadResponseToLegacy(response: unknown): unknown {
  const file = (response as { file?: unknown } | undefined)?.file;
  return isBase64File(file) ? { ...(response as object), file: fromBase64File(file) } : response;
}

/**
 * Convert any `XMLHttpRequestBodyInit` (Blob, ArrayBuffer, typed array, string, URLSearchParams,
 * FormData) to base64.
 *
 * `Response` reads the body and picks the content type a browser would send for it. A value that
 * already is a `Base64File` is returned unchanged.
 */
export async function toBase64File(value: unknown): Promise<Base64File> {
  if (isBase64File(value)) return value;
  const response = new Response(value as BodyInit);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimetype = response.headers.get("content-type") ?? undefined;
  return mimetype ? { mimetype, base64: bytesToBase64(bytes) } : { base64: bytesToBase64(bytes) };
}

/** Convert a base64 file back to the `Blob` a legacy widget expects. */
export function fromBase64File(file: Base64File): Blob {
  return new Blob([base64ToBytes(file.base64)], file.mimetype ? { type: file.mimetype } : undefined);
}

function bytesToBase64(bytes: Uint8Array): string {
  // In chunks: `String.fromCharCode(...bytes)` exceeds the argument limit for large files.
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
