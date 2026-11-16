/**
 * Device verification of a logged-in account: by comparing emoji with another device, or with the
 * recovery key. A self-contained view on the account's session (`ViewEnv.renderVerification`):
 * its steps are not part of the view model.
 *
 * TODO-FINDING verification-not-designed - device verification has no mockup (designFeedback.md, "Gaps in appDesign.md"). This is the flow of the old app, shown inside the AccountView with the old markup; it cannot be reached in DevBackend mode and is not covered by a story or a test.
 */
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { EmojiVerification, LiveSession, VerificationEmoji } from "../session";

type EmojiStep = { step: "idle" } | { step: "waiting" } | { step: "compare"; emoji: VerificationEmoji[] } | { step: "confirming"; emoji: VerificationEmoji[] };

const errorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Shown while this device is unverified; other devices only share keys with verified ones. Two
 * ways out: comparing emoji with another device of the account, or the recovery key.
 */
export function Verification({ session }: { session: LiveSession }) {
  const [needed, setNeeded] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [emoji, setEmoji] = useState<EmojiStep>({ step: "idle" });
  /** The running emoji verification; unset as soon as it has ended, whichever way. */
  const running = useRef<EmojiVerification | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    session
      .needsVerification()
      .then((value) => !cancelled && setNeeded(value))
      .catch((e: unknown) => console.warn("checking the device verification failed", e));
    return () => {
      cancelled = true;
      running.current?.cancel();
      running.current = undefined;
    };
  }, [session]);

  if (!needed) return null;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    session
      .verifyWithRecoveryKey(key)
      .then(() => setNeeded(false))
      .catch((err: unknown) => setError(errorMessage(err)))
      .finally(() => setBusy(false));
  };

  /** Run `work` for `verification`; its outcome only counts while that verification is still the running one. */
  const during = (verification: EmojiVerification, work: () => Promise<void>) => {
    work().catch((e: unknown) => {
      if (running.current !== verification) return;
      running.current = undefined;
      verification.cancel();
      setEmoji({ step: "idle" });
      setError(errorMessage(e));
    });
  };

  const startEmoji = () => {
    setError(undefined);
    setEmoji({ step: "waiting" });
    session.startEmojiVerification().then(
      (verification) => {
        running.current = verification;
        during(verification, async () => {
          const shown = await verification.emoji;
          if (running.current === verification) setEmoji({ step: "compare", emoji: shown });
        });
      },
      (e: unknown) => {
        setEmoji({ step: "idle" });
        setError(errorMessage(e));
      },
    );
  };

  const confirmEmoji = (shown: VerificationEmoji[]) => {
    const verification = running.current;
    if (!verification) return;
    setEmoji({ step: "confirming", emoji: shown });
    during(verification, async () => {
      await verification.confirm();
      if (running.current !== verification) return;
      running.current = undefined;
      setNeeded(false);
    });
  };

  const stopEmoji = (mismatch: boolean) => {
    running.current?.cancel(mismatch);
    running.current = undefined;
    setEmoji({ step: "idle" });
    setError(mismatch ? "The emoji did not match, so this device was not verified." : undefined);
  };

  if (emoji.step !== "idle") {
    return (
      <div className="verification">
        {emoji.step === "waiting" ? (
          <div>Accept the verification request on another device you are logged in on, and choose to compare emoji there.</div>
        ) : (
          <>
            <div>Do both devices show these emoji, in this order?</div>
            <ol className="emoji">
              {emoji.emoji.map(({ symbol, name }, i) => (
                <li key={i}>
                  <span>{symbol}</span>
                  {name}
                </li>
              ))}
            </ol>
            <button disabled={emoji.step === "confirming"} onClick={() => confirmEmoji(emoji.emoji)}>
              {emoji.step === "confirming" ? "Waiting for the other device…" : "They match"}
            </button>
            <button disabled={emoji.step === "confirming"} onClick={() => stopEmoji(true)}>
              They don't match
            </button>
          </>
        )}
        <button onClick={() => stopEmoji(false)}>Cancel</button>
      </div>
    );
  }

  return (
    <form className="verification" onSubmit={submit}>
      <div>This device is not verified, so encrypted rooms may not decrypt.</div>
      <button type="button" disabled={busy} onClick={startEmoji}>
        Verify with another device (emoji)
      </button>
      <div>Or enter your recovery key:</div>
      <input value={key} onChange={(e) => setKey(e.target.value)} placeholder="EsTc …" autoComplete="off" required />
      <button disabled={busy}>{busy ? "Verifying…" : "Verify"}</button>
      {error && <div className="error">{error}</div>}
    </form>
  );
}
