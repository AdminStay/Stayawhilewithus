import "server-only";

import type { WebhookEvent } from "@clerk/nextjs/server";
import { prisma } from "@stayw/database";

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
      } = event.data;
      const primaryEmail = email_addresses.find(
        (e) => e.id === primary_email_address_id,
      )?.email_address;
      if (!primaryEmail) return;

      const byClerkId = await prisma.user.findUnique({
        where: { clerkUserId: id },
      });
      if (byClerkId) {
        await prisma.user.update({
          where: { id: byClerkId.id },
          data: {
            email: primaryEmail,
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
      const byEmail = await prisma.user.findUnique({
        where: { email: primaryEmail },
      });
      if (byEmail) {
        await prisma.user.update({
          where: { id: byEmail.id },
          data: {
            clerkUserId: id,
            firstName: first_name,
            lastName: last_name,
            avatarUrl: image_url,
          },
        });
        return;
      }

      await prisma.user.create({
        data: {
          clerkUserId: id,
          email: primaryEmail,
          firstName: first_name,
          lastName: last_name,
          avatarUrl: image_url,
        },
      });
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
