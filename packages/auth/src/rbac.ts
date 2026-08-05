import { prisma } from "@stayw/database";

import { ForbiddenError } from "./errors";
import type { PermissionKey } from "./permissions";

export interface AuthContext {
  userId: string;
}

export interface PermissionCheckOptions {
  /** When set, also matches roles scoped to this property (in addition to global roles). */
  propertyId?: string;
}

/**
 * Gathers the union of permission keys granted to a user: every permission
 * attached to a role assigned globally (propertyId = null), plus every
 * permission attached to a role assigned specifically to opts.propertyId
 * (if provided).
 */
export async function getEffectivePermissions(
  actor: AuthContext,
  opts: PermissionCheckOptions = {},
): Promise<Set<PermissionKey>> {
  const userRoles = await prisma.userRole.findMany({
    where: {
      userId: actor.userId,
      OR: [
        { propertyId: null },
        opts.propertyId ? { propertyId: opts.propertyId } : {},
      ],
    },
    include: {
      role: {
        include: {
          rolePermissions: { include: { permission: true } },
        },
      },
    },
  });

  const permissions = new Set<PermissionKey>();
  for (const userRole of userRoles) {
    for (const rolePermission of userRole.role.rolePermissions) {
      permissions.add(rolePermission.permission.key as PermissionKey);
    }
  }
  return permissions;
}

export async function hasPermission(
  actor: AuthContext,
  permissionKey: PermissionKey,
  opts: PermissionCheckOptions = {},
): Promise<boolean> {
  const permissions = await getEffectivePermissions(actor, opts);
  return permissions.has(permissionKey);
}

/** Throws ForbiddenError if the actor lacks permissionKey. Call this as the first line of every service function. */
export async function assertPermission(
  actor: AuthContext,
  permissionKey: PermissionKey,
  opts: PermissionCheckOptions = {},
): Promise<void> {
  const granted = await hasPermission(actor, permissionKey, opts);
  if (!granted) {
    throw new ForbiddenError(permissionKey, opts.propertyId);
  }
}
