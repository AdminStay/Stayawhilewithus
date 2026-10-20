import { HttpRequestError } from "@stayw/integrations/core";

/**
 * A 403 alone is ambiguous: August returns it both for a genuinely
 * unauthorized/expired connection AND for a specific device/operation it
 * refuses for other reasons (2026-09-18 incident: MJ - Front Door's
 * remote-operate LOCK returned 403 while the account's other locks and
 * MJ's own read-only status/capability calls kept working fine on the same
 * credential — see august-commands investigation notes). Only the
 * provider's own error code/message saying something that actually sounds
 * like a credential/session problem makes a 403 account-wide. Shared by
 * august-commands.service.ts (command error wording) and
 * lock-refresh.service.ts (the bulk-refresh auth breaker, 2026-10-21).
 */
export const ACCOUNT_AUTH_HINT_PATTERN =
  /token|credential|unauthor|session|re.?auth/i;

/**
 * True when one failed August request says the ACCOUNT's sign-in was
 * rejected (2026-10-21): HTTP 401, or a 403 whose provider code/message
 * matches ACCOUNT_AUTH_HINT_PATTERN. A plain 403 (device-specific refusal)
 * is not. Reads only the status and HttpRequestError's two
 * already-sanitized provider fields — never the error message (which
 * contains the request path).
 */
export function isAugustAuthFailure(reason: unknown): boolean {
  if (!(reason instanceof HttpRequestError)) return false;
  if (reason.status === 401) return true;
  if (reason.status !== 403) return false;
  return ACCOUNT_AUTH_HINT_PATTERN.test(
    `${reason.providerErrorCode ?? ""} ${reason.providerMessage ?? ""}`,
  );
}
