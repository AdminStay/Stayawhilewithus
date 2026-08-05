import "server-only";

import type {
  Notification,
  NotificationChannel,
  NotificationType,
} from "@stayw/database";
import { prisma } from "@stayw/database";

export interface CreateNotificationInput {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  channel: NotificationChannel;
  relatedEntityType?: string;
  relatedEntityId?: string;
}

/** Single write path for Notification rows from app-layer domain services. */
export async function createNotification(
  input: CreateNotificationInput,
): Promise<Notification> {
  return prisma.notification.create({
    data: {
      userId: input.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      channel: input.channel,
      status: "PENDING",
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
    },
  });
}

/** Notifies every user holding a given global system role (e.g. "admin"). Returns the number of notifications created. */
export async function createNotificationsForGlobalRole(
  roleName: string,
  input: Omit<CreateNotificationInput, "userId">,
): Promise<number> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) return 0;

  const holders = await prisma.userRole.findMany({
    where: { roleId: role.id, propertyId: null },
    select: { userId: true },
    distinct: ["userId"],
  });
  if (holders.length === 0) return 0;

  const result = await prisma.notification.createMany({
    data: holders.map((h) => ({
      userId: h.userId,
      type: input.type,
      title: input.title,
      body: input.body,
      channel: input.channel,
      status: "PENDING" as const,
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
    })),
  });
  return result.count;
}
