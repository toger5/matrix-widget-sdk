import { ClientError, RecoveryError, SessionVerificationData, VerificationState, type ClientLike } from "matrix-sdk-uniffi-js";

import type { EmojiVerification, VerificationEmoji } from "../../session";
import { verificationCancelReason } from "../verificationCancel";

/**
 * Device verification on a matrix-rust-sdk client: whether this device is verified, a listener for
 * changes of that, the recovery key, and the emoji (SAS) flow with another device of the account.
 * Free functions of the client, apart from the session, so they can be tested with a faked one.
 */

export interface EmojiVerificationOptions {
  /** How long the signature of the verifying device may take to arrive after both sides confirmed. */
  verifiedTimeoutMs?: number;
  /** How often `needsVerification` is asked meanwhile. */
  pollMs?: number;
}

/** How long the signature of the verifying device may take to arrive after an emoji verification. */
const VERIFIED_TIMEOUT_MS = 20_000;
const POLL_MS = 500;

/**
 * An SDK error with its text, for the AccountView. A uniffi error's `message` is only its type and
 * variant ("RecoveryError.SecretStorage"); the text is in `inner`.
 */
function sdkError(e: unknown): Error {
  if (!(e instanceof Error)) return new Error(String(e));
  if (RecoveryError.instanceOf(e)) {
    if (RecoveryError.SecretStorage.instanceOf(e) || RecoveryError.Import.instanceOf(e)) return new Error(e.inner.errorMessage);
    if (RecoveryError.Client.instanceOf(e)) return sdkError(e.inner.source);
  }
  if (ClientError.instanceOf(e) && (ClientError.Generic.instanceOf(e) || ClientError.MatrixApi.instanceOf(e))) return new Error(e.inner.msg);
  return e;
}

/** Run an SDK call; its error carries the SDK's text. */
async function sdk<T>(call: Promise<T>): Promise<T> {
  try {
    return await call;
  } catch (e) {
    throw sdkError(e);
  }
}

/** True when the account has cross-signing but this device is not signed by it. */
export async function needsVerification(client: ClientLike): Promise<boolean> {
  const encryption = client.encryption();
  // Until the SDK has looked at the account's cross-signing keys the state is unknown.
  await encryption.waitForE2eeInitializationTasks();
  return encryption.verificationState() === VerificationState.Unverified;
}

/**
 * Call `listener` whenever the SDK's verification state of this device changes. The SDK's task
 * runs as long as its handle lives (dropping the handle aborts it), so the returned function keeps
 * the handle and cancels it.
 */
export function onVerificationChanged(client: ClientLike, listener: () => void): () => void {
  const handle = client.encryption().verificationStateListener({ onUpdate: () => listener() });
  return () => handle.cancel();
}

/**
 * The recovery key opens the account's secret storage: the SDK fetches the cross-signing keys
 * from it (which signs this device) and the key of the room key backup.
 */
export async function verifyWithRecoveryKey(client: ClientLike, recoveryKey: string): Promise<void> {
  await sdk(client.encryption().recover(recoveryKey.trim()));
  if (await needsVerification(client)) throw new Error("The recovery key was accepted, but this device is still not verified.");
}

/**
 * Emoji (SAS) verification, started from here: every other device of the account gets the
 * request, the one that accepts it compares emoji with this one and then signs this device.
 */
export async function startEmojiVerification(client: ClientLike, options: EmojiVerificationOptions = {}): Promise<EmojiVerification> {
  const { verifiedTimeoutMs = VERIFIED_TIMEOUT_MS, pollMs = POLL_MS } = options;
  const controller = await sdk(client.getSessionVerificationController());
  let showEmoji!: (emoji: VerificationEmoji[]) => void;
  let finish!: () => void;
  let reject!: (reason: Error) => void;
  const emoji = new Promise<VerificationEmoji[]>((resolve) => (showEmoji = resolve));
  const finished = new Promise<void>((resolve) => (finish = resolve));
  // Rejects when the verification ends without success; the promises below race against it.
  const ended = new Promise<never>((_, rejectEnded) => (reject = rejectEnded));
  ended.catch(() => undefined);
  /** Set as soon as the verification has ended, whichever way: there is nothing left to cancel. */
  let over = false;
  /** Set by `cancel()`: `confirm()` stops waiting for the signature. */
  let abandoned = false;
  /** The SAS has started: a cancel from now on has its reason in `sasCancelInfo()`. */
  let sasStarted = false;
  const stop = (mismatch: boolean) => {
    if (over) return;
    over = true;
    (mismatch ? controller.declineVerification() : controller.cancelVerification()).catch((e: unknown) => console.warn("cancelling the verification failed", e));
  };
  /** The SDK ended it. */
  const end = (reason: Error) => {
    over = true;
    reject(reason);
  };
  /** It cannot go on on this side: the other device is told. */
  const abort = (reason: unknown) => {
    stop(false);
    reject(sdkError(reason));
  };
  // The controller is one per client and keeps the cancel infos of earlier verifications. The SDK
  // writes the one of this cancel just before `didCancel`: the SAS's once it has started (the
  // request's may then still be an old one), else the request's.
  const cancelCode = () => (sasStarted ? (controller.sasCancelInfo() ?? controller.requestCancelInfo()) : controller.requestCancelInfo())?.cancelCode;

  controller.setDelegate({
    // TODO-FINDING verification-incoming-requests - a verification request that another device of the account sends to this one is ignored (here; the js implementation does not listen to `CryptoEvent.VerificationRequestReceived`). Only this device can start a verification, from the AccountView.
    didReceiveVerificationRequest: () => {},
    didAcceptVerificationRequest: () => void controller.startSasVerification().catch(abort),
    didStartSasVerification: () => {
      sasStarted = true;
    },
    didReceiveVerificationData: (data) => {
      sasStarted = true;
      if (!SessionVerificationData.Emojis.instanceOf(data)) return abort(new Error("The other device offers no emoji to compare."));
      showEmoji(data.inner.emojis.map((e) => ({ symbol: e.symbol(), name: e.description() })));
    },
    didFail: () => end(new Error("The verification failed.")),
    didCancel: () => end(new Error(verificationCancelReason(cancelCode()))),
    didFinish: () => {
      over = true;
      finish();
    },
  });
  await sdk(controller.requestDeviceVerification());

  const shown = Promise.race([emoji, ended]);
  shown.catch(() => undefined);

  return {
    emoji: shown,
    ended,
    confirm: async () => {
      await shown;
      await sdk(controller.approveVerification());
      await Promise.race([finished, ended]);
      // This device is verified once the other device's signature of it has come down the sync.
      const deadline = Date.now() + verifiedTimeoutMs;
      while (await needsVerification(client)) {
        if (abandoned) throw new Error("The verification was cancelled.");
        if (Date.now() > deadline) throw new Error("The emoji were confirmed, but this device is still not verified.");
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
    },
    cancel: (mismatch) => {
      abandoned = true;
      stop(mismatch === true);
    },
  };
}
