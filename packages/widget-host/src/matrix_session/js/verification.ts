import type { MatrixClient } from "matrix-js-sdk";
import {
  CryptoEvent,
  decodeRecoveryKey,
  VerificationPhase,
  VerificationRequestEvent,
  VerifierEvent,
  type CryptoCallbacks,
  type ShowSasCallbacks,
  type VerificationRequest,
} from "matrix-js-sdk/lib/crypto-api";

import type { EmojiVerification } from "../../session";
import { verificationCancelReason } from "../verificationCancel";

/**
 * Device verification on a matrix-js-sdk client: whether this device is verified, a listener for
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

const NO_CRYPTO = "End-to-end encryption is not set up in this client.";
const NO_SECRET_STORAGE = "This account has no secret storage, so it has no recovery key. Verify this device with another device.";
const NOT_THE_KEY = "This is not the recovery key of this account.";
const NOT_IN_SECRET_STORAGE = "The secret storage of this account does not hold its cross-signing keys, so the recovery key cannot verify this device. Verify it with another device.";

/**
 * The recovery key, while `verifyWithRecoveryKey` runs: the SDK asks for it through the crypto
 * callback `getSecretStorageKey`, which is given to `createClient`. It is held nowhere else, and
 * handed out only for the account's default secret storage key, which it was checked against.
 */
export class RecoveryKeySlot {
  private held: { keyId: string; key: Uint8Array<ArrayBuffer> } | undefined;
  readonly getSecretStorageKey: NonNullable<CryptoCallbacks["getSecretStorageKey"]> = async ({ keys }) =>
    this.held && Object.hasOwn(keys, this.held.keyId) ? [this.held.keyId, this.held.key] : null;

  /** Whether a key is held right now. */
  get holds(): boolean {
    return this.held !== undefined;
  }

  /** Hold `key` (the secret storage key `keyId`) while `work` runs. */
  async holding<T>(keyId: string, key: Uint8Array<ArrayBuffer>, work: () => Promise<T>): Promise<T> {
    const held = { keyId, key };
    this.held = held;
    try {
      return await work();
    } finally {
      // A check the user cancelled may still run when the next one starts: drop only its own key.
      if (this.held === held) this.held = undefined;
    }
  }
}

/**
 * True when the account has cross-signing but this device is not signed by it. Asking whether the
 * own user has cross-signing keys downloads them again (the SDK does that for the own user).
 */
export async function needsVerification(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  if (!crypto || !client.getDeviceId()) return false;
  if (!(await crypto.userHasCrossSigningKeys(client.getSafeUserId(), true))) return false;
  return !(await crossSigned(client));
}

/** Whether this device is signed by the own cross-signing keys, from what the client has stored: no request. */
async function crossSigned(client: MatrixClient): Promise<boolean> {
  const crypto = client.getCrypto();
  const deviceId = client.getDeviceId();
  if (!crypto || !deviceId) return true;
  const status = await crypto.getDeviceVerificationStatus(client.getSafeUserId(), deviceId);
  return status?.crossSigningVerified === true;
}

/**
 * Call `listener` whenever the verification of this device may have changed: the trust in the own
 * user changed, the own cross-signing keys changed, or the own devices were updated (a signature
 * of this device arrived). Events about other users are ignored.
 */
export function onVerificationChanged(client: MatrixClient, listener: () => void): () => void {
  const own = client.getSafeUserId();
  const onTrust = (userId: string) => userId === own && listener();
  const onKeys = () => listener();
  const onDevices = (userIds: string[]) => userIds.includes(own) && listener();
  client.on(CryptoEvent.UserTrustStatusChanged, onTrust);
  client.on(CryptoEvent.KeysChanged, onKeys);
  client.on(CryptoEvent.DevicesUpdated, onDevices);
  return () => {
    client.off(CryptoEvent.UserTrustStatusChanged, onTrust);
    client.off(CryptoEvent.KeysChanged, onKeys);
    client.off(CryptoEvent.DevicesUpdated, onDevices);
  };
}

/**
 * The recovery key opens the account's secret storage: fetch the cross-signing keys from it
 * (which signs this device) and the key of the room key backup. `slot` holds the decoded key only
 * while the SDK reads them; its bytes are overwritten afterwards.
 *
 * The key is checked against the account's default secret storage key first, and the check only
 * goes on when the secret storage holds the cross-signing keys: without them `bootstrapCrossSigning`
 * would create new ones (and write them to the secret storage with this key) instead of reading.
 */
export async function verifyWithRecoveryKey(client: MatrixClient, slot: RecoveryKeySlot, recoveryKey: string): Promise<void> {
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(NO_CRYPTO);
  const key = decodeRecoveryKey(recoveryKey.trim());
  try {
    const keyId = await client.secretStorage.getDefaultKeyId();
    const keyInfo = keyId ? await client.secretStorage.getKey(keyId) : null;
    if (!keyId || !keyInfo) throw new Error(NO_SECRET_STORAGE);
    if (!(await client.secretStorage.checkKey(key, keyInfo[1]))) throw new Error(NOT_THE_KEY);
    if (!(await crypto.getCrossSigningStatus()).privateKeysInSecretStorage) throw new Error(NOT_IN_SECRET_STORAGE);
    await slot.holding(keyId, key, async () => {
      await crypto.bootstrapCrossSigning({});
      await crypto.loadSessionBackupPrivateKeyFromSecretStorage().catch((e: unknown) => console.warn("no room key backup key in secret storage", e));
    });
  } finally {
    key.fill(0);
  }
  // Verified or not, that is decided by now; the backup only decides which old messages can be read.
  await crypto.checkKeyBackupAndEnable().catch((e: unknown) => console.warn("checking the key backup failed", e));
  if (await needsVerification(client)) throw new Error("The recovery key was accepted, but this device is still not verified.");
}

const isOver = (request: VerificationRequest) => request.phase === VerificationPhase.Done || request.phase === VerificationPhase.Cancelled;

/** Resolves once the other device has accepted `request` (or started verifying right away). */
function accepted(request: VerificationRequest): Promise<void> {
  return new Promise((resolve, reject) => {
    const check = () => {
      const phase = request.phase;
      if (phase !== VerificationPhase.Ready && phase !== VerificationPhase.Started && !isOver(request)) return;
      request.off(VerificationRequestEvent.Change, check);
      if (phase === VerificationPhase.Cancelled) reject(new Error(verificationCancelReason(request.cancellationCode)));
      else if (phase === VerificationPhase.Done) reject(new Error("The verification ended before the emoji were shown."));
      else resolve();
    };
    request.on(VerificationRequestEvent.Change, check);
    check();
  });
}

/**
 * Emoji (SAS) verification, started from here: every other device of the account gets the
 * request, the one that accepts it compares emoji with this one and then signs this device.
 * The secrets (cross-signing keys, backup key) follow from that device on their own.
 */
export async function startEmojiVerification(client: MatrixClient, options: EmojiVerificationOptions = {}): Promise<EmojiVerification> {
  const { verifiedTimeoutMs = VERIFIED_TIMEOUT_MS, pollMs = POLL_MS } = options;
  const crypto = client.getCrypto();
  if (!crypto) throw new Error(NO_CRYPTO);
  const request = await crypto.requestOwnUserVerification();
  let sas: ShowSasCallbacks | undefined;
  let done: Promise<void> | undefined;
  let cancelled = false;
  /** Set by `cancel()`, also once it is over: `confirm()` stops waiting for the signature. */
  let abandoned = false;

  // Rejects when the request is cancelled (by either side, or by a timeout) or the verifier fails.
  let end!: (reason: Error) => void;
  const ended = new Promise<never>((_, reject) => (end = reject));
  ended.catch(() => undefined);
  const onChange = () => {
    if (request.phase === VerificationPhase.Cancelled) end(new Error(verificationCancelReason(request.cancellationCode)));
    if (isOver(request)) request.off(VerificationRequestEvent.Change, onChange);
  };
  request.on(VerificationRequestEvent.Change, onChange);
  onChange();

  const emoji = Promise.race([
    (async () => {
      await accepted(request);
      // `Started`: the other device chose emoji already and the verifier exists.
      const verifier = request.verifier ?? (await request.startVerification("m.sas.v1"));
      const shown = new Promise<ShowSasCallbacks>((resolve) => {
        const callbacks = verifier.getShowSasCallbacks();
        if (callbacks) resolve(callbacks);
        else verifier.once(VerifierEvent.ShowSas, resolve);
      });
      // Runs until both sides have confirmed; rejects when either side cancels.
      done = verifier.verify();
      done.catch((e: unknown) => end(e instanceof Error ? e : new Error(String(e))));
      sas = await Promise.race([
        shown,
        done.then(() => {
          throw new Error("The verification ended before the emoji were shown.");
        }),
      ]);
      if (!sas.sas.emoji) throw new Error("The other device offers no emoji to compare.");
      return sas.sas.emoji.map(([symbol, name]) => ({ symbol, name }));
    })(),
    ended,
  ]);
  emoji.catch(() => undefined);

  return {
    emoji,
    ended,
    confirm: async () => {
      await emoji;
      await sas!.confirm();
      await Promise.race([done, ended]);
      // This device is verified once the other device's signature of it has come down the sync,
      // which updates the client's copy of the own devices: no download while waiting.
      const deadline = Date.now() + verifiedTimeoutMs;
      while (!(await crossSigned(client))) {
        if (abandoned) throw new Error("The verification was cancelled.");
        if (Date.now() > deadline) throw new Error("The emoji were confirmed, but this device is still not verified.");
        await new Promise((resolve) => setTimeout(resolve, pollMs));
      }
      await crypto.checkKeyBackupAndEnable().catch((e: unknown) => console.warn("checking the key backup failed", e));
    },
    cancel: (mismatch) => {
      abandoned = true;
      if (cancelled || isOver(request)) return;
      cancelled = true;
      if (mismatch && sas) sas.mismatch();
      else request.cancel().catch((e: unknown) => console.warn("cancelling the verification failed", e));
    },
  };
}
