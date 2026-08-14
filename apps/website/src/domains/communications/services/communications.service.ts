import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Message, type MessageThread } from "@stayw/database";

export type { Message, MessageThread };

import type {
  CreateMessageThreadInput,
  SendMessageInput,
} from "../schemas/communications.schema";

import { recordAudit } from "@/platform/audit/record-audit";
import { ConflictError, NotFoundError } from "@/platform/errors";

export async function listMessageThreads(actor: AuthContext) {
  await assertPermission(actor, "messages:read");
  return prisma.messageThread.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      property: true,
      guest: true,
      messages: { orderBy: { sentAt: "asc" } },
    },
  });
}

/**
 * All threads created here are `channel: "IN_APP"` — Slack/Gmail/Google
 * Voice are external channels wired via `@stayw/integrations` and n8n
 * (Increment 2, credential-gated), not this domain. Thread + first Message
 * are created together in one transaction, same shape as
 * Cleaning/Reservations' backing-row transactions.
 */
export async function createMessageThread(
  actor: AuthContext,
  input: CreateMessageThreadInput,
) {
  await assertPermission(actor, "messages:create");

  const thread = await prisma.$transaction(async (tx) => {
    const createdThread = await tx.messageThread.create({
      data: {
        subject: input.subject || undefined,
        channel: "IN_APP",
        propertyId: input.propertyId || undefined,
        reservationId: input.reservationId || undefined,
        guestId: input.guestId || undefined,
      },
    });

    await tx.message.create({
      data: {
        threadId: createdThread.id,
        direction: "OUTBOUND",
        senderUserId: actor.userId,
        body: input.body,
        sentAt: new Date(),
      },
    });

    return createdThread;
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "message_thread.created",
    entityType: "MessageThread",
    entityId: thread.id,
    afterState: thread,
  });

  return thread;
}

export async function sendMessage(
  actor: AuthContext,
  threadId: string,
  input: SendMessageInput,
) {
  await assertPermission(actor, "messages:create");

  const message = await prisma.$transaction(async (tx) => {
    const createdMessage = await tx.message.create({
      data: {
        threadId,
        direction: "OUTBOUND",
        senderUserId: actor.userId,
        body: input.body,
        sentAt: new Date(),
      },
    });

    // Empty update still bumps MessageThread.updatedAt via Prisma's @updatedAt.
    await tx.messageThread.update({
      where: { id: threadId },
      data: {},
    });

    return createdMessage;
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "message.sent",
    entityType: "Message",
    entityId: message.id,
    afterState: message,
  });

  return message;
}

export async function closeMessageThread(actor: AuthContext, threadId: string) {
  await assertPermission(actor, "messages:update");

  const thread = await prisma.messageThread.update({
    where: { id: threadId },
    data: { status: "CLOSED" },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "message_thread.closed",
    entityType: "MessageThread",
    entityId: thread.id,
    afterState: thread,
  });

  return thread;
}

/** Only closed threads can be archived — archiving is a step past closing, not an alternative to it. */
export async function archiveMessageThread(
  actor: AuthContext,
  threadId: string,
) {
  await assertPermission(actor, "messages:update");

  const existing = await prisma.messageThread.findUnique({
    where: { id: threadId },
  });
  if (!existing) {
    throw new NotFoundError("MessageThread", threadId);
  }
  if (existing.status !== "CLOSED") {
    throw new ConflictError("Only closed threads can be archived.");
  }

  const thread = await prisma.messageThread.update({
    where: { id: threadId },
    data: { status: "ARCHIVED" },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "message_thread.archived",
    entityType: "MessageThread",
    entityId: thread.id,
    afterState: thread,
  });

  return thread;
}
