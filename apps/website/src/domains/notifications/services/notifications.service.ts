import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Notification } from "@stayw/database";

export type { Notification };

import { recordAudit } from "@/platform/audit/record-audit";
import { NotFoundError } from "@/platform/errors";

/**
 * A user's own notification center — scoped to `actor.userId` regardless of
 * role, since `notifications:read` gates *whether* someone can see a
 * notification feed at all, not *whose* feed they can see.
 */
export async function listNotifications(actor: AuthContext) {
  await assertPermission(actor, "notifications:read");
  return prisma.notification.findMany({
    where: { userId: actor.userId },
    orderBy: { createdAt: "desc" },
  });
}

export async function markNotificationRead(
  actor: AuthContext,
  notificationId: string,
) {
  await assertPermission(actor, "notifications:update");

  const existing = await prisma.notification.findUnique({
    where: { id: notificationId },
  });
  if (!existing || existing.userId !== actor.userId) {
    throw new NotFoundError("Notification", notificationId);
  }

  const updated = await prisma.notification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "notification.read",
    entityType: "Notification",
    entityId: updated.id,
    afterState: updated,
  });

  return updated;
}
