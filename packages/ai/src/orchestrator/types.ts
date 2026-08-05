import type { ContextRequest } from "../context/types";

export interface ClaudeMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ClaudeCompletionInput {
  system: string;
  messages: ClaudeMessage[];
}

export interface ClaudeClient {
  complete(input: ClaudeCompletionInput): Promise<string>;
}

export interface OrchestratorTurnInput {
  conversationId: string;
  userMessage: string;
  promptKey: string;
  contextRequest?: ContextRequest;
}

export interface OrchestratorTurnResult {
  assistantMessage: string;
}
