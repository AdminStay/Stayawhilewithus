import "server-only";

import { Prisma, prisma } from "@stayw/database";

import type {
  AiConversationStatus,
  AppendMessageInput,
  CreateConversationInput,
} from "./types";

export function createConversation(input: CreateConversationInput) {
  return prisma.aiConversation.create({
    data: {
      context: input.context,
      model: input.model,
      subject: input.subject,
      initiatedByUserId: input.initiatedByUserId,
      guestId: input.guestId,
      propertyId: input.propertyId,
      status: "ACTIVE",
    },
  });
}

export function appendMessage(input: AppendMessageInput) {
  return prisma.aiMessage.create({
    data: {
      conversationId: input.conversationId,
      role: input.role,
      content: input.content,
      toolCalls: input.toolCalls as Prisma.InputJsonValue | undefined,
      tokenCount: input.tokenCount,
    },
  });
}

export function getConversationHistory(conversationId: string) {
  return prisma.aiMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: "asc" },
  });
}

export function listConversations() {
  return prisma.aiConversation.findMany({
    orderBy: { updatedAt: "desc" },
    include: {
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });
}

export function getConversation(conversationId: string) {
  return prisma.aiConversation.findUnique({
    where: { id: conversationId },
    include: {
      messages: { orderBy: { createdAt: "asc" } },
    },
  });
}

export function closeConversation(
  conversationId: string,
  status: Extract<AiConversationStatus, "RESOLVED" | "ESCALATED"> = "RESOLVED",
) {
  return prisma.aiConversation.update({
    where: { id: conversationId },
    data: { status },
  });
}
