export { NotImplementedError } from "./errors";

// Context Builder
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

// Knowledge Retrieval (long-term/semantic memory — deliberately still a
// stub; needs a vector store, a separate credential-gated decision)
export type {
  KnowledgeQuery,
  KnowledgeResult,
  KnowledgeRetriever,
} from "./knowledge/types";
export { NotImplementedKnowledgeRetriever } from "./knowledge/retriever";

// Prompt Management
export type { PromptTemplate } from "./prompts/types";
export { getPrompt, registerPrompt, renderPrompt } from "./prompts/registry";

// Tool Registry (pure catalog — register/look up/list only)
export type {
  ToolDefinition,
  ToolExecutionContext,
  ToolExecutionResult,
} from "./tools/types";
export { getTool, listTools, registerTool } from "./tools/registry";

// Tool Execution Engine (runs a tool, enforcing the approval gate — the
// only path allowed to invoke a tool's handler). executeApprovedTool is the
// one deliberate exception: it runs a handler directly, for the sole case
// where a human has already approved an AiAction that required approval.
export { executeApprovedTool, executeTool } from "./tools/execution-engine";

// Model Provider — provider-agnostic contract, a runtime registry, and the
// one concrete vendor adapter StayWhile currently requires (Claude).
// Nothing outside ./provider knows these types are vendor-flavored; a
// future vendor implements the same ModelProvider interface and
// self-registers, and createModelProvider() never needs to change — see
// this package's README ("Provider subsystem") for exactly how.
export type {
  CompletionInput,
  CompletionResult,
  ModelContentBlock,
  ModelMessage,
  ModelRole,
  ModelProvider,
  ModelTextBlock,
  ModelToolDefinition,
  ModelToolResultBlock,
  ModelToolUseBlock,
  StopReason,
  StreamEvent,
} from "./provider/types";
export type { ModelProviderFactory } from "./provider/registry";
export {
  getModelProviderFactory,
  listModelProviderFactories,
  registerModelProviderFactory,
} from "./provider/registry";
export { ClaudeProviderAdapter } from "./provider/claude-provider";
export { NotConfiguredModelProvider } from "./provider/not-configured-provider";
export { createModelProvider } from "./provider/create-provider";

// Planner — pure decision logic for the agentic loop
export type {
  EscalationDecision,
  PlannerDecision,
  PostExecutionDecision,
  ToolExecutionOutcome,
} from "./planner/types";
export {
  extractText,
  extractToolUseBlocks,
  planAfterToolExecution,
  planEscalation,
  planNextStep,
} from "./planner/planner";

// Orchestrator — coordinates the modules above for one conversational turn
export type {
  OrchestratorToolCallRecord,
  OrchestratorTurnInput,
  OrchestratorTurnResult,
} from "./orchestrator/types";
export { runOrchestratorTurn } from "./orchestrator/orchestrator";

// Retry & Error Handling
export { defaultIsRetryable, withRetry } from "./orchestrator/retry";
export type { RetryOptions } from "./orchestrator/retry";

// Logging & Telemetry
export type { LogEntry, LogLevel, LogSink, Logger } from "./logging/logger";
export { createLogger, resetLogSink, setLogSink } from "./logging/logger";
export type {
  Telemetry,
  TelemetryEvent,
  TelemetrySink,
} from "./logging/telemetry";
export {
  createTelemetry,
  resetTelemetrySink,
  setTelemetrySink,
  timed,
} from "./logging/telemetry";

// Memory Management (short-term/conversation windowing)
export type { MemoryMessage, WindowOptions } from "./memory/window";
export { windowConversationHistory } from "./memory/window";

// Evaluation
export type {
  EvalCase,
  EvalCaseResult,
  EvalSuiteResult,
  GradeResult,
  Grader,
} from "./evaluation/types";
export { containsText, stopsWith, usesTool } from "./evaluation/graders";
export { runEvalSuite } from "./evaluation/runner";

// Human Escalation
export type {
  EscalateConversationInput,
  EscalationReason,
} from "./handoff/types";
export { escalateConversation } from "./handoff/escalate";

// Conversation Management
export type {
  AppendMessageInput,
  CreateConversationInput,
} from "./conversations/types";
export {
  appendMessage,
  closeConversation,
  createConversation,
  getConversation,
  getConversationHistory,
  listConversations,
} from "./conversations/repository";

// Action Approval Framework (the human-review side of Tool Execution)
export type { ProposeActionInput } from "./actions/types";
export { InvalidActionStateError } from "./actions/errors";
export {
  approveAction,
  listPendingActions,
  listRecentResolvedActions,
  markActionExecuted,
  markActionFailed,
  proposeAction,
  rejectAction,
} from "./actions/approval";
