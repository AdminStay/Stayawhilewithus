import "server-only";

import { clerkClient } from "@clerk/nextjs/server";

export interface ClerkInvitationSummary {
  id: string;
  emailAddress: string;
  status: "pending" | "accepted" | "revoked" | "expired";
  url?: string;
}

/** Optional pending role, carried on the invitation itself — see createClerkInvitation's doc comment. */
export interface PendingRoleSelection {
  roleId: string;
  propertyId?: string;
  /** The admin who chose this role at invite time — attributed on the UserRole/audit entry created when the invitee first signs in, rather than left blank. */
  invitedByUserId?: string;
}

/**
 * Sends a real Clerk invitation email — no local User row is created here.
 * Clerk owns identity; the invitee's User row only comes into existence
 * once they actually accept and sign in, via the existing JIT-provisioning
 * (get-current-user.ts) or webhook-sync (sync-clerk-user.ts) paths. This is
 * deliberate: creating a placeholder User row up front would mean granting
 * a role to someone who has never authenticated, which is exactly what
 * "don't create a fake user" rules out.
 *
 * An optional `pendingRole` is stored as the invitation's own
 * `publicMetadata` — Clerk carries an invitation's `publicMetadata` onto
 * the resulting user's `publicMetadata` when they accept and sign up. Both
 * the webhook sync and the JIT-provisioning path read it back
 * (`pendingRoleFromPublicMetadata` below) to create the matching UserRole
 * at the moment the User row is first created — never before, since no
 * User row (and therefore no valid userId to attach a UserRole to) exists
 * until then.
 */
export async function createClerkInvitation(
  email: string,
  pendingRole?: PendingRoleSelection,
): Promise<ClerkInvitationSummary> {
  const invitation = await (
    await clerkClient()
  ).invitations.createInvitation({
    emailAddress: email,
    publicMetadata: pendingRole
      ? {
          pendingRoleId: pendingRole.roleId,
          pendingPropertyId: pendingRole.propertyId ?? null,
          pendingRoleInvitedByUserId: pendingRole.invitedByUserId ?? null,
        }
      : undefined,
  });
  return {
    id: invitation.id,
    emailAddress: invitation.emailAddress,
    status: invitation.status,
    url: invitation.url,
  };
}

/**
 * Reads back the pending role selection (if any) from a Clerk user's own
 * `publicMetadata` — the same shape createClerkInvitation wrote onto the
 * invitation. Deliberately tolerant of a missing/malformed value (a manual
 * sign-up with no invitation, or metadata set by something else entirely)
 * rather than throwing: a user is always created either way, just without
 * a role if this doesn't resolve to one.
 */
export function pendingRoleFromPublicMetadata(
  publicMetadata: unknown,
): PendingRoleSelection | null {
  if (typeof publicMetadata !== "object" || publicMetadata === null) {
    return null;
  }
  const metadata = publicMetadata as Record<string, unknown>;
  const roleId = metadata.pendingRoleId;
  if (typeof roleId !== "string") {
    return null;
  }
  const propertyId = metadata.pendingPropertyId;
  const invitedByUserId = metadata.pendingRoleInvitedByUserId;
  return {
    roleId,
    propertyId: typeof propertyId === "string" ? propertyId : undefined,
    invitedByUserId:
      typeof invitedByUserId === "string" ? invitedByUserId : undefined,
  };
}

export async function listPendingClerkInvitations(): Promise<
  ClerkInvitationSummary[]
> {
  const { data } = await (
    await clerkClient()
  ).invitations.getInvitationList({ status: "pending" });
  return data.map((invitation) => ({
    id: invitation.id,
    emailAddress: invitation.emailAddress,
    status: invitation.status,
    url: invitation.url,
  }));
}

export async function revokeClerkInvitation(
  invitationId: string,
): Promise<void> {
  await (await clerkClient()).invitations.revokeInvitation(invitationId);
}
