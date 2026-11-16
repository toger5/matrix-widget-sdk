/**
 * Why a verification of this device ended, for the AccountView: from the code of its
 * `m.key.verification.cancel` (spec, "Key verification framework"). Shared by both SDK
 * implementations; imports no SDK.
 */
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
