import { useEffect, useRef, useState, type FormEvent } from "react";

import { sessions, type LiveSession, type PendingLogin } from "../session";

interface Props {
  error?: string;
  onLoggedIn: (session: LiveSession) => void;
  /** The user chose the in-memory store instead of logging in. */
  onUseMemory: () => void;
}

/** Server first, then OAuth (in a popup) or a password, whichever the homeserver offers. */
export function Login({ error: initialError, onLoggedIn, onUseMemory }: Props) {
  const [server, setServer] = useState("matrix.org");
  const [pending, setPending] = useState<PendingLogin | undefined>();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(initialError);
  const stopOAuth = useRef<(() => void) | undefined>(undefined);

  useEffect(() => () => stopOAuth.current?.(), []);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(undefined);
    try {
      await work();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const chooseServer = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => setPending(await sessions.startLogin(server.trim())));
  };

  const withPassword = (e: FormEvent) => {
    e.preventDefault();
    if (pending) void run(async () => onLoggedIn(await pending.withPassword(username, password)));
  };

  const withOAuth = () => {
    if (!pending) return;
    void run(async () => {
      // Opened before the first `await`, while the click still counts as a user gesture; browsers
      // block popups opened later.
      const popup = window.open("about:blank", "widget-host-login", "width=600,height=700");
      if (!popup) throw new Error("The login popup was blocked. Allow popups for this page and try again.");
      try {
        popup.location.href = await pending.oauthUrl();
      } catch (e) {
        popup.close();
        throw e;
      }
      const callbackUrl = await new Promise<string | undefined>((resolve) => {
        const onMessage = (ev: MessageEvent) => {
          if (ev.origin === location.origin && ev.data?.type === "oidc-callback") done(ev.data.callbackUrl as string);
        };
        const closedCheck = window.setInterval(() => popup.closed && done(undefined), 500);
        const done = (url: string | undefined) => {
          window.removeEventListener("message", onMessage);
          clearInterval(closedCheck);
          stopOAuth.current = undefined;
          resolve(url);
        };
        stopOAuth.current = () => done(undefined);
        window.addEventListener("message", onMessage);
      });
      if (callbackUrl === undefined) return pending.abortOAuth();
      onLoggedIn(await pending.completeOAuth(callbackUrl));
    });
  };

  const back = () => {
    void pending?.discard();
    setPending(undefined);
    setError(undefined);
  };

  return (
    <div className="centered">
      <div className="login">
        <h1>Widget host</h1>
        {!pending ? (
          <form onSubmit={chooseServer}>
            <label>
              Homeserver
              <input value={server} onChange={(e) => setServer(e.target.value)} placeholder="matrix.org" required />
            </label>
            <button disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
          </form>
        ) : (
          <>
            <p className="muted">
              {server} <button onClick={back}>Change</button>
            </p>
            {pending.options.oauth && (
              <button onClick={withOAuth} disabled={busy}>
                {busy ? "Waiting for the login window…" : "Log in with your account provider"}
              </button>
            )}
            {pending.options.password && (
              <form onSubmit={withPassword}>
                <label>
                  Username
                  <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
                </label>
                <label>
                  Password
                  <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
                </label>
                <button disabled={busy}>Log in</button>
              </form>
            )}
            {!pending.options.oauth && !pending.options.password && <p className="error">This homeserver offers no login method this app supports.</p>}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <hr />
        <button onClick={onUseMemory}>Use the in-memory store (no login)</button>
        <p className="muted">Runs widgets against an in-memory room in this page. Nothing is sent to a homeserver.</p>
      </div>
    </div>
  );
}
