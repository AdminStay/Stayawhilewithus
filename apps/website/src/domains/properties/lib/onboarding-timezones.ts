/**
 * Curated, narrow allowlist for the OwnerRez-onboarding timezone fallback —
 * used only when OwnerRez's own `time_zone` field is null/absent for a
 * property being onboarded (see ownerrez-onboarding.service.ts). Not "every
 * IANA zone" — these are the two zones the real, current portfolio actually
 * needs: Florida's peninsula (Bradenton/Sarasota/Largo/Saint Augustine) is
 * Eastern, while the Florida panhandle (Destin/Navarre/Pensacola Beach/Santa
 * Rosa Beach) and South Padre Island, TX are both Central — state alone
 * doesn't determine the zone, which is exactly why this must always be an
 * explicit human choice, never inferred from city/state/address. Extend
 * this list only when a real onboarded property genuinely needs a third
 * zone.
 *
 * Kept in this dependency-free lib file (no "server-only" import anywhere
 * in its chain) so both the server-side validator
 * (ownerrez-onboarding.service.ts) and the client-side <select> options
 * (CreatePropertyFromOwnerRezButton.tsx) share one literal list — never
 * duplicated, never able to drift apart.
 */
export const SUPPORTED_ONBOARDING_TIMEZONES = [
  "America/New_York",
  "America/Chicago",
] as const;

export type SupportedOnboardingTimezone =
  (typeof SUPPORTED_ONBOARDING_TIMEZONES)[number];

export function isSupportedOnboardingTimezone(
  value: string | null | undefined,
): value is SupportedOnboardingTimezone {
  return (
    value != null &&
    (SUPPORTED_ONBOARDING_TIMEZONES as readonly string[]).includes(value)
  );
}
