import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Narrow, locks-only permission-catalog bootstrap — mirrors
 * grant-team-permissions.ts's own reasoning exactly (see that script's doc
 * comment for why this is a narrow upsert and not a re-run of the full
 * seed.ts).
 *
 * `admin` already has every permission via the `*` wildcard in seed.ts's
 * SYSTEM_ROLES — this script exists only to ensure the `locks:*` catalog
 * ROWS themselves exist (so they're real, assignable permission keys other
 * roles could later be granted), matching the uniform `RESOURCES x ACTIONS`
 * cross-product this app generates its whole permission catalog from (see
 * packages/auth/src/permissions.ts).
 *
 * Deliberately grants `locks:manage` to NO role explicitly here — `admin`
 * already has it via the wildcard, and per the 2026-09-18 August Lock
 * Control design decision, no other role (ops_manager included) is granted
 * physical lock-command capability yet. Extending it to another role is a
 * separate, explicit decision, not a side effect of running this script.
 *
 * `locks:read`/`locks:create`/`locks:update`/`locks:delete` are upserted
 * into the catalog too (uniform pattern) but are not — and are not intended
 * to be — used anywhere in application code: monitoring/mapping stays
 * gated on the existing `smart_devices:read`/`smart_devices:update`, and
 * `locks:manage` is the only key `august-commands.service.ts` ever checks.
 *
 * Usage: pnpm --filter @stayw/database exec tsx scripts/grant-locks-permissions.ts
 * (safe to run against Production — see HANDOFF.md for the exact approved
 * execution sequence; idempotent, touches no Property/Reservation/Task/
 * User/SmartDevice row, grants no role anything beyond what `admin` already
 * has via the wildcard)
 */

const LOCKS_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "MANAGE"] as const;

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
  console.log(
    "Done. No role was explicitly granted anything beyond admin's existing wildcard. No property, reservation, task, smart device, or user row was touched.",
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
