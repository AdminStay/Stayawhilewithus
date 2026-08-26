import { Badge, Card, SectionHeader } from "@stayw/ui";

import type { Role } from "../services/users.service";

type RoleWithPermissions = Role & {
  rolePermissions: { permission: { key: string } }[];
};

const GLOBAL_ADMIN_ROLE_NAME = "admin";

function groupByResource(keys: string[]): [string, string[]][] {
  const grouped = new Map<string, string[]>();
  for (const key of keys) {
    const [resource, action] = key.split(":");
    if (!resource || !action) continue;
    const actions = grouped.get(resource) ?? [];
    actions.push(action);
    grouped.set(resource, actions);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Read-only reference table — sourced entirely from data listAssignableRoles
 * already fetches (Role.rolePermissions.permission.key), no write path, no
 * schema change. Lets an admin see what a role actually grants before
 * assigning it, not just its name.
 */
export function RolePermissionsList({
  roles,
}: {
  roles: RoleWithPermissions[];
}) {
  return (
    <div className="mb-6">
      <SectionHeader
        title="Roles & permissions"
        description="What each role grants — check this before assigning one."
        size="lg"
      />
      <Card noPadding>
        <ul className="divide-y divide-border">
          {roles.map((role) => {
            const isUnrestricted = role.name === GLOBAL_ADMIN_ROLE_NAME;
            const grouped = isUnrestricted
              ? []
              : groupByResource(
                  role.rolePermissions.map((rp) => rp.permission.key),
                );

            return (
              <li key={role.id} className="px-4 py-3">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-ink">
                    {role.name}
                  </span>
                  {role.description && (
                    <span className="text-xs text-ink-muted">
                      {role.description}
                    </span>
                  )}
                </div>
                {isUnrestricted ? (
                  <div className="mt-1.5">
                    <Badge tone="gold">Unrestricted — all permissions</Badge>
                  </div>
                ) : grouped.length === 0 ? (
                  <p className="mt-1.5 text-xs text-ink-muted">
                    No permissions granted.
                  </p>
                ) : (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {grouped.map(([resource, actions]) => (
                      <Badge key={resource} tone="neutral">
                        {resource}: {actions.join(", ")}
                      </Badge>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>
    </div>
  );
}
