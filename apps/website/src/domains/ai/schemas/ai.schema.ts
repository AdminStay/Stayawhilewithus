import { z } from "zod";

export const sendAiMessageSchema = z.object({
  conversationId: z.string().uuid().optional().or(z.literal("")),
  message: z.string().min(1).max(4000),
});

export type SendAiMessageInput = z.infer<typeof sendAiMessageSchema>;

export const rejectAiActionSchema = z.object({
  rejectionReason: z.string().min(1).max(2000),
});

export type RejectAiActionInput = z.infer<typeof rejectAiActionSchema>;

export const escalateAiConversationSchema = z.object({
  details: z.string().max(2000).optional().or(z.literal("")),
});

export type EscalateAiConversationInput = z.infer<
  typeof escalateAiConversationSchema
>;
