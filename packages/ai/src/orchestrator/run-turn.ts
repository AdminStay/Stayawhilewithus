import "server-only";

import { assembleContext } from "../context/registry";
import {
  appendMessage,
  getConversationHistory,
} from "../conversations/repository";
import { renderPrompt } from "../prompts/registry";

import { NotImplementedClaudeClient } from "./claude-client";
import type {
  ClaudeClient,
  OrchestratorTurnInput,
  OrchestratorTurnResult,
} from "./types";

/**
 * A single conversational turn: assemble context, render the system prompt,
 * persist the user's message, call Claude, then persist the reply. Defaults
 * to NotImplementedClaudeClient — pass a real client once one exists (or a
 * test double) to exercise the full turn end-to-end.
 */
export async function runOrchestratorTurn(
  input: OrchestratorTurnInput,
  claudeClient: ClaudeClient = new NotImplementedClaudeClient(),
): Promise<OrchestratorTurnResult> {
  const fragments = await assembleContext(input.contextRequest ?? {});
  const system = renderPrompt(input.promptKey, {
    context: fragments.map((f) => f.content).join("\n\n"),
  });

  await appendMessage({
    conversationId: input.conversationId,
    role: "USER",
    content: input.userMessage,
  });

  const history = await getConversationHistory(input.conversationId);
  const assistantMessage = await claudeClient.complete({
    system,
    messages: history.map((message) => ({
      role: message.role === "ASSISTANT" ? "assistant" : "user",
      content: message.content,
    })),
  });

  await appendMessage({
    conversationId: input.conversationId,
    role: "ASSISTANT",
    content: assistantMessage,
  });

  return { assistantMessage };
}
