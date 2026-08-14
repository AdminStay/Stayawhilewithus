/**
 * Provider-agnostic model completion contract. Nothing here names Claude —
 * that's the point: swapping or adding a model provider means implementing
 * ModelProvider against these generic shapes, not rewriting the Orchestrator,
 * Planner, or Tool Execution Engine, none of which depend on any specific
 * vendor's request/response format. ClaudeProviderAdapter (../provider/
 * claude-provider.ts) is the one place vendor-specific mapping happens.
 */
export type ModelRole = "user" | "assistant";

export interface ModelTextBlock {
  type: "text";
  text: string;
}

export interface ModelToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: unknown;
}

export interface ModelToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  content: string;
  isError?: boolean;
}

export type ModelContentBlock =
  ModelTextBlock | ModelToolUseBlock | ModelToolResultBlock;

export interface ModelMessage {
  role: ModelRole;
  content: string | ModelContentBlock[];
}

export interface ModelToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface CompletionInput {
  system: string;
  messages: ModelMessage[];
  tools?: ModelToolDefinition[];
}

export type StopReason =
  "end_turn" | "tool_use" | "max_tokens" | "stop_sequence" | "unknown";

export interface CompletionResult {
  content: ModelContentBlock[];
  stopReason: StopReason;
}

/** Emitted while streaming; `text_delta` events carry incremental text, `message_stop` marks the end. */
export interface StreamEvent {
  type: "text_delta" | "message_stop";
  text?: string;
}

/** Implement this once per model vendor. The Orchestrator only ever depends on this interface, never on a concrete provider. */
export interface ModelProvider {
  complete(input: CompletionInput): Promise<CompletionResult>;
  completeStream(input: CompletionInput): AsyncIterable<StreamEvent>;
}
