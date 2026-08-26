import {
  Badge,
  Button,
  Card,
  ConfirmButton,
  EmptyState,
  Select,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type Tone,
} from "@stayw/ui";
import { UserCog } from "lucide-react";

import {
  assignUserRoleAction,
  deactivateTeamMemberAction,
  revokeUserRoleAction,
} from "../actions";
import type { Role, User, UserRole } from "../services/users.service";

import type { Property } from "@/domains/properties/services/properties.service";

type UserWithRoles = User & {
  userRoles: (UserRole & { role: Role; property: Property | null })[];
};

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: "success",
  INVITED: "info",
  DEACTIVATED: "neutral",
};

export function UserList({
  users,
  roles,
  properties,
}: {
  users: UserWithRoles[];
  roles: Role[];
  properties: Property[];
}) {
  if (users.length === 0) {
    return (
      <Card noPadding>
        <EmptyState
          icon={UserCog}
          title="No users yet"
          description="Users appear here once they sign in for the first time."
        />
      </Card>
    );
  }

  return (
    <Table>
      <TableHead>
        <TableHeaderCell>User</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell>Current roles</TableHeaderCell>
        <TableHeaderCell className="text-right">Assign a role</TableHeaderCell>
        <TableHeaderCell className="text-right">Access</TableHeaderCell>
      </TableHead>
      <TableBody>
        {users.map((u) => (
          <TableRow key={u.id}>
            <TableCell>
              <span className="font-medium text-ink">
                {[u.firstName, u.lastName].filter(Boolean).join(" ") || u.email}
              </span>
              <span className="block text-xs text-ink-muted">{u.email}</span>
            </TableCell>
            <TableCell>
              <StatusIndicator
                label={u.status}
                tone={STATUS_TONE[u.status] ?? "neutral"}
              />
            </TableCell>
            <TableCell>
              {u.userRoles.length === 0 ? (
                <span className="text-xs text-ink-muted">No roles</span>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {u.userRoles.map((ur) => (
                    <span
                      key={ur.id}
                      className="inline-flex items-center gap-1"
                    >
                      <Badge tone="neutral">
                        {ur.role.name}
                        {ur.property ? ` @ ${ur.property.name}` : ""}
                      </Badge>
                      <form
                        action={revokeUserRoleAction}
                        className="inline-flex"
                      >
                        <input type="hidden" name="userRoleId" value={ur.id} />
                        <ConfirmButton
                          type="submit"
                          variant="ghost"
                          size="sm"
                          className="px-1 py-0.5 text-[11px]"
                          aria-label={`Revoke ${ur.role.name}${ur.property ? ` on ${ur.property.name}` : " (global)"} from ${u.email}`}
                          confirmMessage={`Revoke "${ur.role.name}"${ur.property ? ` on ${ur.property.name}` : " (global)"} from ${u.email}?`}
                        >
                          ✕
                        </ConfirmButton>
                      </form>
                    </span>
                  ))}
                </div>
              )}
            </TableCell>
            <TableCell>
              <form
                action={assignUserRoleAction}
                className="flex items-center justify-end gap-1.5"
              >
                <input type="hidden" name="userId" value={u.id} />
                <Select name="roleId" required className="py-1.5 text-xs">
                  {roles.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </Select>
                <Select name="propertyId" className="py-1.5 text-xs">
                  <option value="">Global</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </Select>
                <Button type="submit" variant="secondary" size="sm">
                  Assign
                </Button>
              </form>
            </TableCell>
            <TableCell className="text-right">
              {u.status === "DEACTIVATED" ? (
                <Badge tone="neutral">Deactivated</Badge>
              ) : (
                <form
                  action={deactivateTeamMemberAction}
                  className="inline-flex"
                >
                  <input type="hidden" name="userId" value={u.id} />
                  <ConfirmButton
                    type="submit"
                    variant="danger"
                    size="sm"
                    confirmMessage={`Deactivate ${u.email}? They will immediately lose access to the application. This does not delete their audit history and can be undone by an administrator directly in the database.`}
                  >
                    Deactivate
                  </ConfirmButton>
                </form>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
