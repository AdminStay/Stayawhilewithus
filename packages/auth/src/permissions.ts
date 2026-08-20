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
  "integrations",
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
