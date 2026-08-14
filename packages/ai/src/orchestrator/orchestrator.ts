import "server-only";

import { zodToJsonSchema } from "zod-to-json-schema";

import { assembleContext } from "../context/registry";
import {
  appendMessage,
  getConversationHistory,
} from "../conversations/repository";
import { NotImplementedError } from "../errors";
import { createLogger } from "../logging/logger";
import { createTelemetry } from "../logging/telemetry";
import { windowConversationHistory } from "../memory/window";
import {
  planAfterToolExecution,
  planEscalation,
  planNextStep,
} from "../planner/planner";
import type { ToolExecutionOutcome } from "../planner/types";
import { renderPrompt } from "../prompts/registry";
import { createModelProvider } from "../provider/create-provider";
import type {
  ModelContentBlock,
  ModelMessage,
  ModelProvider,
  ModelToolDefinition,
  ModelToolUseBlock,
  StopReason,
} from "../provider/types";
import { executeTool } from "../tools/execution-engine";
import { getTool } from "../tools/registry";
import type { ToolDefinition, ToolExecutionContext } from "../tools/types";

import { defaultIsRetryable, withRetry } from "./retry";
import type {
  OrchestratorToolCallRecord,
  OrchestratorTurnInput,
  OrchestratorTurnResult,
} from "./types";

const DEFAULT_MAX_TOOL_ITERATIONS = 5;
const logger = createLogger("orchestrator");
const telemetry = createTelemetry("orchestrator");

function toModelToolDefinition(tool: ToolDefinition): ModelToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: zodToJsonSchema(tool.inputSchema, {
      target: "jsonSchema7",
    }) as Record<string, unknown>,
  };
}

/**
 * AppendMessageInput.toolCalls is a `Record<string, unknown>` (matching
 * AiMessage.toolCalls' Prisma Json? column) rather than an array, so tool
 * call history survives a round trip through Prisma the same shape either
 * way. Returns undefined when there's nothing to record, so a plain
 * text-only turn's message doesn't get a stray `{ calls: [] }`.
 */
function toToolCallsRecord(
  toolCalls: OrchestratorToolCallRecord[],
): Record<string, unknown> | undefined {
  return toolCalls.length > 0 ? { calls: toolCalls } : undefined;
}

interface ToolRoundResult {
  outcomes: ToolExecutionOutcome[];
  resultBlocks: ModelContentBlock[];
  toolCalls: OrchestratorToolCallRecord[];
}

/** Runs every requested tool call through the Tool Execution Engine and shapes the results for both the Planner (outcomes) and the model (tool_result content blocks). */
async function runToolRound(
  toolUseBlocks: ModelToolUseBlock[],
  toolContext: ToolExecutionContext,
): Promise<ToolRoundResult> {
  const outcomes: ToolExecutionOutcome[] = [];
  const resultBlocks: ModelContentBlock[] = [];
  const toolCalls: OrchestratorToolCallRecord[] = [];

  for (const block of toolUseBlocks) {
    const execution = await executeTool(block.name, block.input, toolContext);

    if (execution.status === "pending_approval") {
      outcomes.push({
        block,
        status: "pending_approval",
        actionId: execution.actionId,
      });
      toolCalls.push({
        name: block.name,
        input: block.input,
        status: "pending_approval",
        actionId: execution.actionId,
      });
      resultBlocks.push({
        type: "tool_result",
        toolUseId: block.id,
        content: `This action requires human approval (pending action ${execution.actionId}) and has not been executed yet.`,
      });
    } else {
      outcomes.push({ block, status: "executed", output: execution.output });
      toolCalls.push({
        name: block.name,
        input: block.input,
        status: "executed",
        output: execution.output,
      });
      resultBlocks.push({
        type: "tool_result",
        toolUseId: block.id,
        content: JSON.stringify(execution.output),
      });
    }
  }

  return { outcomes, resultBlocks, toolCalls };
}

/**
 * The Orchestrator: coordinates the other modules for one conversational
 * turn — it doesn't decide anything itself. Context Builder assembles
 * background context; Prompt Management renders the system prompt;
 * Conversation Management persists messages; Memory Management windows
 * history to a token budget; the Model Provider (provider-agnostic — Claude
 * is the one concrete adapter today, see ../provider/, others can be added
 * without touching this file) produces a completion; the Planner
 * interprets that completion and decides what happens next; the Tool
 * Execution Engine runs whatever the Planner asks for; Retry & Error
 * Handling wraps the provider call. The only things owned here are the
 * iteration loop itself and dispatching each Planner decision to the right
 * module — genuine coordination, not business logic.
 */
export async function runOrchestratorTurn(
  input: OrchestratorTurnInput,
  modelProvider: ModelProvider = createModelProvider(),
): Promise<OrchestratorTurnResult> {
  const maxToolIterations =
    input.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
  const turnStart = Date.now();
  telemetry.count("turn.started", { conversationId: input.conversationId });

  const fragments = await assembleContext(input.contextRequest ?? {});
  const system = renderPrompt(input.promptKey, {
    context: fragments.map((f) => f.content).join("\n\n"),
  });

  await appendMessage({
    conversationId: input.conversationId,
    role: "USER",
    content: input.userMessage,
  });

  const fullHistory = await getConversationHistory(input.conversationId);
  // SYSTEM notices (config/approval/escalation messages) and any future
  // TOOL-role rows are app/audit-facing, not meaningful prior turns for the
  // model to see — only replay USER/ASSISTANT content.
  const windowedHistory = windowConversationHistory(
    fullHistory.filter((m) => m.role === "USER" || m.role === "ASSISTANT"),
  );

  const messages: ModelMessage[] = windowedHistory.map((m) => ({
    role: m.role === "ASSISTANT" ? "assistant" : "user",
    content: m.content,
  }));

  const tools = input.toolNames?.map((name) =>
    toModelToolDefinition(getTool(name)),
  );

  const toolContext: ToolExecutionContext = {
    ...input.toolContext,
    conversationId: input.conversationId,
  };

  const allToolCalls: OrchestratorToolCallRecord[] = [];
  let lastStopReason: StopReason = "unknown";

  for (let iteration = 0; iteration < maxToolIterations; iteration++) {
    logger.info("turn iteration", {
      conversationId: input.conversationId,
      iteration,
    });

    const result = await withRetry(
      () => modelProvider.complete({ system, messages, tools }),
      {
        // NotConfiguredModelProvider's throw means "not configured," not a
        // transient failure — retrying it three times with backoff would
        // just waste ~750ms on every call while the provider isn't set up.
        isRetryable: (err) =>
          !(err instanceof NotImplementedError) && defaultIsRetryable(err),
      },
    );
    lastStopReason = result.stopReason;

    const decision = planNextStep(result);

    if (decision.type === "respond") {
      await appendMessage({
        conversationId: input.conversationId,
        role: "ASSISTANT",
        content: decision.message,
        toolCalls: toToolCallsRecord(allToolCalls),
      });
      telemetry.duration("turn.completed", Date.now() - turnStart, {
        conversationId: input.conversationId,
        outcome: "responded",
      });

      return {
        assistantMessage: decision.message,
        toolCalls: allToolCalls,
        pendingApproval: false,
        escalationRecommended: false,
        stopReason: result.stopReason,
      };
    }

    messages.push({ role: "assistant", content: result.content });

    const { outcomes, resultBlocks, toolCalls } = await runToolRound(
      decision.toolUseBlocks,
      toolContext,
    );
    allToolCalls.push(...toolCalls);

    const postDecision = planAfterToolExecution(outcomes);

    if (postDecision.type === "pause_for_approval") {
      const notice =
        "I've proposed an action that needs approval before I can continue. I'll pick this up once it's reviewed.";
      await appendMessage({
        conversationId: input.conversationId,
        role: "ASSISTANT",
        content: notice,
        toolCalls: toToolCallsRecord(allToolCalls),
      });
      logger.info("turn paused for approval", {
        conversationId: input.conversationId,
      });
      telemetry.duration("turn.completed", Date.now() - turnStart, {
        conversationId: input.conversationId,
        outcome: "pending_approval",
      });

      return {
        assistantMessage: notice,
        toolCalls: allToolCalls,
        pendingApproval: true,
        escalationRecommended: false,
        stopReason: result.stopReason,
      };
    }

    messages.push({ role: "user", content: resultBlocks });
  }

  const escalation = planEscalation();
  logger.warn("turn hit max tool iterations", {
    conversationId: input.conversationId,
    maxToolIterations,
    reason: escalation.reason,
  });
  const notice =
    "I wasn't able to finish this within the allotted number of steps — flagging for a human to take over.";
  await appendMessage({
    conversationId: input.conversationId,
    role: "SYSTEM",
    content: notice,
  });
  telemetry.duration("turn.completed", Date.now() - turnStart, {
    conversationId: input.conversationId,
    outcome: "escalation_recommended",
  });

  return {
    assistantMessage: notice,
    toolCalls: allToolCalls,
    pendingApproval: false,
    escalationRecommended: true,
    stopReason: lastStopReason,
  };
}
