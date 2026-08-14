import { PageHeader } from "@stayw/ui";

import { listProperties } from "@/domains/properties/services/properties.service";
import { UserList } from "@/domains/users/components/UserList";
import {
  listAssignableRoles,
  listUsersWithRoles,
} from "@/domains/users/services/users.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function UsersPage() {
  const actor = await getCurrentUser();
  const [users, roles, properties] = await Promise.all([
    listUsersWithRoles(actor),
    listAssignableRoles(actor),
    listProperties(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${users.length} ${users.length === 1 ? "user" : "users"} · assign roles to grant module access`}
      />
      <UserList users={users} roles={roles} properties={properties} />
    </div>
  );
}
