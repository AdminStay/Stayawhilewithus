import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Narrow, Notion-only permission-catalog bootstrap for Production.
 *
 * Why this script exists instead of just re-running `prisma/seed.ts`
 * against Production: `seed.ts`'s `main()` unconditionally also creates
 * DEMO-001/DEMO-002 demo properties, demo reservations, demo cleaning
 * schedules, and demo tasks (see its `main()` body) — those were
 * deliberately and explicitly excluded from Production at cutover
 * (HANDOFF.md, Increment 23) and must stay excluded. Running the full seed
 * script against Production would silently reintroduce them. This script
 * upserts ONLY the 5 new "notion" resource Permission rows (create/read/
 * update/delete/manage, exact same key format `notion:{action}` seed.ts
 * itself uses) and the 2 RolePermission grants Increment 87's own
 * permissions.ts/seed.ts diff defines — nothing else. It is idempotent
 * (safe to re-run) and touches no Property/Reservation/Task/User row.
 *
 * Must run AFTER migration 20260915211143_add_notion_page_event has been
 * applied to the target database, and BEFORE this is relied on for a real
 * ops_manager user — see HANDOFF.md's Notion "Production approval package"
 * for the full, ordered sequence this script is one step of.
 *
 * Usage: pnpm --filter @stayw/database exec tsx scripts/grant-notion-permissions.ts
 * (run against whichever DATABASE_URL is active in the environment)
 */

const NOTION_ACTIONS = [
  "CREATE",
  "READ",
  "UPDATE",
  "DELETE",
  "MANAGE",
] as const;

// Matches this Increment's actual RBAC grants exactly (packages/auth/src/
// permissions.ts + packages/database/prisma/seed.ts diffs): every
// notion:* permission for admin (preserving its existing "full system
// access" invariant for this new resource), and only notion:read for
// ops_manager. No other role is granted anything here — cleaner/
// maintenance_tech/front_desk still cannot reach Notion at all, unchanged,
// pending Kenny/Michelle confirming which real role StayWhile's VAs use.
const GRANTS: Record<string, readonly string[]> = {
  admin: NOTION_ACTIONS.map((a) => `notion:${a.toLowerCase()}`),
  ops_manager: ["notion:read"],
};

async function main() {
  console.log("Upserting notion:* permission catalog rows...");
  const permissionRecords = await Promise.all(
    NOTION_ACTIONS.map((action) =>
      prisma.permission.upsert({
        where: { key: `notion:${action.toLowerCase()}` },
        update: {},
        create: {
          key: `notion:${action.toLowerCase()}`,
          resource: "notion",
          action,
          description: `${action} on notion`,
        },
      }),
    ),
  );
  console.log(`  ${permissionRecords.length} permissions ensured.`);

  for (const [roleName, keys] of Object.entries(GRANTS)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new Error(
        `No role named "${roleName}" found — expected it to already exist in this database (this script only adds the "notion" resource's permissions, never creates a role).`,
      );
    }

    const grantedPermissions = permissionRecords.filter((p) =>
      keys.includes(p.key),
    );

    await Promise.all(
      grantedPermissions.map((permission) =>
        prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          update: {},
          create: { roleId: role.id, permissionId: permission.id },
        }),
      ),
    );
    console.log(
      `  Granted [${grantedPermissions.map((p) => p.key).join(", ")}] to role "${roleName}".`,
    );
  }

  console.log("Done. No property, reservation, task, or user row was touched.");
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
