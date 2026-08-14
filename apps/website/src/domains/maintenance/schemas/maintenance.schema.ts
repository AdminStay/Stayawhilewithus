import { z } from "zod";

export const createMaintenanceRequestSchema = z.object({
  propertyId: z.string().uuid(),
  category: z.enum([
    "PLUMBING",
    "ELECTRICAL",
    "HVAC",
    "APPLIANCE",
    "STRUCTURAL",
    "PEST_CONTROL",
    "OTHER",
  ]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "EMERGENCY"]),
  description: z.string().min(1).max(2000),
});

export type CreateMaintenanceRequestInput = z.infer<
  typeof createMaintenanceRequestSchema
>;

export const resolveMaintenanceRequestSchema = z.object({
  resolutionNotes: z.string().min(1).max(2000).optional().or(z.literal("")),
});

export type ResolveMaintenanceRequestInput = z.infer<
  typeof resolveMaintenanceRequestSchema
>;

export const assignMaintenanceRequestSchema = z.object({
  assignedToUserId: z.string().uuid().optional().or(z.literal("")),
});

export type AssignMaintenanceRequestInput = z.infer<
  typeof assignMaintenanceRequestSchema
>;
