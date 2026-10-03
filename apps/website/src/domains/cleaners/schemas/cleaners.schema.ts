import { z } from "zod";

import { normalizePhone } from "../lib/phone";

export const CLEANER_STATUSES = ["ACTIVE", "INACTIVE"] as const;
export const CLEANER_ASSIGNMENT_ROLES = ["PRIMARY", "TEAM_MEMBER"] as const;

const phoneField = z
  .string()
  .trim()
  .min(1, "Phone is required.")
  .max(40)
  .transform((value, ctx) => {
    const normalized = normalizePhone(value);
    if (!normalized) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Enter a valid phone number — 10 digits for US numbers, or include the + country code.",
      });
      return z.NEVER;
    }
    return normalized;
  });

const cleanerFields = {
  name: z.string().trim().min(1, "Name is required.").max(120),
  phone: phoneField,
  notes: z.string().trim().max(2000).optional().or(z.literal("")),
};

export const createCleanerSchema = z.object(cleanerFields);
export type CreateCleanerInput = z.infer<typeof createCleanerSchema>;

export const updateCleanerSchema = z.object({
  id: z.string().uuid(),
  ...cleanerFields,
});
export type UpdateCleanerInput = z.infer<typeof updateCleanerSchema>;

export const setCleanerStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(CLEANER_STATUSES),
});
export type SetCleanerStatusInput = z.infer<typeof setCleanerStatusSchema>;

export const assignCleanerSchema = z.object({
  propertyId: z.string().uuid(),
  cleanerId: z.string().uuid({ message: "Choose a cleaner." }),
  role: z.enum(CLEANER_ASSIGNMENT_ROLES),
});
export type AssignCleanerInput = z.infer<typeof assignCleanerSchema>;

export const endCleanerAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
});
export type EndCleanerAssignmentInput = z.infer<
  typeof endCleanerAssignmentSchema
>;

/**
 * A backup contact number for a cleaner. `name`/`relationship` are both
 * optional: leave them empty for another number of the cleaner's own, or
 * fill them in for someone else reachable for them (e.g. "Sister").
 */
const cleanerContactFields = {
  phone: phoneField,
  name: z.string().trim().max(120).optional().or(z.literal("")),
  relationship: z.string().trim().max(60).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
};

export const addCleanerContactSchema = z.object({
  cleanerId: z.string().uuid(),
  ...cleanerContactFields,
});
export type AddCleanerContactInput = z.infer<typeof addCleanerContactSchema>;

export const updateCleanerContactSchema = z.object({
  id: z.string().uuid(),
  ...cleanerContactFields,
});
export type UpdateCleanerContactInput = z.infer<
  typeof updateCleanerContactSchema
>;

export const removeCleanerContactSchema = z.object({
  id: z.string().uuid(),
});
export type RemoveCleanerContactInput = z.infer<
  typeof removeCleanerContactSchema
>;
