/**
 * "Mark cleaner notified" (Cleaner Phase 5.2). Recording that an admin told
 * the job's cleaner — by hand, outside StayWhile — is stored as an
 * append-only AuditLog entry (same pattern as lock verification evidence):
 *
 * - entityType "CleaningSchedule", entityId = the cleaning job;
 * - afterState = the cleaner assigned AT THAT MOMENT ({ cleanerId,
 *   cleanerName }), so the record stays true if the job is reassigned;
 * - actorUserId = the notifying admin; occurredAt = when.
 *
 * No migration and no extra table. Nothing here sends any message.
 */
export const CLEANER_NOTIFIED_ACTION = "cleaning_schedule.cleaner_notified";

/** The latest notification recorded for one job, for display. */
export interface CleanerNotificationRecord {
  cleanerId: string;
  cleanerName: string;
  notifiedAt: Date;
  notifiedByName: string | null;
}

/** Defensive read of a stored afterState; null if it isn't the expected shape. */
export function parseNotifiedCleaner(
  afterState: unknown,
): { cleanerId: string; cleanerName: string } | null {
  if (typeof afterState !== "object" || afterState === null) return null;
  const { cleanerId, cleanerName } = afterState as Record<string, unknown>;
  if (typeof cleanerId !== "string" || typeof cleanerName !== "string") {
    return null;
  }
  return { cleanerId, cleanerName };
}
