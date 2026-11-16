/**
 * `AccountVerification` (src/app/runtime/deviceVerification.ts): whether this device is verified,
 * following the session, and the verification flows of the AccountView, on a faked session.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { AccountVerification, EMOJI_MISMATCH, type VerificationOutcome, type VerificationReport, type VerificationSession } from "../src/app/runtime/deviceVerification";
import { loggableIntent } from "../src/appViewModel";
import type { EmojiVerification, VerificationEmoji } from "../src/session";

const EMOJI: VerificationEmoji[] = [
  { symbol: "🐶", name: "Dog" },
  { symbol: "🔑", name: "Key" },
];
const KEY = "EsTc LW2K PGiF wKEA 3As5 g5c4 BXwk qeeJ ZJV8 Q9fu gUMN UE4d";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  promise.catch(() => undefined);
  return { promise, resolve, reject };
}

/** Let the promise chains of the fakes run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** An emoji verification the test drives: the emoji arrive, it ends, the other device confirms. */
function fakeEmojiVerification() {
  const emoji = deferred<VerificationEmoji[]>();
  const ended = deferred<never>();
  const confirmed = deferred<void>();
  const verification = { emoji: emoji.promise, ended: ended.promise, confirm: vi.fn(() => confirmed.promise), cancel: vi.fn() } satisfies EmojiVerification;
  return { verification, emoji, ended, confirmed };
}

function fakeSession(options: { needs?: boolean } = {}) {
  let needs = options.needs ?? true;
  const listeners = new Set<() => void>();
  const flow = fakeEmojiVerification();
  const session = {
    needsVerification: vi.fn(async () => needs),
    onVerificationChanged: vi.fn((listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    verifyWithRecoveryKey: vi.fn(async (key: string) => {
      if (key !== KEY) throw new Error("The key does not open the secret storage of this account.");
      needs = false;
    }),
    startEmojiVerification: vi.fn(async () => flow.verification),
  } satisfies VerificationSession;
  return {
    session,
    flow,
    listeners,
    setNeeds: (value: boolean) => (needs = value),
    /** The session says the verification state changed. */
    changed: () => listeners.forEach((listener) => listener()),
  };
}

/** An `AccountVerification` on `fake`, with everything it reported. */
function start(fake: ReturnType<typeof fakeSession>) {
  const reports: VerificationReport[] = [];
  const outcomes: VerificationOutcome[] = [];
  const verification = new AccountVerification(fake.session, { changed: (report) => reports.push(report), outcome: (outcome) => outcomes.push(outcome) });
  return { verification, reports, outcomes, last: () => reports.at(-1) };
}

afterEach(() => vi.restoreAllMocks());

describe("AccountVerification: whether this device is verified", () => {
  it("is read at the start, and again whenever the session says it changed (the device was verified elsewhere)", async () => {
    const fake = fakeSession();
    const { last } = start(fake);
    await settle();
    expect(last()).toEqual({ verified: false });

    fake.setNeeds(false);
    fake.changed();
    await settle();
    expect(last()).toEqual({ verified: true });
    expect(fake.session.needsVerification).toHaveBeenCalledTimes(2);
  });

  it("ignores the answer of a read that a newer one has overtaken", async () => {
    const fake = fakeSession();
    const slow = deferred<boolean>();
    fake.session.needsVerification.mockImplementationOnce(() => slow.promise);
    const { verification, last } = start(fake);
    fake.setNeeds(false);
    verification.refresh();
    await settle();
    expect(last()).toEqual({ verified: true });

    slow.resolve(true);
    await settle();
    expect(last()).toEqual({ verified: true });
  });

  it("keeps the last answer when a read fails (a suspended session), and reads again on refresh()", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fake = fakeSession();
    fake.session.needsVerification.mockRejectedValueOnce(new Error("the session is suspended"));
    const { verification, reports } = start(fake);
    await settle();
    expect(reports).toEqual([]);

    verification.refresh();
    await settle();
    expect(reports).toEqual([{ verified: false }]);
  });
});

describe("AccountVerification: with another device", () => {
  it("waits, shows the emoji, waits for the other device, then is verified at once and reads again", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    await settle();

    verification.startEmoji();
    expect(last()?.verification).toEqual({ step: "waiting" });
    fake.flow.emoji.resolve(EMOJI);
    await settle();
    expect(last()?.verification).toEqual({ step: "emoji", emoji: EMOJI, confirming: false });

    verification.answerEmoji(true);
    expect(last()?.verification).toEqual({ step: "emoji", emoji: EMOJI, confirming: true });
    expect(fake.flow.verification.confirm).toHaveBeenCalledOnce();

    fake.setNeeds(false);
    fake.flow.confirmed.resolve();
    await settle();
    expect(last()).toEqual({ verified: true, verification: { step: "done" } });
    expect(outcomes).toEqual([{ verified: true }]);
    expect(fake.session.needsVerification).toHaveBeenCalledTimes(2);

    // "Done" closes the success box.
    verification.cancel();
    expect(last()).toEqual({ verified: true, verification: undefined });
  });

  it("“They don't match” cancels it as a mismatch and shows the box with the reason", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    verification.startEmoji();
    fake.flow.emoji.resolve(EMOJI);
    await settle();

    verification.answerEmoji(false);
    expect(fake.flow.verification.cancel).toHaveBeenCalledExactlyOnceWith(true);
    expect(last()?.verification).toEqual({ step: "failed", error: EMOJI_MISMATCH });
    expect(outcomes).toEqual([{ verified: false, error: EMOJI_MISMATCH }]);
  });

  it("the other device cancelling while the emoji are compared ends it with the session's reason", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    verification.startEmoji();
    fake.flow.emoji.resolve(EMOJI);
    await settle();

    fake.flow.ended.reject(new Error("The verification was cancelled on the other device."));
    await settle();
    expect(last()?.verification).toEqual({ step: "failed", error: "The verification was cancelled on the other device." });
    expect(outcomes).toEqual([{ verified: false, error: "The verification was cancelled on the other device." }]);
    // A later answer of the same verification changes nothing.
    verification.answerEmoji(true);
    expect(fake.flow.verification.confirm).not.toHaveBeenCalled();
  });

  it("a request no device accepts in time ends with the session's reason", async () => {
    const fake = fakeSession();
    const { verification, last } = start(fake);
    verification.startEmoji();
    await settle();

    fake.flow.emoji.reject(new Error("The verification timed out."));
    fake.flow.ended.reject(new Error("The verification timed out."));
    await settle();
    expect(last()?.verification).toEqual({ step: "failed", error: "The verification timed out." });
  });

  it("confirmed emoji whose signature never arrives end with the session's reason", async () => {
    const fake = fakeSession();
    const { verification, last } = start(fake);
    verification.startEmoji();
    fake.flow.emoji.resolve(EMOJI);
    await settle();
    verification.answerEmoji(true);

    fake.flow.confirmed.reject(new Error("The emoji were confirmed, but this device is still not verified."));
    await settle();
    expect(last()).toEqual({ verified: false, verification: { step: "failed", error: "The emoji were confirmed, but this device is still not verified." } });
  });

  it("× while waiting cancels it; emoji that arrive later are ignored", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    await settle();
    verification.startEmoji();
    await settle();

    verification.cancel();
    expect(fake.flow.verification.cancel).toHaveBeenCalledOnce();
    expect(last()).toEqual({ verified: false, verification: undefined });

    fake.flow.emoji.resolve(EMOJI);
    fake.flow.ended.reject(new Error("The verification was cancelled or timed out."));
    await settle();
    expect(last()).toEqual({ verified: false, verification: undefined });
    expect(outcomes).toEqual([]);
  });

  it("× before the request has gone out cancels the verification the session hands over afterwards", async () => {
    const fake = fakeSession();
    const request = deferred<EmojiVerification>();
    fake.session.startEmojiVerification.mockImplementationOnce(() => request.promise);
    const { verification, last } = start(fake);
    verification.startEmoji();
    verification.cancel();

    request.resolve(fake.flow.verification);
    await settle();
    expect(fake.flow.verification.cancel).toHaveBeenCalled();
    expect(last()?.verification).toBeUndefined();
  });
});

describe("AccountVerification: with the recovery key", () => {
  it("a refused key keeps the form with the reason; the right key verifies; the key is in no report", async () => {
    const fake = fakeSession();
    const { verification, reports, last, outcomes } = start(fake);
    await settle();
    verification.startRecoveryKey();
    expect(last()?.verification).toEqual({ step: "recoveryKey", checking: false });

    verification.submitRecoveryKey("not the key");
    expect(last()?.verification).toEqual({ step: "recoveryKey", checking: true });
    await settle();
    expect(last()?.verification).toEqual({ step: "recoveryKey", checking: false, error: "The key does not open the secret storage of this account." });
    expect(outcomes).toEqual([{ verified: false, error: "The recovery key was not accepted. The key does not open the secret storage of this account." }]);

    verification.submitRecoveryKey(KEY);
    await settle();
    expect(fake.session.verifyWithRecoveryKey).toHaveBeenLastCalledWith(KEY);
    expect(last()).toEqual({ verified: true, verification: { step: "done" } });
    expect(JSON.stringify(reports)).not.toContain("not the key");
    expect(JSON.stringify(reports)).not.toContain(KEY);
  });

  it("× while the key is checked: its result shows nothing, but a check that went through anyway is read again", async () => {
    const fake = fakeSession();
    const check = deferred<void>();
    fake.session.verifyWithRecoveryKey.mockImplementationOnce(() => check.promise);
    const { verification, last, outcomes } = start(fake);
    await settle();
    verification.startRecoveryKey();
    verification.submitRecoveryKey(KEY);
    verification.cancel();
    expect(last()).toEqual({ verified: false, verification: undefined });

    fake.setNeeds(false);
    check.resolve();
    await settle();
    expect(last()).toEqual({ verified: true, verification: undefined });
    expect(outcomes).toEqual([]);
  });

  it("× while the key is checked: a refusal that arrives afterwards shows nothing", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    await settle();
    verification.startRecoveryKey();
    verification.submitRecoveryKey("not the key");
    verification.cancel();

    await settle();
    expect(last()).toEqual({ verified: false, verification: undefined });
    expect(outcomes).toEqual([]);
  });
});

describe("AccountVerification: its end", () => {
  it("stop() (the DevBackend was activated) ends a running verification with the reason", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    verification.startEmoji();
    await settle();

    verification.stop("The DevBackend was activated, which stops the verification.");
    expect(fake.flow.verification.cancel).toHaveBeenCalledOnce();
    expect(last()?.verification).toEqual({ step: "failed", error: "The DevBackend was activated, which stops the verification." });
    expect(outcomes).toHaveLength(1);

    // Nothing runs: nothing to stop.
    verification.stop("again");
    expect(outcomes).toHaveLength(1);
  });

  it("a device verified elsewhere drops the reason of an earlier failure", async () => {
    const fake = fakeSession();
    const { verification, last } = start(fake);
    verification.startEmoji();
    await settle();
    verification.stop("stopped");

    fake.setNeeds(false);
    fake.changed();
    await settle();
    expect(last()).toEqual({ verified: true, verification: undefined });
  });

  it("verified elsewhere while waiting for another device: the request is cancelled and the box says verified until “Done”", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    verification.startEmoji();
    await settle();

    fake.setNeeds(false);
    fake.changed();
    await settle();
    expect(fake.flow.verification.cancel).toHaveBeenCalledOnce();
    expect(last()).toEqual({ verified: true, verification: { step: "done" } });
    expect(outcomes).toEqual([{ verified: true }]);

    // Emoji or an end of the cancelled request change nothing.
    fake.flow.emoji.resolve(EMOJI);
    fake.flow.ended.reject(new Error("The verification was cancelled."));
    await settle();
    expect(last()).toEqual({ verified: true, verification: { step: "done" } });
    expect(outcomes).toHaveLength(1);
  });

  it("verified elsewhere while the recovery key form is open: verified until “Done”", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    await settle();
    verification.startRecoveryKey();

    fake.setNeeds(false);
    fake.changed();
    await settle();
    expect(last()).toEqual({ verified: true, verification: { step: "done" } });
    expect(outcomes).toEqual([{ verified: true }]);
    verification.submitRecoveryKey(KEY);
    expect(fake.session.verifyWithRecoveryKey).not.toHaveBeenCalled();
  });

  it("the signature arrives (change notification) before confirm() answers: one success, not two", async () => {
    const fake = fakeSession();
    const { verification, last, outcomes } = start(fake);
    verification.startEmoji();
    fake.flow.emoji.resolve(EMOJI);
    await settle();
    verification.answerEmoji(true);

    fake.setNeeds(false);
    fake.changed();
    await settle();
    expect(last()).toEqual({ verified: true, verification: { step: "done" } });
    fake.flow.confirmed.resolve();
    await settle();
    expect(last()).toEqual({ verified: true, verification: { step: "done" } });
    expect(outcomes).toEqual([{ verified: true }]);
  });

  it("dispose() unsubscribes from the session, cancels what runs and reports nothing more", async () => {
    const fake = fakeSession();
    const { verification, reports, outcomes } = start(fake);
    verification.startEmoji();
    await settle();
    const count = reports.length;

    verification.dispose();
    expect(fake.listeners.size).toBe(0);
    expect(fake.flow.verification.cancel).toHaveBeenCalledOnce();

    fake.flow.emoji.resolve(EMOJI);
    verification.refresh();
    verification.startRecoveryKey();
    await settle();
    expect(reports).toHaveLength(count);
    expect(outcomes).toEqual([]);
  });
});

describe("loggableIntent: what the intent logs show", () => {
  it("leaves out the recovery key and the password, and keeps every other intent as it is", () => {
    expect(JSON.stringify(loggableIntent({ type: "verification/submitRecoveryKey", accountId: "ada", recoveryKey: KEY }))).not.toContain("EsTc");
    expect(loggableIntent({ type: "login/withPassword", username: "ada", password: "hunter2" })).toEqual({ type: "login/withPassword", username: "ada" });
    const other = { type: "verification/answerEmoji", accountId: "ada", match: true } as const;
    expect(loggableIntent(other)).toBe(other);
  });
});
