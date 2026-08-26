import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Role, type User, type UserRole } from "@stayw/database";

export type { Role, User, UserRole };

import type {
  AssignUserRoleInput,
  InviteTeamMemberInput,
} from "../schemas/users.schema";

import { recordAudit } from "@/platform/audit/record-audit";
import { ConflictError, NotFoundError } from "@/platform/errors";
import {
  createClerkInvitation,
  listPendingClerkInvitations,
  revokeClerkInvitation,
  type ClerkInvitationSummary,
} from "@/platform/identity/invite-clerk-user";

export type { ClerkInvitationSummary };

const GLOBAL_ADMIN_ROLE_NAME = "admin";

export async function listUsersWithRoles(actor: AuthContext) {
  await assertPermission(actor, "users:read");
  return prisma.user.findMany({
    where: { deletedAt: null },
    orderBy: { email: "asc" },
    include: {
      userRoles: {
        include: { role: true, property: true },
        orderBy: { assignedAt: "asc" },
      },
    },
  });
}

/**
 * Includes each role's granted permission keys (read-only — this is display
 * data for the "what does this role let someone do" reference table, not a
 * new write path) so an admin can see a role's actual access before
 * assigning it, not just its name.
 */
export async function listAssignableRoles(actor: AuthContext) {
  await assertPermission(actor, "roles:read");
  return prisma.role.findMany({
    orderBy: { name: "asc" },
    include: { rolePermissions: { include: { permission: true } } },
  });
}

/**
 * Idempotent by design: re-assigning a role a user already holds (same
 * userId/roleId/propertyId combination) is a no-op, not an error — mirrors
 * packages/database/scripts/grant-role.ts's existing behavior, which this
 * UI complements rather than replaces (that script remains a valid
 * emergency/manual fallback if the app itself is ever inaccessible).
 */
export async function assignUserRole(
  actor: AuthContext,
  targetUserId: string,
  rawInput: AssignUserRoleInput,
) {
  await assertPermission(actor, "roles:manage");

  const propertyId = rawInput.propertyId ?? null;

  const targetUser = await prisma.user.findUnique({
    where: { id: targetUserId },
  });
  if (!targetUser) {
    throw new NotFoundError("User", targetUserId);
  }

  const role = await prisma.role.findUnique({
    where: { id: rawInput.roleId },
  });
  if (!role) {
    throw new NotFoundError("Role", rawInput.roleId);
  }

  if (propertyId) {
    const property = await prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) {
      throw new NotFoundError("Property", propertyId);
    }
  }

  const existing = await prisma.userRole.findFirst({
    where: { userId: targetUserId, roleId: role.id, propertyId },
  });
  if (existing) {
    return existing;
  }

  const userRole = await prisma.userRole.create({
    data: {
      userId: targetUserId,
      roleId: role.id,
      propertyId,
      assignedById: actor.userId,
    },
    include: { role: true, property: true },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "user_role.assigned",
    entityType: "UserRole",
    entityId: userRole.id,
    afterState: userRole,
    metadata: { targetUserId, roleId: role.id, propertyId },
  });

  return userRole;
}

/**
 * Refuses to remove the last remaining global "admin" assignment in the
 * whole system — that role is the only one granted roles:manage (see
 * packages/database/prisma/seed.ts's SYSTEM_ROLES), so removing the last
 * one would make role management itself unrecoverable through the app
 * (packages/database/scripts/grant-role.ts would still work as a direct-
 * database escape hatch, but this guard exists so that isn't the only way
 * back in).
 */
export async function revokeUserRole(actor: AuthContext, userRoleId: string) {
  await assertPermission(actor, "roles:manage");

  const existing = await prisma.userRole.findUnique({
    where: { id: userRoleId },
    include: { role: true, property: true },
  });
  if (!existing) {
    throw new NotFoundError("UserRole", userRoleId);
  }

  if (
    existing.role.name === GLOBAL_ADMIN_ROLE_NAME &&
    existing.propertyId === null
  ) {
    const remainingGlobalAdminCount = await prisma.userRole.count({
      where: {
        roleId: existing.roleId,
        propertyId: null,
        id: { not: userRoleId },
      },
    });
    if (remainingGlobalAdminCount === 0) {
      throw new ConflictError(
        "Cannot revoke the last global admin. Assign the admin role to another user first.",
      );
    }
  }

  await prisma.userRole.delete({ where: { id: userRoleId } });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "user_role.revoked",
    entityType: "UserRole",
    entityId: existing.id,
    beforeState: existing,
    metadata: { targetUserId: existing.userId, roleId: existing.roleId },
  });

  return existing;
}

/**
 * Sends a real Clerk invitation email — deliberately does not create a
 * local User row (see platform/identity/invite-clerk-user.ts's doc
 * comment). The invitee's row only comes into existence the normal way
 * once they actually accept and sign in.
 *
 * When roleId is given, it's validated the same way assignUserRole
 * validates it (role exists, property exists if given) and carried on the
 * invitation itself so it can be applied automatically the moment the
 * User row is first created — see invite-clerk-user.ts's
 * pendingRoleFromPublicMetadata. Omitting roleId preserves today's
 * behavior exactly: invite now, assign a role later from the Users table.
 */
export async function inviteTeamMember(
  actor: AuthContext,
  input: InviteTeamMemberInput,
) {
  await assertPermission(actor, "users:create");
  const email = input.email.toLowerCase();

  const existingUser = await prisma.user.findFirst({
    where: { email: { equals: email, mode: "insensitive" } },
  });
  if (existingUser) {
    throw new ConflictError(`A user with email "${email}" already exists.`);
  }

  if (input.roleId) {
    const role = await prisma.role.findUnique({ where: { id: input.roleId } });
    if (!role) {
      throw new NotFoundError("Role", input.roleId);
    }
    if (input.propertyId) {
      const property = await prisma.property.findUnique({
        where: { id: input.propertyId },
      });
      if (!property) {
        throw new NotFoundError("Property", input.propertyId);
      }
    }
  }

  const invitation = await createClerkInvitation(
    email,
    input.roleId
      ? {
          roleId: input.roleId,
          propertyId: input.propertyId,
          invitedByUserId: actor.userId,
        }
      : undefined,
  );

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "team_member.invited",
    entityType: "ClerkInvitation",
    entityId: invitation.id,
    afterState: { ...invitation },
    metadata: { email, roleId: input.roleId, propertyId: input.propertyId },
  });

  return invitation;
}

export async function listPendingInvitations(actor: AuthContext) {
  await assertPermission(actor, "users:read");
  return listPendingClerkInvitations();
}

export async function revokeInvitation(
  actor: AuthContext,
  invitationId: string,
) {
  await assertPermission(actor, "users:delete");

  await revokeClerkInvitation(invitationId);

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "team_member.invitation_revoked",
    entityType: "ClerkInvitation",
    entityId: invitationId,
  });
}

/**
 * Deactivates in-app access only (User.status, not deletedAt) — the row,
 * its UserRole assignments, and every AuditLog row that references it stay
 * intact, so the person still shows up in the Team list with a
 * "Deactivated" badge instead of silently vanishing. Access is actually
 * blocked at the authentication boundary (get-current-user.ts's
 * assertActive check on every request), not by stripping roles, which is
 * also what makes this reversible at the data level even without a
 * "reactivate" action existing yet.
 */
export async function deactivateTeamMember(
  actor: AuthContext,
  targetUserId: string,
) {
  await assertPermission(actor, "users:delete");

  const target = await prisma.user.findUnique({
    where: { id: targetUserId },
    include: { userRoles: { include: { role: true } } },
  });
  if (!target) {
    throw new NotFoundError("User", targetUserId);
  }

  const globalAdminAssignment = target.userRoles.find(
    (ur) => ur.role.name === GLOBAL_ADMIN_ROLE_NAME && ur.propertyId === null,
  );
  if (globalAdminAssignment) {
    const remainingGlobalAdminCount = await prisma.userRole.count({
      where: {
        roleId: globalAdminAssignment.roleId,
        propertyId: null,
        userId: { not: targetUserId },
      },
    });
    if (remainingGlobalAdminCount === 0) {
      throw new ConflictError(
        "Cannot deactivate the last global admin. Assign the admin role to another user first.",
      );
    }
  }

  const deactivated = await prisma.user.update({
    where: { id: targetUserId },
    data: { status: "DEACTIVATED" },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "team_member.deactivated",
    entityType: "User",
    entityId: targetUserId,
    afterState: deactivated,
  });

  return deactivated;
}
