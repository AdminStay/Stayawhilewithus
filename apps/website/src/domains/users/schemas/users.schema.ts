import { z } from "zod";

export const assignUserRoleSchema = z.object({
  roleId: z.string().uuid(),
  /** Omitted/empty means a global assignment; set means property-scoped. */
  propertyId: z.string().uuid().optional(),
});

export type AssignUserRoleInput = z.infer<typeof assignUserRoleSchema>;

export const inviteTeamMemberSchema = z.object({
  email: z.string().email(),
  /** Omitted means no role is pre-selected — the invitee gets no role until an admin assigns one later, same as today. */
  roleId: z.string().uuid().optional(),
  /** Only meaningful alongside roleId. Omitted/empty means a global assignment. */
  propertyId: z.string().uuid().optional(),
});

export type InviteTeamMemberInput = z.infer<typeof inviteTeamMemberSchema>;
