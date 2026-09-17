/**
 * Deterministic identity mapping from a schedule source's own person
 * identifier (e.g. exactly how a name appears in Michelle's VA/team
 * Google Sheet) to a real StayWhile `User.id` — same standing rule already
 * enforced for every other provider mapping in this codebase (August
 * locks, Cielo thermostats, OwnerRez/Notion properties): no automatic
 * name-based or fuzzy matching, ever. An admin must explicitly confirm
 * each pairing before it's added here.
 *
 * Deliberately EMPTY today. Two independent reasons, both confirmed by
 * inspection, not assumed: (1) no StayWhile `User` record exists for any
 * real VA/team member yet — the local dev database holds exactly 2 users
 * (the bootstrap admin and the developer's own test account), neither
 * named anything like a real schedule identity; (2) even if `User`
 * records did exist, the real sheet's own identities include clear
 * typo/spelling variants of what look like the same person (e.g.
 * "Henry"/"Heny", "Michelle"/"Mcihelle", "Gracey"/"Garcey"/"Grace",
 * "Catherine"/"Catheirne", "Ken"/"Kenny" — all confirmed present in the
 * real export) that this module will never silently merge. Each stays its
 * own distinct, unmapped key until a human confirms it — merging
 * "Heny"→"Henry" automatically risks being wrong exactly when it matters
 * (two genuinely different people with similar names), which is the same
 * reasoning this codebase already applies to every device/property
 * mapping. This is scaffolding, not a fake Production mapping.
 */
export interface TeamIdentityMapping {
  /** Exactly as the schedule source identifies this person — e.g. a sheet cell's literal text. Never normalized/fuzzy-matched against. */
  scheduleSourceKey: string;
  /** The StayWhile User this has been explicitly confirmed to be. */
  userId: string;
}

export const TEAM_IDENTITY_MAPPINGS: readonly TeamIdentityMapping[] = [];

/**
 * Resolves a schedule-source identity to a StayWhile User.id — `null` means
 * UNKNOWN/UNMAPPED, exactly like every other unresolved provider mapping
 * in this app (e.g. Nest's 10 unresolved device mappings, Increment 79+).
 * Never infers, never partial-matches, never case-folds — an exact,
 * explicit key match or nothing.
 */
export function resolveTeamMember(scheduleSourceKey: string): string | null {
  return (
    TEAM_IDENTITY_MAPPINGS.find(
      (m) => m.scheduleSourceKey === scheduleSourceKey,
    )?.userId ?? null
  );
}
