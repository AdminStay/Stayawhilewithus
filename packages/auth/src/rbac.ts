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
 * (if provided). Excludes any UserRole whose expiresAt has already passed
 * — `null` means "never expires." This was a real gap until now: a role
 * assignment past its expiry was still silently counted as granted,
 * because nothing in this query ever checked expiresAt at all.
 *
 * When opts.propertyId is omitted, only global roles match — deliberately
 * built as a conditionally-*present* OR branch (spread into the array only
 * when opts.propertyId is set), not a conditionally-empty-object branch.
 * An empty object (`{}`) inside a Prisma OR array matches unconditionally
 * (no constraints = always true), so the previous `opts.propertyId ? {...}
 * : {}` form silently made a "no propertyId" call also match every
 * property-scoped role the user held, for any property — the opposite of
 * this function's own documented behavior. Fixed here.
 */
export async function getEffectivePermissions(
  actor: AuthContext,
  opts: PermissionCheckOptions = {},
): Promise<Set<PermissionKey>> {
  const userRoles = await prisma.userRole.findMany({
    where: {
      userId: actor.userId,
      AND: [
        {
          OR: [
            { propertyId: null },
            ...(opts.propertyId ? [{ propertyId: opts.propertyId }] : []),
          ],
        },
        { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
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
