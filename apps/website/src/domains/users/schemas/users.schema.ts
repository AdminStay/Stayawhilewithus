import { z } from "zod";

export const assignUserRoleSchema = z.object({
  roleId: z.string().uuid(),
  /** Omitted/empty means a global assignment; set means property-scoped. */
  propertyId: z.string().uuid().optional(),
});

export type AssignUserRoleInput = z.infer<typeof assignUserRoleSchema>;
