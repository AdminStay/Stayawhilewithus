import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * Narrow, team-schedule-only permission-catalog bootstrap — LOCAL
 * DEVELOPMENT DATABASE ONLY. Mirrors grant-notion-permissions.ts's own
 * reasoning exactly (see that script's doc comment for why this is a
 * narrow upsert and not a re-run of the full seed.ts).
 *
 * Unlike grant-notion-permissions.ts, this script has NEVER been run
 * against Production and must not be, without a separate, explicit
 * approval — the VA/team schedule feature is still local-only (no route
 * wired for anonymous/unapproved access, no Production deploy has
 * happened). Running this only grants a local dev database's roles the
 * ability to view the already-local-only /team route and dashboard widget
 * so they can be visually reviewed — see HANDOFF.md's Increment 98.
 *
 * Grants: admin gets exactly `team:read`/`team:update`/`team:manage` —
 * deliberately NOT `team:create`/`team:delete` (2026-09-17 correction:
 * nothing in this domain's application code ever asserts either of those
 * two keys — there is no "create a schedule record" or "delete a schedule
 * record" action anywhere; the schedule itself is a read-only mirror of
 * the Google Sheet, and the only writes are the durable sync
 * snapshot/log, which are actor-agnostic and never RBAC-gated by
 * team:create/team:delete — see schedule-persistence.ts). ops_manager
 * gets team:read only (view the schedule, no manual refresh, no
 * unresolved-identity diagnostic). No other role is granted anything.
 * Idempotent; touches no Property/Reservation/Task/User/SmartDevice row.
 *
 * `team:create`/`team:delete` are still upserted into the permission
 * CATALOG below (so they exist as real, assignable permission keys) —
 * that part is intentionally unchanged. This codebase generates its
 * entire permission catalog as a uniform `RESOURCES × ACTIONS` cross
 * product (packages/auth/src/permissions.ts: every resource automatically
 * gets all 5 actions, not just the ones actually used), the same way
 * every other resource in this app already has create/delete permission
 * keys that nothing currently checks. Removing them from the catalog
 * entirely would mean diverging "team" from that established, uniform
 * pattern — a broader permission-system change this narrow fix
 * deliberately does not make. This script only controls which roles are
 * GRANTED which keys, not which keys exist at all.
 *
 * Usage: pnpm --filter @stayw/database exec tsx scripts/grant-team-permissions.ts
 * (run only against a local DATABASE_URL — never STAYWHILE_SUPABASE_DATABASE_URL)
 */

const TEAM_ACTIONS = ["CREATE", "READ", "UPDATE", "DELETE", "MANAGE"] as const;

const GRANTS: Record<string, readonly string[]> = {
  admin: ["team:read", "team:update", "team:manage"],
  ops_manager: ["team:read"],
};

async function main() {
  console.log("Upserting team:* permission catalog rows...");
  const permissionRecords = await Promise.all(
    TEAM_ACTIONS.map((action) =>
      prisma.permission.upsert({
        where: { key: `team:${action.toLowerCase()}` },
        update: {},
        create: {
          key: `team:${action.toLowerCase()}`,
          resource: "team",
          action,
          description: `${action} on team`,
        },
      }),
    ),
  );
  console.log(`  ${permissionRecords.length} permissions ensured.`);

  for (const [roleName, keys] of Object.entries(GRANTS)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      throw new Error(
        `No role named "${roleName}" found — expected it to already exist in this database (this script only adds the "team" resource's permissions, never creates a role).`,
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

  console.log(
    "Done. No property, reservation, task, smart device, or user row was touched.",
  );
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
