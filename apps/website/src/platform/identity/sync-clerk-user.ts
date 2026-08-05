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

      await prisma.user.upsert({
        where: { clerkUserId: id },
        update: {
          email: primaryEmail,
          firstName: first_name,
          lastName: last_name,
          avatarUrl: image_url,
        },
        create: {
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
