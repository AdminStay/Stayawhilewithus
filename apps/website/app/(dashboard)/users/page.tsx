import { DialogTrigger, PageHeader } from "@stayw/ui";

import { listProperties } from "@/domains/properties/services/properties.service";
import { InviteTeamMemberForm } from "@/domains/users/components/InviteTeamMemberForm";
import { PendingInvitationsList } from "@/domains/users/components/PendingInvitationsList";
import { RolePermissionsList } from "@/domains/users/components/RolePermissionsList";
import { UserList } from "@/domains/users/components/UserList";
import {
  listAssignableRoles,
  listPendingInvitations,
  listUsersWithRoles,
} from "@/domains/users/services/users.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

export default async function UsersPage() {
  const actor = await getCurrentUser();
  const [users, roles, properties, invitations] = await Promise.all([
    listUsersWithRoles(actor),
    listAssignableRoles(actor),
    listProperties(actor),
    listPendingInvitations(actor),
  ]);

  return (
    <div>
      <PageHeader
        title="Users"
        subtitle={`${users.length} ${users.length === 1 ? "user" : "users"} · assign roles to grant module access`}
        actions={
          <DialogTrigger label="Invite team member" title="Invite team member">
            <InviteTeamMemberForm roles={roles} properties={properties} />
          </DialogTrigger>
        }
      />
      <PendingInvitationsList invitations={invitations} />
      <RolePermissionsList roles={roles} />
      <UserList users={users} roles={roles} properties={properties} />
    </div>
  );
}
