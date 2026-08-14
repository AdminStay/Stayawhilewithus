import type { EscalationReason } from "../handoff/types";
import type { ModelToolUseBlock } from "../provider/types";

export type PlannerDecision =
  | { type: "respond"; message: string }
  | { type: "execute_tools"; toolUseBlocks: ModelToolUseBlock[] };

export interface ToolExecutionOutcome {
  block: ModelToolUseBlock;
  status: "executed" | "pending_approval";
  output?: unknown;
  actionId?: string;
}

export type PostExecutionDecision =
  { type: "continue" } | { type: "pause_for_approval" };

export interface EscalationDecision {
  type: "escalate";
  reason: EscalationReason;
}
