import { BackendError } from "@matrix-widget-sdk/host";
import { MatrixError } from "matrix-js-sdk";

/** A failure of this backend itself, as the driver's error type. */
export function fail(reason: string): Error {
  return new BackendError.Failed({ errcode: undefined, status: undefined, reason });
}

/**
 * Anything the SDK throws, as a `BackendError`. The driver forwards `errcode` and `status` of a
 * homeserver error to the widget as `matrix_api_error`.
 */
export function toBackendError(e: unknown): Error {
  if (BackendError.instanceOf(e)) return e as Error;
  if (e instanceof MatrixError) {
    return new BackendError.Failed({ errcode: e.errcode, status: e.httpStatus, reason: e.data?.error ?? e.message });
  }
  return fail(e instanceof Error ? e.message : String(e));
}

/** Await an SDK call, turning its rejection into a `BackendError`. */
export async function wrap<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    throw toBackendError(e);
  }
}

/** Whether the homeserver said it does not know the endpoint. */
export function isUnsupported(e: unknown): boolean {
  return e instanceof MatrixError && (e.errcode === "M_UNRECOGNIZED" || e.httpStatus === 404);
}
