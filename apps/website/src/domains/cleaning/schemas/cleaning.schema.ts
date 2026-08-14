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
