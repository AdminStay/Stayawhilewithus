/**
 * "Cleaning jobs needing attention" (Cleaner Phase 5.3): OPEN cleaning jobs
 * with no assigned cleaner. Pure, read-only helpers over CleaningSchedule
 * data that is already loaded — no extra query, table or migration, and
 * nothing is ever assigned automatically.
 *
 * IMPORTANT: only meaningful for a viewer with `cleaners:read`.
 * listCleaningSchedules() blanks `cleanerId` for everyone else, which would
 * make every job look unassigned — callers must gate on that permission
 * (the same rule as the Cleaner column).
 */

/** Same set as the service's CLEANER_LOCKED_STATUSES: these jobs are finished. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set([
  "COMPLETED",
  "CANCELLED",
  "MISSED",
]);

/** The /cleaning query value that lists only these jobs. */
export const NEEDS_CLEANER_VIEW = "needs-cleaner";
export const NEEDS_CLEANER_HREF = `/cleaning?view=${NEEDS_CLEANER_VIEW}`;

export function needsCleaner(job: {
  status: string;
  cleanerId: string | null;
}): boolean {
  return job.cleanerId === null && !CLOSED_STATUSES.has(job.status);
}

export function jobsNeedingCleaner<
  T extends { status: string; cleanerId: string | null },
>(jobs: readonly T[]): T[] {
  return jobs.filter(needsCleaner);
}

/** "1 cleaning job needs attention" / "3 cleaning jobs need attention". */
export function needsCleanerTitle(count: number): string {
  return count === 1
    ? "1 cleaning job needs attention"
    : `${count} cleaning jobs need attention`;
}

export const NEEDS_CLEANER_DESCRIPTION =
  "These jobs don't have a cleaner assigned.";
