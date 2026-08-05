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
