import { useId, type ReactNode } from "react";

import type { AccountId, VerificationViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button, Icon, IconButton, type IconName } from "../ui/atoms";
import { EmojiVerification } from "./EmojiVerification";
import { RecoveryKeyForm, VerifyError } from "./RecoveryKeyForm";

export interface DeviceVerificationProps {
  accountId: AccountId;
  /** The account's user id: the other device has to be logged in as it. */
  userId: string;
  /** Not set: the "Verify this device" box. */
  verification?: VerificationViewModel;
  /** Story only: the recovery key the form starts with. */
  initialRecoveryKey?: string;
}

/** Whether `verification` is a step that replaces the device details and the menu of the AccountView. */
export const verificationRunning = (verification: VerificationViewModel | undefined): boolean =>
  verification?.step === "waiting" || verification?.step === "emoji" || verification?.step === "recoveryKey";

/**
 * The "Verify this device" box of the AccountView, under the account card: the two ways to verify
 * (another device, the recovery key), the running step, a failure, the success.
 * stories `sidepanel-deviceverification--*`; the running steps are `EmojiVerification`
 * and `RecoveryKeyForm`.
 */
export function DeviceVerification({ accountId, userId, verification, initialRecoveryKey }: DeviceVerificationProps) {
  const dispatch = useDispatch();
  const headingId = useId();
  const running = verificationRunning(verification);
  const box = (icon: IconName, title: string, body: ReactNode, ok = false) => (
    <section className={`verify ${ok ? "ok" : ""}`} aria-labelledby={headingId}>
      <div className="verify-h">
        <Icon name={icon} size={16} />
        <h3 id={headingId}>{title}</h3>
        {running && <IconButton icon="x" title="Cancel verification" onClick={() => dispatch({ type: "verification/cancel", accountId })} />}
      </div>
      {body}
    </section>
  );

  switch (verification?.step) {
    case "waiting":
      return box("monitor", "Verify with another device", <EmojiVerification accountId={accountId} userId={userId} verification={verification} />);
    case "emoji":
      return box("monitor", "Compare emoji", <EmojiVerification accountId={accountId} userId={userId} verification={verification} />);
    case "recoveryKey":
      return box("key", "Use recovery key", <RecoveryKeyForm accountId={accountId} checking={verification.checking} error={verification.error} initialRecoveryKey={initialRecoveryKey} />);
    case "done":
      return box(
        "shield",
        "This device is verified",
        <>
          <p className="hint">Your other devices share the keys of encrypted rooms with it now. Older messages may take a moment to decrypt.</p>
          <Button block onClick={() => dispatch({ type: "verification/cancel", accountId })}>
            Done
          </Button>
        </>,
        true,
      );
    default:
      // Not verified, or the last verification failed (its reason takes the place of the explanation).
      return box(
        "alert",
        "Verify this device",
        <>
          {verification?.step === "failed" ? (
            <VerifyError text={verification.error} />
          ) : (
            <p className="hint">Your other devices share the keys of encrypted rooms only with verified devices. Until then, widgets cannot read encrypted messages.</p>
          )}
          {/* TODO-FINDING verification-methods-always-offered - both ways are offered whether or not they can work (no other device, no recovery key set up); the session's error says so afterwards. */}
          <Button kind="primary" icon="monitor" block onClick={() => dispatch({ type: "verification/startEmoji", accountId })}>
            Verify with another device
          </Button>
          <Button icon="key" block onClick={() => dispatch({ type: "verification/startRecoveryKey", accountId })}>
            Use recovery key
          </Button>
        </>,
      );
  }
}
