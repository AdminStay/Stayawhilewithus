import "server-only";

import type { WebhookEvent } from "@clerk/nextjs/server";
import { prisma } from "@stayw/database";

import { pendingRoleFromPublicMetadata } from "./invite-clerk-user";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Applies the role selected at invite time (if any — see
 * invite-clerk-user.ts's createClerkInvitation/pendingRoleFromPublicMetadata)
 * to a User row that has just been created for the first time. Deliberately
 * never called for an update to an already-existing row: a role chosen once
 * at invite time should apply exactly once, at first creation, not be
 * silently re-applied or overwritten on every subsequent webhook delivery.
 * Tolerant of a role/property that no longer exists (deleted between invite
 * and acceptance) — skips silently rather than failing user creation, since
 * getting the person an account at all matters more than this best-effort
 * convenience succeeding.
 */
export async function applyPendingRoleFromInvitation(
  userId: string,
  publicMetadata: unknown,
): Promise<void> {
  const pendingRole = pendingRoleFromPublicMetadata(publicMetadata);
  if (!pendingRole) return;

  const role = await prisma.role.findUnique({
    where: { id: pendingRole.roleId },
  });
  if (!role) return;

  if (pendingRole.propertyId) {
    const property = await prisma.property.findUnique({
      where: { id: pendingRole.propertyId },
    });
    if (!property) return;
  }

  const userRole = await prisma.userRole.create({
    data: {
      userId,
      roleId: role.id,
      propertyId: pendingRole.propertyId ?? null,
      assignedById: pendingRole.invitedByUserId ?? null,
    },
  });

  await recordAudit({
    actorUserId: pendingRole.invitedByUserId,
    actorType: "SYSTEM",
    action: "user_role.assigned_from_invitation",
    entityType: "UserRole",
    entityId: userRole.id,
    afterState: userRole,
    metadata: {
      targetUserId: userId,
      roleId: role.id,
      propertyId: pendingRole.propertyId,
    },
  });
}

/**
 * Applies a verified Clerk webhook event to the internal User table.
 * user.deleted soft-deletes (never hard-deletes) to preserve FK integrity
 * with AuditLog/Task/etc.
 */
export async function syncClerkUserFromWebhookEvent(
  event: WebhookEvent,
): Promise<void> {
  switch (event.type) {
    case "user.created":
    case "user.updated": {
      const {
        id,
        email_addresses,
        primary_email_address_id,
        first_name,
        last_name,
        image_url,
        public_metadata,
      } = event.data;
      const primaryEmail = email_addresses.find(
        (e) => e.id === primary_email_address_id,
      )?.email_address;
      if (!primaryEmail) return;
      // Always lowercased — see get-current-user.ts's identical comment:
      // User.email's unique constraint is case-sensitive at the database
      // level, so normalizing at every write site is what makes it behave
      // as a case-insensitive key in practice.
      const normalizedEmail = primaryEmail.toLowerCase();

      const byClerkId = await prisma.user.findUnique({
        where: { clerkUserId: id },
      });
      if (byClerkId) {
        await prisma.user.update({
          where: { id: byClerkId.id },
          data: {
            email: normalizedEmail,
            firstName: first_name,
            lastName: last_name,
            avatarUrl: image_url,
          },
        });
        return;
      }

      // No row for this Clerk id yet — a seed script (or an earlier JIT
      // provision, see apps/website/src/platform/auth/get-current-user.ts,
      // which has the identical reasoning) may have already created a row
      // for this email with a different clerkUserId. User.email is
      // @unique, so blindly creating here would throw instead of ever
      // reaching that row — claim it by relinking its clerkUserId instead.
      // findFirst + mode:"insensitive" (not findUnique) so a differently-
      // cased match still claims the same row.
      const byEmail = await prisma.user.findFirst({
        where: { email: { equals: normalizedEmail, mode: "insensitive" } },
      });
      if (byEmail) {
        await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            clerkUserId: id,
            email: normalizedEmail,
            firstName: first_name,
            lastName: last_name,
            avatarUrl: image_url,
          },
        });
        return;
      }

      const created = await prisma.user.create({
        data: {
          clerkUserId: id,
          email: normalizedEmail,
          firstName: first_name,
          lastName: last_name,
          avatarUrl: image_url,
        },
      });
      await applyPendingRoleFromInvitation(created.id, public_metadata);
      return;
    }
    case "user.deleted": {
      if (!event.data.id) return;
      await prisma.user
        .update({
          where: { clerkUserId: event.data.id },
          data: { status: "DEACTIVATED", deletedAt: new Date() },
        })
        .catch(() => {
          // User was never synced locally — nothing to deactivate.
        });
      return;
    }
    default:
      return;
  }
}
