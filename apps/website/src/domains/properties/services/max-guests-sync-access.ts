import "server-only";

import { assertPermission, hasPermission, type AuthContext } from "@stayw/auth";

import { hasGlobalRole } from "@/platform/auth/is-global-admin";

/**
 * Who may run "Sync max guests from OwnerRez" (2026-10-21): admins only.
 * properties:update alone isn't enough, because ops_manager holds it too —
 * so, like changing a cleaning's cleaner (cleaning-access.ts), the global
 * "admin" role is required on top of it. ops_manager's permissions are
 * unchanged; it keeps every other properties:update action. Enforced on the
 * server in syncMaxGuestsFromOwnerRez(); /properties only mirrors it.
 */
export const MAX_GUESTS_SYNC_ROLE_NAMES: readonly string[] = ["admin"];

export const MAX_GUESTS_SYNC_ADMIN_ONLY_ERROR =
  "Only an admin can sync maximum guests from OwnerRez.";

export async function canSyncMaxGuests(actor: AuthContext): Promise<boolean> {
  return (
    (await hasPermission(actor, "properties:update")) &&
    (await hasGlobalRole(actor, MAX_GUESTS_SYNC_ROLE_NAMES))
  );
}

/** Throws (before any read or OwnerRez call) unless the actor is an admin. */
export async function assertCanSyncMaxGuests(actor: AuthContext) {
  await assertPermission(actor, "properties:update");
  if (!(await hasGlobalRole(actor, MAX_GUESTS_SYNC_ROLE_NAMES))) {
    throw new Error(MAX_GUESTS_SYNC_ADMIN_ONLY_ERROR);
  }
}
