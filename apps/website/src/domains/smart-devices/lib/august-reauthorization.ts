/**
 * Wording shown after August refused the sign-in (2026-10-21) — on
 * /locks (Refresh all result + the auto-refresh line) and on the
 * /integrations August card. No imports, so client components can use it.
 */
export const AUGUST_REAUTHORIZATION_STEPS =
  "Renew the August login, update the August settings in Vercel and redeploy, then press Refresh all on /locks.";

export const AUGUST_AUTO_REFRESH_PAUSED_MESSAGE = `August re-authorization required — automatic lock refresh is paused and saved readings are kept. ${AUGUST_REAUTHORIZATION_STEPS}`;

/** Manual Refresh all result after August refused the sign-in. */
export function augustReauthorizationMessage(notRequested: number): string {
  const skipped =
    notRequested > 0
      ? ` ${notRequested} lock${notRequested === 1 ? " was" : "s were"} not requested.`
      : "";
  return `August re-authorization required: August refused the sign-in.${skipped} Saved lock readings were kept and automatic refresh is paused. ${AUGUST_REAUTHORIZATION_STEPS}`;
}
