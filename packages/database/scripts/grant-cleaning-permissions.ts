import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Cleaning access for ops_manager (Kenny/Michelle decision, 2026-10-07) —
 * same shape as grant-cleaners-permissions.ts. seed.ts now lists these keys
 * for ops_manager, but an environment where the seed isn't re-run (i.e.
 * Production) needs this explicit grant.
 *
 * Grants ONLY `ops_manager` → `cleaning_schedules:read`, `:create`,
 * `:update`. Permission checks match exact keys, so the existing
 * `cleaning_schedules:manage` grant never opened /cleaning by itself.
 *
 * Deliberately NOT granted: `cleaners:read`/`cleaners:manage` (cleaner
 * contacts, phones — a separate decision); any change to `cleaner`,
 * `admin` or other roles; a `staff` role (deferred — not created here).
 * Changing a cleaning's cleaner stays Admin (+ Staff once it exists), in
 * application code (cleaning-access.ts), not via these keys.
 *
 * Idempotent: upserts keyed on stable unique constraints — a second run
 * changes nothing. Touches no Property, CleaningSchedule, Task, Cleaner,
 * User or UserRole row.
 *
 * Usage: pnpm --filter @stayw/database exec tsx scripts/grant-cleaning-permissions.ts
 * (run against Production only once explicitly approved)
 */

const ROLE = "ops_manager";
const GRANTED = [
  { key: "cleaning_schedules:read", action: "READ" },
  { key: "cleaning_schedules:create", action: "CREATE" },
  { key: "cleaning_schedules:update", action: "UPDATE" },
] as const;

async function main() {
  const role = await prisma.role.findUniqueOrThrow({ where: { name: ROLE } });

  for (const { key, action } of GRANTED) {
    const permission = await prisma.permission.upsert({
      where: { key },
      update: {},
      create: {
        key,
        resource: "cleaning_schedules",
        action,
        description: `${action} on cleaning_schedules`,
      },
    });
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: role.id, permissionId: permission.id },
      },
      update: {},
      create: { roleId: role.id, permissionId: permission.id },
    });
  }

  console.log(
    `Granted [${GRANTED.map((g) => g.key).join(", ")}] to role "${ROLE}". No other role, and no data row, was touched.`,
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
