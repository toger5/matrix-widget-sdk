/**
 * `LiveSession.suspend()` for matrix-js-sdk: a `fetch` the client is created with (`fetchFn`),
 * which refuses every request while the session is suspended.
 *
 * The client itself keeps running. `MatrixClient.stopClient()` would stop the sync too, but it
 * also shuts the crypto module down for good, so the same client (which the room backends hold)
 * could not be started again. With the requests refused the sync loop behaves as if the network
 * were gone: it waits and probes, and every probe ends here without reaching the network.
 */
// TODO-FINDING suspend-in-flight-requests - what happens to requests on suspend? Options: (a) refuse new ones and abort all in flight, (b) refuse new ones, abort only the /sync long poll and let short requests (a send that may already have reached the server) finish, (c) hold requests until resume. Done: (b); a request made while suspended rejects right away (the SDK reports a connection error), it is not queued for resume.

/** What a request made while suspended rejects with. Deliberately not an `AbortError`: the SDK then treats it as a lost connection and retries later. */
export class SuspendedError extends Error {
  constructor() {
    super("The session is suspended: no requests are made to the homeserver.");
    this.name = "SuspendedError";
  }
}

const isSync = (input: RequestInfo | URL): boolean => {
  try {
    return new URL(typeof input === "string" || input instanceof URL ? input : input.url).pathname.endsWith("/sync");
  } catch {
    return false;
  }
};

export class FetchGate {
  private closed = false;
  /** The long polls in flight: `suspend()` ends them. */
  private readonly polls = new Set<AbortController>();

  /** `inner` is looked up on every request, so a test can replace the global `fetch`. */
  constructor(private readonly inner: typeof globalThis.fetch = (input, init) => globalThis.fetch(input, init)) {}

  get suspended(): boolean {
    return this.closed;
  }

  /** The gated `fetch`, for `createClient({ fetchFn })` and for the session's own requests. */
  readonly fetch: typeof globalThis.fetch = async (input, init) => {
    if (this.closed) throw new SuspendedError();
    if (!isSync(input)) return this.inner(input, init);

    const controller = new AbortController();
    const outer = init?.signal ?? undefined;
    const forward = () => controller.abort(outer?.reason);
    if (outer?.aborted) forward();
    else outer?.addEventListener("abort", forward, { once: true });
    this.polls.add(controller);
    try {
      return await this.inner(input, { ...init, signal: controller.signal });
    } catch (e) {
      // Ended by `suspend()`, not by the SDK.
      if (this.closed && !outer?.aborted) throw new SuspendedError();
      throw e;
    } finally {
      this.polls.delete(controller);
      outer?.removeEventListener("abort", forward);
    }
  };

  suspend(): void {
    this.closed = true;
    for (const controller of this.polls) controller.abort();
  }

  resume(): void {
    this.closed = false;
  }
}
