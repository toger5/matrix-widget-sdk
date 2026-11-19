/** What the rust and js sessions (and the DevBackend) have in common; SDK free. */

/** This app's URL, also under a sub-path (Vite's `base`, e.g. the dev site's `/<repo>/host/`): the OAuth client and redirect URIs. */
export const appUrl = () => new URL(import.meta.env.BASE_URL, location.origin).href;

/** How many members `roomDetails` returns. */
export const MEMBER_LIMIT = 30;
/** Up to this many joined members, `roomDetails` loads the whole member list from the homeserver. */
// TODO-FINDING room-details-member-loading - above this size the RoomOverview shows only the members the client has locally.
export const LOAD_MEMBERS_UP_TO = 500;
/** How many events one pagination of `exportRoom` asks for, and how many it makes at most. */
export const EXPORT_PAGE_SIZE = 100;
export const EXPORT_MAX_PAGES = 20;

export function roleFor(powerLevel: number): string | undefined {
  if (powerLevel >= 100) return "Admin";
  if (powerLevel >= 50) return "Moderator";
  return undefined;
}

/** Why a verification ended, for the AccountView, from its `m.key.verification.cancel` code. */
export function verificationCancelReason(code: string | null | undefined): string {
  switch (code) {
    case "m.timeout":
      return "The verification timed out.";
    case "m.user":
      return "The verification was cancelled on the other device.";
    case "m.mismatched_sas":
      return "The other device says the emoji did not match.";
    case "m.key_mismatch":
      return "The keys of the two devices did not match.";
    case null:
    case undefined:
    case "":
      return "The verification was cancelled or timed out.";
    default:
      return `The verification was cancelled (${code}).`;
  }
}

/** How long the other device's signature may take to arrive after both sides confirmed the emoji. */
const VERIFIED_TIMEOUT_MS = 20_000;

/**
 * Resolves once `verified()` says so: the other device's signature of this device has come down
 * the sync. Rejects when `abandoned()` (the user cancelled) or after `VERIFIED_TIMEOUT_MS`.
 */
export async function awaitVerified(verified: () => Promise<boolean>, abandoned: () => boolean, pollMs = 500): Promise<void> {
  const deadline = Date.now() + VERIFIED_TIMEOUT_MS;
  while (!(await verified())) {
    if (abandoned()) throw new Error("The verification was cancelled.");
    if (Date.now() > deadline) throw new Error("The emoji were confirmed, but this device is still not verified.");
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}
