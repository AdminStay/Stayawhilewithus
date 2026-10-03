import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Narrow, cleaners-only permission bootstrap (Cleaner Assignments Phase 3,
 * 2026-10-03) — same shape and reasoning as grant-locks-permissions.ts:
 * `admin`'s `"*"` in seed.ts is expanded into real RolePermission rows only
 * when the FULL seed runs, so an environment where the seed hasn't been
 * re-run since `cleaners` was added (i.e. Production) needs this explicit
 * grant, or `cleaners:read`/`cleaners:manage` would be ungrantable to anyone.
 *
 * Grants ONLY `admin` → `cleaners:read` + `cleaners:manage`.
 * `cleaners:create`/`update`/`delete` are upserted into the catalog too
 * (uniform RESOURCES x ACTIONS pattern) but granted to no role; nothing in
 * application code checks them. `ops_manager` (or any other role) is
 * deliberately NOT granted anything here — which other roles may view or
 * manage cleaners is a pending Kenny/Michelle decision, not a side effect
 * of running this script.
 *
 * Idempotent: both upserts are keyed on stable unique constraints — a
 * second run changes nothing. Touches no Cleaner, assignment, Property,
 * CleaningSchedule, Task or User row.
 *
 * Usage: pnpm --filter @stayw/database exec tsx scripts/grant-cleaners-permissions.ts
 * (run against Production only once explicitly approved)
 */

const CLEANERS_ACTIONS = [
  "CREATE",
  "READ",
  "UPDATE",
  "DELETE",
  "MANAGE",
] as const;
const ADMIN_ROLE = "admin";
const ADMIN_GRANTED_KEYS = ["cleaners:read", "cleaners:manage"];

async function main() {
  console.log("Upserting cleaners:* permission catalog rows...");
  const permissionRecords = await Promise.all(
    CLEANERS_ACTIONS.map((action) =>
      prisma.permission.upsert({
        where: { key: `cleaners:${action.toLowerCase()}` },
        update: {},
        create: {
          key: `cleaners:${action.toLowerCase()}`,
          resource: "cleaners",
          action,
          description: `${action} on cleaners`,
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
    "Done. No other role was touched. No cleaner, assignment, property, cleaning, task, or user row was touched.",
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
