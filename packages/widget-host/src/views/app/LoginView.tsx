import { useId, useState, type FormEvent } from "react";

import type { LoginViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Field, Icon, Logo } from "../ui/atoms";

export interface LoginViewProps {
  login: LoginViewModel;
  /** Shown while a second account is added (`MainViewModel.addAccount`): offers "Cancel" instead of "Skip login". */
  adding?: boolean;
}

/** leaf app/login. Intents: login/continue, login/withPassword, login/skip, login/cancel. */
export function LoginView({ login, adding = false }: LoginViewProps) {
  const dispatch = useDispatch();
  // Form drafts are view state.
  const [homeserver, setHomeserver] = useState(login.homeserver);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const errorId = useId();

  // The password form belongs to the homeserver that was looked up: editing the field goes back to "Continue".
  // TODO-FINDING login-password-step - the mockup only draws the homeserver step ("No password is entered here"). The password step (fields below the homeserver, "Sign in") is not designed, and it is undecided what is shown when a homeserver offers both OAuth and a password: for now the password form is shown whenever `options.password` is set, and "Continue" stays the way to (re)start OAuth.
  const [edited, setEdited] = useState(false);
  const passwordStep = !!login.options?.password && !edited;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (login.busy) return;
    if (passwordStep) {
      if (username.trim() && password) dispatch({ type: "login/withPassword", username: username.trim(), password });
    } else if (homeserver.trim()) {
      setEdited(false);
      dispatch({ type: "login/continue", homeserver: homeserver.trim() });
    }
  };

  return (
    <div className="app login-page" data-testid="login">
      <form className="login-card" onSubmit={submit} aria-busy={login.busy} aria-describedby={login.error ? errorId : undefined}>
        <Logo size={40} />
        <h1>Widget Host</h1>
        <p className="muted">{adding ? "Sign in to add another account." : "Sign in to open the widgets of your rooms."}</p>
        <Field label="Homeserver">
          <input className="input" name="homeserver" value={homeserver} onChange={(e) => (setHomeserver(e.target.value), setEdited(true))} placeholder="example.org" autoCapitalize="none" autoCorrect="off" spellCheck={false} disabled={login.busy} autoFocus />
        </Field>
        {passwordStep && (
          <>
            <Field label="Username">
              <input className="input" name="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" spellCheck={false} disabled={login.busy} />
            </Field>
            <Field label="Password">
              <input className="input" name="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" disabled={login.busy} />
            </Field>
          </>
        )}
        <Button type="submit" kind="primary" block end={login.busy ? undefined : "arrowRight"} disabled={login.busy || (passwordStep ? !username.trim() || !password : !homeserver.trim())}>
          {login.busy ? "Please wait…" : passwordStep ? "Sign in" : "Continue"}
        </Button>
        {login.error && (
          <p className="login-error" id={errorId} role="alert">
            <Icon name="alert" size={14} />
            <span>{login.error}</span>
          </p>
        )}
        {!passwordStep && <p className="hint center">You sign in on your homeserver's own page. No password is entered here.</p>}
        {adding ? (
          <Button block onClick={() => dispatch({ type: "login/cancel" })}>
            Cancel
          </Button>
        ) : (
          <>
            <div className="or">
              <span>or</span>
            </div>
            <button type="button" className="skip" onClick={() => dispatch({ type: "login/skip" })} disabled={login.busy}>
              <Icon name="cone" size={18} />
              <span>
                <b>Skip login and use the DevBackend</b>
                <small>In-memory rooms, no account needed. Enables the dev tools and the DevBackend.</small>
              </span>
              <Icon name="arrowRight" size={16} className="end" />
            </button>
          </>
        )}
      </form>
    </div>
  );
}
