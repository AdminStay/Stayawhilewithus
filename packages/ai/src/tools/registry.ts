import { proposeAction } from "../actions/approval";

import type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- type-erased registry; callers get the real generic type back from registerTool/getTool at their own call sites.
const tools = new Map<string, ToolDefinition<any, any>>();

export function registerTool<TInput, TOutput>(
  def: ToolDefinition<TInput, TOutput>,
): void {
  tools.set(def.name, def as ToolDefinition<unknown, unknown>);
}

export function getTool(name: string): ToolDefinition<unknown, unknown> {
  const tool = tools.get(name);
  if (!tool) {
    throw new Error(`No tool registered named "${name}".`);
  }
  return tool;
}

export function listTools(): ToolDefinition<unknown, unknown>[] {
  return [...tools.values()];
}

/**
 * Validates input against the tool's schema, then either runs the handler
 * directly or — when the tool requires approval — proposes an AiAction and
 * returns pending_approval without ever invoking the handler.
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
    return { status: "pending_approval", actionId: action.id };
  }

  const output = (await tool.handler(parsedInput, ctx)) as TOutput;
  return { status: "executed", output };
}
