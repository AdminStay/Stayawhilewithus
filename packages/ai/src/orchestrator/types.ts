import type { ContextRequest } from "../context/types";
import type { StopReason } from "../provider/types";
import type { ToolExecutionContext } from "../tools/types";

export interface OrchestratorTurnInput {
  conversationId: string;
  userMessage: string;
  promptKey: string;
  contextRequest?: ContextRequest;
  /** Names of tools (already registered in the Tool Registry) to make available this turn. */
  toolNames?: string[];
  toolContext?: ToolExecutionContext;
  /** Safety cap on the tool-use loop — default 5. Hitting it ends the turn and signals for human handoff rather than looping forever. */
  maxToolIterations?: number;
}

export interface OrchestratorToolCallRecord {
  name: string;
  input: unknown;
  status: "executed" | "pending_approval";
  output?: unknown;
  actionId?: string;
}

export interface OrchestratorTurnResult {
  assistantMessage: string;
  toolCalls: OrchestratorToolCallRecord[];
  pendingApproval: boolean;
  /** True when the loop hit maxToolIterations without reaching a final answer — a signal the caller should consider escalating to a human. */
  escalationRecommended: boolean;
  stopReason: StopReason;
}
