import type { AccountId, VerificationViewModel } from "../../appViewModel";
import { useDispatch } from "../env";
import { Button } from "../ui/atoms";

export interface EmojiVerificationProps {
  accountId: AccountId;
  /** The account's user id: the other device has to be logged in as it. */
  userId: string;
  verification: Extract<VerificationViewModel, { step: "waiting" | "emoji" }>;
}

/** A spinner and what is being waited for, announced to screen readers. */
function VerifyStatus({ text }: { text: string }) {
  return (
    <div className="verify-status" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{text}</span>
    </div>
  );
}

/**
 * Verifying with another device, inside the box of `DeviceVerification`: waiting for a device to
 * accept the request, comparing the emoji, waiting for the other device to confirm.
 * stories `sidepanel-emojiverification--*`
 */
export function EmojiVerification({ accountId, userId, verification }: EmojiVerificationProps) {
  const dispatch = useDispatch();
  if (verification.step === "waiting") {
    return (
      <>
        <VerifyStatus text="Waiting for another device…" />
        <p className="hint">Accept the request in another app where you are logged in as {userId}, and choose to compare emoji.</p>
      </>
    );
  }
  const { emoji, confirming } = verification;
  return (
    <>
      <p className="hint">Does the other device show the same emoji, in the same order?</p>
      <ol className={`verify-emoji ${confirming ? "dim" : ""}`} aria-label="Emoji to compare">
        {emoji.map(({ symbol, name }, i) => (
          <li key={i}>
            <span aria-hidden="true">{symbol}</span>
            {name}
          </li>
        ))}
      </ol>
      {confirming ? (
        <VerifyStatus text="Waiting for the other device to confirm…" />
      ) : (
        <div className="verify-actions">
          <Button onClick={() => dispatch({ type: "verification/answerEmoji", accountId, match: false })}>They don't match</Button>
          <Button kind="primary" onClick={() => dispatch({ type: "verification/answerEmoji", accountId, match: true })}>
            They match
          </Button>
        </div>
      )}
    </>
  );
}
