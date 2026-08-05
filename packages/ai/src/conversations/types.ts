import type {
  AiConversationContext,
  AiConversationStatus,
  AiMessageRole,
} from "@stayw/database/enums";

export interface CreateConversationInput {
  context: AiConversationContext;
  model: string;
  subject?: string;
  initiatedByUserId?: string;
  guestId?: string;
  propertyId?: string;
}

export interface AppendMessageInput {
  conversationId: string;
  role: AiMessageRole;
  content: string;
  toolCalls?: Record<string, unknown>;
  tokenCount?: number;
}

export type { AiConversationStatus };
