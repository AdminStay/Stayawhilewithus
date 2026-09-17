/**
 * Single source of truth for the permission catalog. Mirrored by the
 * RESOURCES/ACTIONS lists in packages/database/prisma/seed.ts — keep both
 * in sync when adding a new resource or action.
 */
export const RESOURCES = [
  "properties",
  "reservations",
  "guests",
  "tasks",
  "cleaning_schedules",
  "maintenance_requests",
  "messages",
  "notifications",
  "smart_devices",
  // Deliberately separate from "smart_devices" — that resource covers
  // read/mapping (sync, ProviderDevice mapping); this one is scoped
  // specifically to live thermostat write commands, so granting mapping
  // access never implicitly grants physical-device control, and future
  // per-device-type command permissions (locks, access codes) each get
  // their own resource too rather than a shared "smart_devices:manage"
  // bucket. See nest-commands.service.ts.
  "thermostats",
  // Same reasoning as "thermostats" above, for August/Yale physical lock
  // commands (2026-09-18) — deliberately separate from "smart_devices"
  // (read/mapping) so granting mapping/monitoring access never implicitly
  // grants lock/unlock control. PIN/access-code management is explicitly
  // out of scope for this resource — it would get its own resource if/when
  // built, per this file's own long-standing convention, not folded in
  // here. See august-commands.service.ts.
  "locks",
  "integrations",
  // Deliberately separate from "integrations" — that resource covers the
  // existing generic read (Search/Property Listings, already live). This
  // resource is scoped specifically to Notion: "read" is the in-dashboard
  // detail-view visibility gate for standard fields, "manage" is the
  // separate sensitive-field visibility gate (lockbox/access-code-class
  // information, none approved yet), and "update" is the dashboard-edit
  // write path — kept apart from "read" so granting visibility never
  // implicitly grants write capability, same reasoning as "thermostats"
  // above.
  "notion",
  // The VA/team schedule domain (Michelle's Google Sheet → derived
  // availability). Separate from every device/property resource above —
  // "read" is the dashboard widget + dedicated schedule view (both show
  // exact source identities, never gated per-person; see
  // team-identity-mapping.ts), "update" is the manual on-demand refresh
  // trigger (re-fetches the source; never writes to it), and "manage" is
  // the admin-only unresolved-identity diagnostic. No role has any of
  // these granted anywhere yet outside a local dev bootstrap — see
  // packages/database/scripts/grant-team-permissions.ts and HANDOFF.md's
  // Increment 98 for why this is explicitly NOT applied to Production.
  "team",
  "ai_conversations",
  "ai_actions",
  "audit_logs",
  "users",
  "roles",
] as const;

export type Resource = (typeof RESOURCES)[number];

export const ACTIONS = [
  "create",
  "read",
  "update",
  "delete",
  "manage",
] as const;

export type Action = (typeof ACTIONS)[number];

export type PermissionKey = `${Resource}:${Action}`;

export const PERMISSIONS: readonly PermissionKey[] = RESOURCES.flatMap(
  (resource) =>
    ACTIONS.map((action) => `${resource}:${action}` as PermissionKey),
);

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSIONS as readonly string[]).includes(value);
}
