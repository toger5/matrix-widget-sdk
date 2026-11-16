import { useEffect, useId, useRef, useState, type FormEvent } from "react";

import type { AccountId } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Field, Icon } from "../ui/atoms";

export interface RecoveryKeyFormProps {
  accountId: AccountId;
  /** The key was submitted and is being checked. */
  checking: boolean;
  /** The session's reason for refusing the last key. */
  error?: string;
  /** Story only: the key the field starts with. */
  initialRecoveryKey?: string;
}

/** A failure of the verification box: a fixed line, and the session's reason below it. */
export function VerifyError({ text, detail, id }: { text: string; detail?: string; id?: string }) {
  return (
    <div className="verify-err" role="alert" id={id}>
      <Icon name="alert" size={14} />
      <span>
        {text}
        {detail && <small>{detail}</small>}
      </span>
    </div>
  );
}

/**
 * Verifying with the recovery key, inside the box of `DeviceVerification`. The key is a secret: it
 * stays in this form's own state (a refused key stays in the field) and leaves it only with
 * `verification/submitRecoveryKey`; the field is not autocompleted or spell checked.
 * stories `sidepanel-recoverykeyform--*`
 */
export function RecoveryKeyForm({ accountId, checking, error, initialRecoveryKey = "" }: RecoveryKeyFormProps) {
  const dispatch = useDispatch();
  const [recoveryKey, setRecoveryKey] = useState(initialRecoveryKey);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const refused = !checking && error !== undefined;
  // The field gets the focus when the form appears (the button that opened it is gone) and after a refusal.
  useEffect(() => {
    if (!checking) input.current?.focus();
  }, [checking]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (checking || !recoveryKey.trim()) return;
    dispatch({ type: "verification/submitRecoveryKey", accountId, recoveryKey });
  };

  return (
    <form className="verify-form" onSubmit={submit}>
      <p className="hint">The key you saved when encryption was set up for this account: 12 groups of four characters.</p>
      <Field label="Recovery key">
        <input
          ref={input}
          className={`input mono ${checking ? "disabled" : refused ? "invalid" : ""}`}
          aria-invalid={refused || undefined}
          aria-describedby={refused ? errorId : undefined}
          value={recoveryKey}
          onChange={(e) => setRecoveryKey(e.target.value)}
          disabled={checking}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
        />
      </Field>
      {refused && <VerifyError id={errorId} text="This recovery key was not accepted." detail={error} />}
      {checking ? (
        <button type="submit" className="btn primary block" disabled>
          <span className="spinner" aria-hidden="true" />
          <span>Checking…</span>
        </button>
      ) : (
        <Button type="submit" kind="primary" block disabled={!recoveryKey.trim()}>
          Verify
        </Button>
      )}
    </form>
  );
}
