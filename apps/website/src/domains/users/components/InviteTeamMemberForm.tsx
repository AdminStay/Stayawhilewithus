import { Button, FormField, Input, Select } from "@stayw/ui";

import { inviteTeamMemberAction } from "../actions";

import type { Property } from "@/domains/properties/services/properties.service";
import type { Role } from "@/domains/users/services/users.service";

export function InviteTeamMemberForm({
  roles,
  properties,
}: {
  roles: Role[];
  properties: Property[];
}) {
  return (
    <form action={inviteTeamMemberAction} className="space-y-4">
      <FormField
        label="Email address"
        htmlFor="email"
        description="Sends a real Clerk sign-up invitation. They won't appear in the Users list until they accept and sign in."
      >
        <Input id="email" name="email" type="email" required />
      </FormField>
      <FormField
        label="Role (optional)"
        htmlFor="roleId"
        description="Applied automatically the moment they accept and sign in. Leave as “No role” to assign one later from the Users table instead."
      >
        <div className="flex items-center gap-1.5">
          <Select id="roleId" name="roleId" className="flex-1">
            <option value="">No role — assign later</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </Select>
          <Select name="propertyId" className="flex-1">
            <option value="">Global</option>
            {properties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
      </FormField>
      <Button type="submit" className="w-full">
        Send invitation
      </Button>
    </form>
  );
}
