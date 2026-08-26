import { Card, ConfirmButton, SectionHeader } from "@stayw/ui";

import { revokeInvitationAction } from "../actions";
import type { ClerkInvitationSummary } from "../services/users.service";

export function PendingInvitationsList({
  invitations,
}: {
  invitations: ClerkInvitationSummary[];
}) {
  if (invitations.length === 0) {
    return null;
  }

  return (
    <div className="mb-6">
      <SectionHeader
        title="Pending invitations"
        description={`${invitations.length} ${invitations.length === 1 ? "invite" : "invites"} not yet accepted`}
        size="lg"
      />
      <Card noPadding>
        <ul className="divide-y divide-border">
          {invitations.map((inv) => (
            <li
              key={inv.id}
              className="flex items-center justify-between px-4 py-3"
            >
              <span className="text-sm text-ink">{inv.emailAddress}</span>
              <form action={revokeInvitationAction}>
                <input type="hidden" name="invitationId" value={inv.id} />
                <ConfirmButton
                  type="submit"
                  variant="ghost"
                  size="sm"
                  confirmMessage={`Revoke the invitation sent to ${inv.emailAddress}?`}
                >
                  Revoke
                </ConfirmButton>
              </form>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
