import type { UnmatchedOwnerRezSummary } from "../services/ownerrez-onboarding.service";

/**
 * Kept in this dependency-free lib file (rather than on
 * OwnerRezOnboardingPanel.tsx, which pulls in `../actions` and its
 * server-only-guarded service chain) so CopyActiveOwnerRezCsvButton.tsx can
 * format the same address string without dragging that chain into its own
 * client bundle/tests — the exact class of bug Increment 60 already hit and
 * fixed once for the smart-devices domain (see
 * `smart-devices/lib/discovered-device.ts`). The `UnmatchedOwnerRezSummary`
 * type import above is erased at build time (type-only), so it never pulls
 * in the service module's runtime code either.
 */
export function formatAddress(
  detail: UnmatchedOwnerRezSummary["detail"],
): string {
  if (!detail?.address) return "Address unavailable";
  const { street1, street2, city, state, postal_code, country } =
    detail.address;
  return [street1, street2, city, state, postal_code, country]
    .filter(Boolean)
    .join(", ");
}
