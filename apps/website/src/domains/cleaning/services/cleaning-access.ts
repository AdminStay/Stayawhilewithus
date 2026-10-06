import "server-only";

import {
  assertPermission,
  ForbiddenError,
  getPermissionScope,
  hasAnyScope,
  hasPermission,
  type AuthContext,
  type PermissionKey,
} from "@stayw/auth";
import type { Prisma } from "@stayw/database";

import { hasGlobalRole } from "@/platform/auth/is-global-admin";

/**
 * Who may see and change which cleanings (Kenny/Michelle role decisions,
 * 2026-10-07). Enforced here, on the server — the UI only mirrors it.
 *
 * - Property scope: a role assigned GLOBALLY applies to every property
 *   (admin, ops_manager). A role assigned to specific properties — the
 *   "cleaner" role, granted per property with grant-role.ts --property —
 *   reaches only those properties' cleanings: lists are filtered to them and
 *   a change to any other property's cleaning is refused.
 * - Choosing/changing/clearing a cleaning's cleaner (and recording that a
 *   cleaner was notified) is limited to the roles in
 *   CLEANER_CHANGE_ROLE_NAMES, held globally, on top of
 *   cleaning_schedules:update — that permission alone isn't enough, because
 *   ops_manager and cleaner hold it too.
 */

/**
 * Roles that may choose or change a cleaning's cleaner. Decision: Admin +
 * Staff. The Staff role doesn't exist yet (deferred) — when it is created,
 * add "staff" here; nothing else needs to change. A name with no matching
 * role matches no one, so nothing is granted before then.
 */
export const CLEANER_CHANGE_ROLE_NAMES: readonly string[] = ["admin"];

export async function canChangeCleaningCleaner(
  actor: AuthContext,
): Promise<boolean> {
  return (
    (await hasPermission(actor, "cleaning_schedules:update")) &&
    (await hasGlobalRole(actor, CLEANER_CHANGE_ROLE_NAMES))
  );
}

/**
 * The `where` fragment that limits a CleaningSchedule query to the
 * properties where the actor holds `permissionKey`: `{}` for a global
 * grant, `{ propertyId: { in: [...] } }` for property-scoped grants. Throws
 * ForbiddenError (before any query) when the actor holds it nowhere.
 */
export async function cleaningScopeWhere(
  actor: AuthContext,
  permissionKey: PermissionKey,
): Promise<Prisma.CleaningScheduleWhereInput> {
  const scope = await getPermissionScope(actor, permissionKey);
  if (!hasAnyScope(scope)) throw new ForbiddenError(permissionKey);
  return scope.global ? {} : { propertyId: { in: scope.propertyIds } };
}

/** True when the actor holds `permissionKey` globally or on at least one property. */
export async function hasCleaningPermissionAnywhere(
  actor: AuthContext,
  permissionKey: PermissionKey,
): Promise<boolean> {
  return hasAnyScope(await getPermissionScope(actor, permissionKey));
}

/** Throws ForbiddenError unless the actor holds `permissionKey` for this property (globally or scoped to it). */
export async function assertCleaningPropertyPermission(
  actor: AuthContext,
  permissionKey: PermissionKey,
  propertyId: string,
): Promise<void> {
  await assertPermission(actor, permissionKey, { propertyId });
}
