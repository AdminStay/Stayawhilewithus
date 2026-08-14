import { proposeAction } from "../actions/approval";
import { createLogger } from "../logging/logger";

import { getTool } from "./registry";
import type { ToolExecutionContext, ToolExecutionResult } from "./types";

const logger = createLogger("tools.execution-engine");

/**
 * Tool Execution Engine: validates input against the looked-up tool's
 * schema, then either runs the handler directly or — when the tool
 * requires approval — proposes an AiAction and returns pending_approval
 * without ever invoking the handler. This is the only path that's allowed
 * to actually run a tool handler; the Registry only knows how to look
 * tools up.
 */
export async function executeTool<TOutput = unknown>(
  name: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<ToolExecutionResult<TOutput>> {
  const tool = getTool(name);
  const parsedInput = tool.inputSchema.parse(input);

  if (tool.requiresApproval) {
    const action = await proposeAction({
      conversationId: ctx.conversationId,
      toolName: tool.name,
      proposedInput: parsedInput as Record<string, unknown>,
      riskLevel: tool.riskLevel,
    });
    logger.info("tool call proposed for approval", {
      toolName: tool.name,
      actionId: action.id,
    });
    return { status: "pending_approval", actionId: action.id };
  }

  const output = (await tool.handler(parsedInput, ctx)) as TOutput;
  logger.info("tool executed", { toolName: tool.name });
  return { status: "executed", output };
}

/**
 * Runs a tool's handler directly, bypassing the approval gate — the only
 * caller of this should be the approval-side flow (a human approved an
 * `AiAction` and its tool should now actually run). `executeTool()` can't be
 * reused for this: calling it again for a tool with `requiresApproval: true`
 * would just propose a second `AiAction` instead of running anything. This
 * keeps "run a tool handler" centralized in one file even for the
 * post-approval path, rather than a caller reaching into the registry and
 * invoking `tool.handler` itself.
 */
export async function executeApprovedTool<TOutput = unknown>(
  name: string,
  input: unknown,
  ctx: ToolExecutionContext,
): Promise<TOutput> {
  const tool = getTool(name);
  const parsedInput = tool.inputSchema.parse(input);
  const output = (await tool.handler(parsedInput, ctx)) as TOutput;
  logger.info("approved tool executed", { toolName: tool.name });
  return output;
}
