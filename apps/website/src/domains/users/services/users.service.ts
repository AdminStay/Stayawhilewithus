import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Role, type User, type UserRole } from "@stayw/database";

export type { Role, User, UserRole };

import type { AssignUserRoleInput } from "../schemas/users.schema";

import { recordAudit } from "@/platform/audit/record-audit";
import { ConflictError, NotFoundError } from "@/platform/errors";

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

export async function listAssignableRoles(actor: AuthContext) {
  await assertPermission(actor, "roles:read");
  return prisma.role.findMany({ orderBy: { name: "asc" } });
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
