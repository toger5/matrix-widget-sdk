/**
 * The verification of this device for one Matrix account: whether it is verified, following the
 * session, and the verification the user runs from the AccountView (emoji with another device, or
 * the recovery key). The controller creates one per adopted session and turns its reports into
 * `AccountViewModel.verified` / `.verification`. It talks to the session only through the
 * `LiveSession` interface, so the tests drive it with a fake (`test/deviceVerification.test.ts`).
 *
 * The recovery key passes through `submitRecoveryKey` to the session and is kept nowhere.
 */
import type { VerificationViewModel } from "../../appViewModel";
import type { EmojiVerification, LiveSession } from "../../session";

/** What `AccountVerification` needs of a session. */
export type VerificationSession = Pick<LiveSession, "needsVerification" | "onVerificationChanged" | "verifyWithRecoveryKey" | "startEmojiVerification">;

/** The account's slice of the view model this owns. */
export interface VerificationReport {
  /** `undefined` until the session has answered once. */
  verified?: boolean;
  verification?: VerificationViewModel;
}

/** How a verification the user waited for came out: this device is verified, or why not. */
export type VerificationOutcome = { verified: true } | { verified: false; error: string };

export interface AccountVerificationEvents {
  /** `verified` or `verification` changed. */
  changed(report: VerificationReport): void;
  /** A verification ended by itself (succeeded, the device was verified elsewhere meanwhile, failed, a recovery key was refused), not by `cancel()`. */
  outcome(outcome: VerificationOutcome): void;
}

export const EMOJI_MISMATCH = "The emoji did not match, so this device was not verified.";

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class AccountVerification {
  private report: VerificationReport = {};
  /** Bumped by every read of `needsVerification` and by every success: only the latest read counts. */
  private reads = 0;
  /** Bumped whenever a verification starts or ends: the results of an older one are ignored. */
  private flow = 0;
  /** The running emoji verification, once the session has sent the request. */
  private emoji: EmojiVerification | undefined;
  private disposed = false;
  private readonly unsubscribe: () => void;

  constructor(
    private readonly session: VerificationSession,
    private readonly events: AccountVerificationEvents,
  ) {
    this.unsubscribe = session.onVerificationChanged(() => this.refresh());
    this.refresh();
  }

  /** Read again whether this device is verified: the session changed it, or it was resumed. */
  refresh(): void {
    if (this.disposed) return;
    const read = ++this.reads;
    this.session.needsVerification().then(
      (needs) => {
        if (this.disposed || read !== this.reads) return;
        // Verified elsewhere (or by the running step before it answered): that step ends as a success.
        if (!needs && this.running()) return this.verifiedNow();
        const step = this.report.verification?.step;
        // Verified elsewhere: the reason of an earlier failure no longer matters.
        this.set({ verified: !needs, verification: !needs && step === "failed" ? undefined : this.report.verification });
      },
      // An unknown answer (the session is suspended, say) leaves the last one standing.
      (e: unknown) => this.disposed || console.warn("reading whether this device is verified failed", e),
    );
  }

  /** "Verify with another device": the request goes to the account's other devices. */
  startEmoji(): void {
    if (this.disposed || this.running()) return;
    const flow = ++this.flow;
    this.set({ verification: { step: "waiting" } });
    this.session.startEmojiVerification().then(
      (verification) => {
        if (flow !== this.flow) return verification.cancel();
        this.emoji = verification;
        verification.ended.catch((e: unknown) => this.fail(flow, e));
        verification.emoji.then(
          (emoji) => flow === this.flow && this.set({ verification: { step: "emoji", emoji, confirming: false } }),
          (e: unknown) => this.fail(flow, e),
        );
      },
      (e: unknown) => this.fail(flow, e),
    );
  }

  /** "They match" (wait for the other device to confirm) or "They don't match" (ends it). */
  answerEmoji(match: boolean): void {
    const shown = this.report.verification;
    const verification = this.emoji;
    if (shown?.step !== "emoji" || shown.confirming || !verification) return;
    const flow = this.flow;
    if (!match) {
      this.emoji = undefined;
      verification.cancel(true);
      return this.fail(flow, new Error(EMOJI_MISMATCH));
    }
    this.set({ verification: { ...shown, confirming: true } });
    verification.confirm().then(
      () => this.succeed(flow),
      (e: unknown) => this.fail(flow, e),
    );
  }

  /** "Use recovery key": the form. */
  startRecoveryKey(): void {
    if (this.disposed || this.running()) return;
    this.flow++;
    this.set({ verification: { step: "recoveryKey", checking: false } });
  }

  /** Check the key. A refused key keeps the form, with the reason. */
  submitRecoveryKey(recoveryKey: string): void {
    const shown = this.report.verification;
    if (shown?.step !== "recoveryKey" || shown.checking) return;
    const flow = this.flow;
    this.set({ verification: { step: "recoveryKey", checking: true } });
    this.session.verifyWithRecoveryKey(recoveryKey).then(
      () => this.succeed(flow),
      (e: unknown) => {
        if (flow !== this.flow) return;
        const error = errorText(e);
        this.set({ verification: { step: "recoveryKey", checking: false, error } });
        this.events.outcome({ verified: false, error: `The recovery key was not accepted. ${error}` });
      },
    );
  }

  /** × of a running step: back to the "Verify this device" box. "Done" and a failure's box: closed. */
  cancel(): void {
    this.endFlow();
    this.set({ verification: undefined });
  }

  /** End a running verification for a reason the user did not choose (the DevBackend was activated). */
  stop(reason: string): void {
    if (!this.running()) return;
    this.fail(this.flow, new Error(reason));
  }

  /** The account is gone: cancel what runs, stop listening, report nothing more. */
  dispose(): void {
    if (this.disposed) return;
    this.endFlow();
    this.disposed = true;
    this.unsubscribe();
  }

  private running(): boolean {
    const step = this.report.verification?.step;
    return step === "waiting" || step === "emoji" || step === "recoveryKey";
  }

  /** Forget the running verification, cancelling it in the session. */
  private endFlow(): void {
    this.flow++;
    this.emoji?.cancel();
    this.emoji = undefined;
  }

  private succeed(flow: number): void {
    if (this.disposed) return;
    // Cancelled, but it went through anyway (the check of a recovery key, say): only read again.
    if (flow !== this.flow) return this.refresh();
    // A read that started before the success may still answer "not verified".
    this.reads++;
    this.verifiedNow();
    this.refresh();
  }

  /** This device is verified: end what runs (the SDK's flow is cancelled, if it is not over) and say so until "Done". */
  private verifiedNow(): void {
    this.endFlow();
    this.set({ verified: true, verification: { step: "done" } });
    this.events.outcome({ verified: true });
  }

  private fail(flow: number, e: unknown): void {
    if (flow !== this.flow || this.disposed) return;
    this.endFlow();
    const error = errorText(e);
    this.set({ verification: { step: "failed", error } });
    this.events.outcome({ verified: false, error });
  }

  private set(change: VerificationReport): void {
    if (this.disposed) return;
    this.report = { ...this.report, ...change };
    this.events.changed(this.report);
  }
}
