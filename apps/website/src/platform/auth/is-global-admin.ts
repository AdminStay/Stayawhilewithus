import "server-only";

import type { AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

const GLOBAL_ADMIN_ROLE_NAME = "admin";

/**
 * True when the actor holds the system "admin" role GLOBALLY (propertyId =
 * null) and the assignment hasn't expired. For the rare rule that is
 * deliberately "admin only" on top of a permission key — e.g. changing a
 * cleaning's cleaner (Cleaner Phase 4), where cleaning_schedules:update is
 * also held by the "cleaner" role. A property-scoped admin assignment does
 * not count. Permission keys remain the normal gate everywhere else.
 */
export async function isGlobalAdmin(actor: AuthContext): Promise<boolean> {
  const assignment = await prisma.userRole.findFirst({
    where: {
      userId: actor.userId,
      propertyId: null,
      role: { name: GLOBAL_ADMIN_ROLE_NAME },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { id: true },
  });
  return assignment !== null;
}
