import type { Subscription, TurnServerSink } from "@matrix-widget-sdk/host";
import type { ClientLike } from "matrix-sdk-uniffi-js";

/** Retry after this long when the homeserver gave no credentials or no lifetime for them. */
const DEFAULT_TTL_SECONDS = 60;

/**
 * Feeds a `subscribe_turn_servers` sink: the current TURN credentials now, then fresh ones
 * shortly before each set expires.
 *
 * This is the one thing the backend does not get from the SDK, which has no call for it. It
 * requests `GET /voip/turnServer` itself with the SDK session's access token, read anew for every
 * request because the SDK refreshes it.
 */
export function subscribeTurnServers(client: ClientLike, sink: TurnServerSink): Subscription {
  const url = `${client.homeserver().replace(/\/+$/, "")}/_matrix/client/v3/voip/turnServer`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelled = false;

  const poll = async () => {
    let ttlSeconds = DEFAULT_TTL_SECONDS;
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${client.session().accessToken}` } });
      if (!response.ok) throw new Error(`the homeserver answered ${response.status}`);
      const turn = (await response.json()) as { uris?: string[]; username?: string; password?: string; ttl?: number };
      if (cancelled) return;
      if (turn.uris?.length) sink.onTurnServer({ uris: turn.uris, username: turn.username ?? "", password: turn.password ?? "" });
      if (turn.ttl) ttlSeconds = turn.ttl;
    } catch (e) {
      console.warn("[RustSdkBackend] fetching TURN servers failed", e);
    }
    if (!cancelled) timer = setTimeout(poll, Math.max(30, ttlSeconds * 0.9) * 1000);
  };
  void poll();

  return {
    cancel() {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}
