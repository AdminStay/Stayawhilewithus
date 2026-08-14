export type EscalationReason =
  "user_requested" | "max_tool_iterations" | "repeated_failure" | "other";

export interface EscalateConversationInput {
  conversationId: string;
  reason: EscalationReason;
  details?: string;
}
