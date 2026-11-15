import { useEffect, useState } from "react";

import { Login } from "./views/Login";
import { MemoryView, startsInMemory } from "./memory/MemoryView";
import { LoggedInView } from "./views/LoggedInView";
import { sessions, StoredLoginInvalidError, type LiveSession } from "./session";

type State =
  | { step: "restoring" }
  /** A login is stored but could not be started. It may well be alive, so the login screen is not offered. */
  | { step: "restoreFailed"; error: string; busy?: boolean }
  | { step: "login"; error?: string }
  | { step: "live"; session: LiveSession }
  | { step: "memory" };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * The widget host. Two modes with the same views: logged in (a real Matrix client) or the
 * in-memory store, chosen on the login screen or by the URL parameters the tests use.
 *
 * The login screen is only reached through `restoring`, and only when no login is stored or the
 * homeserver has ended the stored one: logging in again while a login is still alive would leave
 * that one behind as an orphaned device.
 */
export function App() {
  const [state, setState] = useState<State>(() => (startsInMemory() ? { step: "memory" } : { step: "restoring" }));

  const restoring = state.step === "restoring";
  useEffect(() => {
    if (!restoring) return;
    let cancelled = false;
    sessions
      .restore()
      .then((session) => !cancelled && setState(session ? { step: "live", session } : { step: "login" }))
      .catch(async (e: unknown) => {
        console.error("restoring the session failed", e);
        if (!(e instanceof StoredLoginInvalidError)) {
          if (!cancelled) setState({ step: "restoreFailed", error: message(e) });
          return;
        }
        await sessions.clearStored().catch(() => undefined);
        if (!cancelled) setState({ step: "login", error: e.message });
      });
    return () => {
      cancelled = true;
    };
  }, [restoring]);

  const logOutStored = () => {
    setState((s) => (s.step === "restoreFailed" ? { ...s, busy: true } : s));
    sessions.clearStored().then(
      () => setState({ step: "restoring" }),
      (e: unknown) => setState({ step: "restoreFailed", error: `Logging out failed: ${message(e)}` }),
    );
  };

  switch (state.step) {
    case "restoring":
      return <div className="centered muted">Loading…</div>;
    case "restoreFailed":
      return (
        <div className="centered">
          <div className="login">
            <p>You are still logged in, but the session could not be started:</p>
            <p className="error">{state.error}</p>
            <button disabled={state.busy} onClick={() => setState({ step: "restoring" })}>
              Try again
            </button>
            <button disabled={state.busy} onClick={logOutStored}>
              {state.busy ? "Logging out…" : "Log out"}
            </button>
            <button disabled={state.busy} onClick={() => setState({ step: "memory" })}>
              Use the in-memory store (no login)
            </button>
          </div>
        </div>
      );
    case "login":
      return <Login error={state.error} onLoggedIn={(session) => setState({ step: "live", session })} onUseMemory={() => setState({ step: "memory" })} />;
    case "live":
      return <LoggedInView session={state.session} onLeft={() => setState({ step: "restoring" })} />;
    case "memory":
      // Leaving the in-memory store looks for a stored login again, like a fresh start would.
      return <MemoryView onLeft={() => setState({ step: "restoring" })} />;
  }
}
