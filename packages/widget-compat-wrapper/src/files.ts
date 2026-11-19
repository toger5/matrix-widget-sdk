/**
 * File payloads. Legacy widgets send files as `Blob` (any `XMLHttpRequestBodyInit`), which does
 * not survive the JSON strings MSC4412 hosts pass messages through (UniFFI, WebView bridges).
 * Towards the host a file is `{ mimetype, base64 }`: in the `upload_file` request and the
 * `download_file` response.
 */

interface Base64File {
  mimetype?: string;
  base64: string;
}

export const UPLOAD_FILE_ACTION = "org.matrix.msc4039.upload_file";
export const DOWNLOAD_FILE_ACTION = "org.matrix.msc4039.download_file";

const isBase64File = (v: unknown): v is Base64File =>
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

/** Any `XMLHttpRequestBodyInit` as base64; `Response` picks the content type a browser would send. */
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
