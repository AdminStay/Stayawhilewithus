import "server-only";

import type { AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

const GLOBAL_ADMIN_ROLE_NAME = "admin";

/**
 * True when the actor holds ANY of `roleNames` GLOBALLY (propertyId = null)
 * and the assignment hasn't expired. For the rare rule that is deliberately
 * limited to named roles on top of a permission key — e.g. changing a
 * cleaning's cleaner, where cleaning_schedules:update is also held by the
 * "cleaner" and "ops_manager" roles. A property-scoped assignment never
 * counts. A role name that doesn't exist yet (e.g. a future "staff") simply
 * matches no one. Permission keys remain the normal gate everywhere else.
 */
export async function hasGlobalRole(
  actor: AuthContext,
  roleNames: readonly string[],
): Promise<boolean> {
  if (roleNames.length === 0) return false;
  const assignment = await prisma.userRole.findFirst({
    where: {
      userId: actor.userId,
      propertyId: null,
      role: { name: { in: [...roleNames] } },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return assignment !== null;
}

/** True when the actor holds the system "admin" role globally (see hasGlobalRole). */
export async function isGlobalAdmin(actor: AuthContext): Promise<boolean> {
  return hasGlobalRole(actor, [GLOBAL_ADMIN_ROLE_NAME]);
}
