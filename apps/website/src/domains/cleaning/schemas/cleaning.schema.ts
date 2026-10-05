import { z } from "zod";

export const createCleaningScheduleSchema = z.object({
  propertyId: z.string().uuid(),
  reservationId: z.string().uuid().optional().or(z.literal("")),
  cleaningType: z.enum([
    "TURNOVER",
    "DEEP_CLEAN",
    "INSPECTION_CLEAN",
    "MAINTENANCE_CLEAN",
  ]),
  scheduledDate: z.coerce.date(),
  scheduledStartTime: z.string().max(20).optional().or(z.literal("")),
  scheduledEndTime: z.string().max(20).optional().or(z.literal("")),
  /**
   * The cleaner for this one job (Cleaner Phase 4):
   * - omitted (undefined) → the property's current PRIMARY, or none;
   * - "" → explicitly no cleaner yet ("Needs cleaner");
   * - a cleaner id → that ACTIVE cleaner.
   * The /cleaning form submits it explicitly (pre-filled with the PRIMARY);
   * any value other than that default needs admin.
   */
  cleanerId: z.string().uuid().optional().or(z.literal("")),
});

export type CreateCleaningScheduleInput = z.infer<
  typeof createCleaningScheduleSchema
>;

export const rescheduleCleaningScheduleSchema = z.object({
  scheduledDate: z.coerce.date(),
});

export type RescheduleCleaningScheduleInput = z.infer<
  typeof rescheduleCleaningScheduleSchema
>;

/**
 * The per-job picker's value for "Needs cleaner (clear assignment)" —
 * distinct from "" (the unchosen "Choose cleaner…" placeholder, which is a
 * validation error), so clearing is always an explicit choice.
 */
export const CLEAR_CLEANER_VALUE = "none";

export const assignCleaningScheduleCleanerSchema = z.object({
  scheduleId: z.string().uuid(),
  /** A cleaner id, or null to clear the job back to "Needs cleaner". */
  cleanerId: z
    .union([
      z.string().uuid({ message: "Choose a cleaner." }),
      z.literal(CLEAR_CLEANER_VALUE, {
        errorMap: () => ({ message: "Choose a cleaner." }),
      }),
    ])
    .transform((value) => (value === CLEAR_CLEANER_VALUE ? null : value)),
});

export type AssignCleaningScheduleCleanerInput = z.infer<
  typeof assignCleaningScheduleCleanerSchema
>;
