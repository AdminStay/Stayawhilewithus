import type { z } from "zod";

export interface ToolExecutionContext {
  userId?: string;
  conversationId?: string;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  /** When true, executeTool proposes an AiAction instead of running handler. */
  requiresApproval: boolean;
  riskLevel?: "LOW" | "STANDARD" | "HIGH";
  handler: (input: TInput, ctx: ToolExecutionContext) => Promise<TOutput>;
}

export type ToolExecutionResult<TOutput = unknown> =
  | { status: "executed"; output: TOutput }
  | { status: "pending_approval"; actionId: string };
