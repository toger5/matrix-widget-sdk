import { useEffect, useState } from "react";

import { Login } from "./Login";
import { MemoryPlayer, startsInMemory } from "./MemoryPlayer";
import { Player } from "./Player";
import { sessions, type LiveSession } from "./session";

type State = { step: "restoring" } | { step: "login"; error?: string } | { step: "live"; session: LiveSession } | { step: "memory" };

/**
 * The widget host. Two modes with the same views: logged in (a real Matrix client) or the
 * in-memory store, chosen on the login screen or by the URL parameters the tests use.
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
        await sessions.clearStored().catch(() => undefined);
        if (!cancelled) setState({ step: "login", error: `The stored login could not be restored: ${e instanceof Error ? e.message : String(e)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [restoring]);

  switch (state.step) {
    case "restoring":
      return <div className="centered muted">Loading…</div>;
    case "login":
      return <Login error={state.error} onLoggedIn={(session) => setState({ step: "live", session })} onUseMemory={() => setState({ step: "memory" })} />;
    case "live":
      return <Player session={state.session} onLeft={() => setState({ step: "login" })} />;
    case "memory":
      // Leaving the in-memory store looks for a stored login again, like a fresh start would.
      return <MemoryPlayer onLeft={() => setState({ step: "restoring" })} />;
  }
}
