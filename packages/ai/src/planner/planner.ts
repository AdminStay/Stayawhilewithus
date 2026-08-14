import type {
  CompletionResult,
  ModelContentBlock,
  ModelToolUseBlock,
} from "../provider/types";

import type {
  EscalationDecision,
  PlannerDecision,
  PostExecutionDecision,
  ToolExecutionOutcome,
} from "./types";

function isTextBlock(
  block: ModelContentBlock,
): block is Extract<ModelContentBlock, { type: "text" }> {
  return block.type === "text";
}

function isToolUseBlock(block: ModelContentBlock): block is ModelToolUseBlock {
  return block.type === "tool_use";
}

export function extractText(result: CompletionResult): string {
  return result.content
    .filter(isTextBlock)
    .map((block) => block.text)
    .join("\n");
}

export function extractToolUseBlocks(
  result: CompletionResult,
): ModelToolUseBlock[] {
  return result.content.filter(isToolUseBlock);
}

/**
 * The Planner: pure decision logic for "what should the Orchestrator do
 * next," given only the model's latest completion — no I/O, no side
 * effects, so it's trivially unit-testable and swappable (e.g. a planner
 * that reorders/parallelizes tool calls, or refuses certain combinations,
 * later) without touching the Orchestrator or any execution module.
 * Iteration-budget bookkeeping stays in the Orchestrator (pure loop
 * mechanics); planEscalation below is what the Orchestrator calls once
 * it's decided the budget is exhausted, so even that judgment is made in
 * one place a test can target directly.
 */
export function planNextStep(result: CompletionResult): PlannerDecision {
  if (result.stopReason !== "tool_use") {
    return { type: "respond", message: extractText(result) };
  }

  return { type: "execute_tools", toolUseBlocks: extractToolUseBlocks(result) };
}

/**
 * Decides whether the loop can continue after a round of tool execution, or
 * must pause because at least one call is now waiting on an async human
 * approval decision. The model can't meaningfully continue past a tool
 * result that hasn't actually happened yet.
 */
export function planAfterToolExecution(
  outcomes: ToolExecutionOutcome[],
): PostExecutionDecision {
  const sawPendingApproval = outcomes.some(
    (outcome) => outcome.status === "pending_approval",
  );
  return sawPendingApproval
    ? { type: "pause_for_approval" }
    : { type: "continue" };
}

/** Called once the Orchestrator's iteration budget is exhausted without a final answer. */
export function planEscalation(): EscalationDecision {
  return { type: "escalate", reason: "max_tool_iterations" };
}
