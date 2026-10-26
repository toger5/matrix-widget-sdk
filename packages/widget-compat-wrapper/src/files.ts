/**
 * File payloads: legacy widgets carry files as `Blob` (more generally `XMLHttpRequestBodyInit`)
 * through structured cloning, which survives `postMessage` but not the JSON string boundary every
 * MSC4412 host has (UniFFI, Android / iOS WebView bridges). Towards the host a file is always
 *
 *   { "mimetype": "image/png", "base64": "iVBORw0…" }
 *
 * and the wrapper converts on the three actions that carry one.
 */

/** A file as it travels between the wrapper and an MSC4412 host. */
export interface Base64File {
  mimetype?: string;
  base64: string;
}

export const UPLOAD_FILE_ACTION = "org.matrix.msc4039.upload_file";
export const DOWNLOAD_FILE_ACTION = "org.matrix.msc4039.download_file";
export const SCREENSHOT_ACTION = "screenshot";

export const isBase64File = (v: unknown): v is Base64File =>
  typeof v === "object" && v !== null && typeof (v as Base64File).base64 === "string";

/**
 * Any `XMLHttpRequestBodyInit` (Blob, ArrayBuffer, typed array, string, URLSearchParams,
 * FormData) to base64. `Response` does the reading and picks the content type the browser would
 * send for the same body; a value that already is a `Base64File` is returned as is.
 */
export async function toBase64File(value: unknown): Promise<Base64File> {
  if (isBase64File(value)) return value;
  const response = new Response(value as BodyInit);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const mimetype = response.headers.get("content-type") ?? undefined;
  return mimetype ? { mimetype, base64: bytesToBase64(bytes) } : { base64: bytesToBase64(bytes) };
}

/** The `Blob` a legacy widget expects back. */
export function fromBase64File(file: Base64File): Blob {
  return new Blob([base64ToBytes(file.base64)], file.mimetype ? { type: file.mimetype } : undefined);
}

function bytesToBase64(bytes: Uint8Array): string {
  // Chunked: String.fromCharCode(...bytes) overflows the argument limit for large files.
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
