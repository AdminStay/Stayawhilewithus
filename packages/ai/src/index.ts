export { NotImplementedError } from "./errors";

export type {
  ContextFragment,
  ContextProvider,
  ContextRequest,
} from "./context/types";
export {
  assembleContext,
  getRegisteredContextProviders,
  registerContextProvider,
} from "./context/registry";

export type {
  KnowledgeQuery,
  KnowledgeResult,
  KnowledgeRetriever,
} from "./knowledge/types";
export { NotImplementedKnowledgeRetriever } from "./knowledge/retriever";

export type { PromptTemplate } from "./prompts/types";
export { getPrompt, registerPrompt, renderPrompt } from "./prompts/registry";

export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./tools/types";
export {
  executeTool,
  getTool,
  listTools,
  registerTool,
} from "./tools/registry";

export type {
  ClaudeClient,
  ClaudeCompletionInput,
  ClaudeMessage,
  OrchestratorTurnInput,
  OrchestratorTurnResult,
} from "./orchestrator/types";
export { NotImplementedClaudeClient } from "./orchestrator/claude-client";
export { runOrchestratorTurn } from "./orchestrator/run-turn";

export type {
  AppendMessageInput,
  CreateConversationInput,
} from "./conversations/types";
export {
  appendMessage,
  closeConversation,
  createConversation,
  getConversationHistory,
} from "./conversations/repository";

export type { ProposeActionInput } from "./actions/types";
export { InvalidActionStateError } from "./actions/errors";
export {
  approveAction,
  listPendingActions,
  markActionExecuted,
  markActionFailed,
  proposeAction,
  rejectAction,
} from "./actions/approval";
