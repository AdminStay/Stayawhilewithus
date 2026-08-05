export interface ProposeActionInput {
  conversationId?: string;
  toolName: string;
  proposedInput: Record<string, unknown>;
  reasoning?: string;
  riskLevel?: "LOW" | "STANDARD" | "HIGH";
  relatedEntityType?: string;
  relatedEntityId?: string;
}
