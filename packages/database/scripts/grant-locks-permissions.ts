import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Narrow, locks-only permission bootstrap — mirrors
 * grant-thermostats-manage-admin-only.mjs's own reasoning exactly (see that
 * script for the precedent this one is modeled on).
 *
 * CORRECTION (2026-09-18): an earlier version of this script assumed
 * `admin`'s `permissionKeys: "*"` in seed.ts's SYSTEM_ROLES is a runtime
 * bypass — it is not. `packages/auth/src/rbac.ts`'s `hasPermission()` does
 * a strict `RolePermission` lookup with no wildcard special-case anywhere;
 * `"*"` is expanded into real `RolePermission` rows only when the FULL
 * `seed.ts` runs. Upserting only the `locks:*` Permission catalog rows
 * (without an explicit RolePermission grant) would have left `locks:manage`
 * completely ungrantable to anyone, including admin, in any environment
 * where the full seed hasn't been re-run since this resource was added —
 * i.e. Production. Fixed by explicitly granting `admin` → `locks:manage`
 * here, the same way grant-thermostats-manage-admin-only.mjs already does
 * for `thermostats:manage`.
 *
 * Grants ONLY `admin` → `locks:manage`. `locks:read`/`create`/`update`/
 * `delete` are upserted into the catalog too (uniform `RESOURCES x ACTIONS`
 * pattern — see packages/auth/src/permissions.ts) but granted to no role;
 * nothing in application code checks them. `ops_manager` (or any other
 * role) is deliberately NOT granted `locks:manage` — extending it is a
 * separate, explicit decision, not a side effect of running this script.
 *
 * Idempotent: both the Permission and RolePermission upserts are keyed on
 * stable unique constraints — a second run changes nothing. Touches no
 * Property/Reservation/Task/SmartDevice/User row.
 *
 * Usage: pnpm --filter @stayw/database exec tsx scripts/grant-locks-permissions.ts
 * (run only once explicitly approved for Production — see HANDOFF.md for
 * the exact approved execution sequence)
 */

const LOCKS_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "MANAGE"] as const;
const ADMIN_ROLE = "admin";
const ADMIN_GRANTED_KEYS = ["locks:manage"];

async function main() {
  console.log("Upserting locks:* permission catalog rows...");
  const permissionRecords = await Promise.all(
    LOCKS_ACTIONS.map((action) =>
      prisma.permission.upsert({
        where: { key: `locks:${action.toLowerCase()}` },
        update: {},
        create: {
          key: `locks:${action.toLowerCase()}`,
          resource: "locks",
          action,
          description: `${action} on locks`,
        },
      }),
    ),
  );
  console.log(`  ${permissionRecords.length} permissions ensured.`);

  const adminRole = await prisma.role.findUniqueOrThrow({
    where: { name: ADMIN_ROLE },
  });

  const grantedPermissions = permissionRecords.filter((p) =>
    ADMIN_GRANTED_KEYS.includes(p.key),
  );

  await Promise.all(
    grantedPermissions.map((permission) =>
      prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: adminRole.id,
            permissionId: permission.id,
          },
        },
        update: {},
        create: { roleId: adminRole.id, permissionId: permission.id },
      }),
    ),
  );
  console.log(
    `  Granted [${grantedPermissions.map((p) => p.key).join(", ")}] to role "${ADMIN_ROLE}".`,
  );

  console.log(
    "Done. No other role was touched. No property, reservation, task, smart device, or user row was touched.",
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
