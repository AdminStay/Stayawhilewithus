# @stayw/ai

The AI platform layer: a real, model-agnostic tool-use orchestrator, distinct from `@stayw/ai-automation` (deterministic n8n workflow triggers). n8n and the Orchestrator are peers — the Orchestrator can call `triggerWorkflow()` as a registered tool in a later phase, not wired yet. Depends only on `@stayw/database`; never on `@stayw/integrations` (tool handlers wrapping integration clients are the app/domain layer's job, keeping this package provider-agnostic). See ADR-0007.

**The Orchestrator coordinates; it doesn't decide anything itself.** Every responsibility below is its own module with its own tests. This is deliberate: swapping the model vendor, changing how tool calls get planned, or adding a new memory strategy should each touch exactly one module, not the loop that ties them together. "Model-agnostic" here means the _interface_ everything else depends on is generic (see "Provider subsystem" below) — StayWhile currently only requires Claude, and only Claude is implemented; the architecture doesn't get ahead of that.

`AI_MODEL_PROVIDER` (default `"claude"`) plus `ANTHROPIC_API_KEY` gate one narrow thing: whether `createModelProvider()` hands back `ClaudeProviderAdapter` or `NotConfiguredModelProvider` (throws on `complete`/`completeStream`). Everything else — planning, tool execution, memory windowing, retries, logging, the approval gate, conversation persistence, evaluation, human handoff — works today regardless of whether that credential is set.

## Modules

| Responsibility                         | Module                      | Status                                                                                                                                                                                                                              |
| -------------------------------------- | --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Conversation Management                | `conversations/`            | real, against `AiConversation`/`AiMessage`                                                                                                                                                                                          |
| Memory Management                      | `memory/`                   | real — token-budget conversation windowing (short-term only; see Knowledge Retrieval)                                                                                                                                               |
| Prompt Management                      | `prompts/`                  | real                                                                                                                                                                                                                                |
| Tool Registry                          | `tools/registry.ts`         | real — pure catalog: register/look up/list, nothing else                                                                                                                                                                            |
| Tool Execution Engine                  | `tools/execution-engine.ts` | real — the only path allowed to run a tool handler; enforces the approval gate                                                                                                                                                      |
| Planner                                | `planner/`                  | real — pure decision logic, no I/O                                                                                                                                                                                                  |
| Model Provider                         | `provider/`                 | real — provider-agnostic `ModelProvider` interface + a runtime registry (`registry.ts`); one production adapter, `ClaudeProviderAdapter` (self-registers as `"claude"`, the default) — the only vendor StayWhile currently requires |
| Context Builder                        | `context/`                  | real (no providers registered by any domain yet)                                                                                                                                                                                    |
| Logging & Telemetry                    | `logging/`                  | real — structured logs + opt-in metrics, both swappable                                                                                                                                                                             |
| Evaluation                             | `evaluation/`               | real — runs against any `ModelProvider`                                                                                                                                                                                             |
| Human Escalation                       | `handoff/`                  | real — transitions a conversation to `ESCALATED`                                                                                                                                                                                    |
| Retry & Error Handling                 | `orchestrator/retry.ts`     | real — exponential backoff, provider-agnostic                                                                                                                                                                                       |
| Knowledge Retrieval (long-term memory) | `knowledge/`                | stub — `NotImplementedError`, needs a vector store                                                                                                                                                                                  |

## How a turn flows

`runOrchestratorTurn` (`orchestrator/orchestrator.ts`) is the only place that sequences these modules — read it top to bottom and it reads like a coordination script, not business logic:

1. **Context Builder** assembles background context (`assembleContext`).
2. **Prompt Management** renders the system prompt (`renderPrompt`).
3. **Conversation Management** persists the user's message (`appendMessage`).
4. **Memory Management** windows conversation history to a token budget (`windowConversationHistory`) before building the message list the model sees.
5. **Retry & Error Handling** wraps the call to the **Model Provider** (`withRetry` around `modelProvider.complete()` — exponential backoff on 429/5xx/network errors, never on `NotImplementedError` or other 4xx).
6. **Planner** interprets the completion (`planNextStep`) — respond, or execute tools.
7. If tools: the **Tool Execution Engine** runs each one (`executeTool`, which itself enforces the approval gate via the Action Approval Framework); the **Planner** then decides (`planAfterToolExecution`) whether to continue the loop or pause because something needs human approval.
8. Loops up to `maxToolIterations` (default 5). Exhausting it without a final answer calls **Planner.planEscalation()** and the turn returns `escalationRecommended: true` — the caller (the domain layer) is the one that actually invokes **Human Escalation**'s `escalateConversation`, same package/domain split as everywhere else in this platform.

```ts
const result = await runOrchestratorTurn({
  conversationId,
  userMessage: "Cancel the reservation for room 4",
  promptKey: "ops-assistant.system",
  toolNames: ["reservations.cancel"],
  toolContext: { userId: actor.userId },
});
// result: { assistantMessage, toolCalls, pendingApproval, escalationRecommended, stopReason }
```

## Provider subsystem

`provider/types.ts` defines `ModelProvider` (`complete`/`completeStream`) against generic `ModelMessage`/`ModelContentBlock`/`CompletionInput`/`CompletionResult` shapes — nothing in that file, or in the Orchestrator, Planner, or Tool Execution Engine, is vendor-specific. **Every vendor-specific implementation lives under `provider/`, with nothing else in the package depending on more than the `ModelProvider` interface** — this is a structural rule, not just a convention: grep for a vendor name anywhere outside `provider/` and the only hits are prose comments explaining the architecture, never an import or a class reference.

**Only one adapter is implemented: Claude.** That's deliberate, not incomplete — StayWhile doesn't currently need a second model vendor, and this package isn't the place to build one speculatively (a second real adapter adds a dependency, ongoing maintenance, and surface area for a vendor nothing uses, purely to demonstrate something a test double already demonstrates for free — see the coexistence tests below). The registry and generic interface exist so that _when_ a real second vendor is needed, adding it is additive and contained; they are not proof by themselves of anything working end-to-end for a vendor that doesn't exist in this codebase.

- `provider/registry.ts` — the runtime catalog (`registerModelProviderFactory`/`getModelProviderFactory`/`listModelProviderFactories`), mirroring the Tool Registry and Prompt Management registries elsewhere in this package.
- `provider/claude-provider.ts` — `ClaudeProviderAdapter`, self-registers as `"claude"` (the default), reads `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`/`ANTHROPIC_MAX_TOKENS`. The only file in the package that imports `@anthropic-ai/sdk`. Logs (`logger.error`) and rethrows on any API failure — errors are never swallowed.
- `provider/not-configured-provider.ts` — `NotConfiguredModelProvider`, the fallback when nothing is configured; not a vendor, so not in the registry.
- `provider/create-provider.ts` — `createModelProvider()`, the only consumer of the registry. Selects a factory by name (`AI_MODEL_PROVIDER` env var, default `"claude"`) and **never references a concrete adapter class**; falls back to `NotConfiguredModelProvider` when the selected factory is missing or reports itself unconfigured.

```ts
// claude-provider.ts, bottom of the file
registerModelProviderFactory({
  name: "claude",
  isConfigured: () => Boolean(process.env.ANTHROPIC_API_KEY),
  create: () =>
    new ClaudeProviderAdapter({
      apiKey: process.env.ANTHROPIC_API_KEY!,
      model: process.env.ANTHROPIC_MODEL,
      maxTokens: parseMaxTokens(process.env.ANTHROPIC_MAX_TOKENS),
    }),
});
```

**How a real future provider plugs in**, when one is actually needed: write `provider/<vendor>-provider.ts` implementing `ModelProvider` (map its request/response shape to/from `ModelContentBlock[]`, same as `claude-provider.ts`'s `toAnthropicContent`/`fromAnthropicContent`), call `registerModelProviderFactory({ name: "<vendor>", isConfigured, create })` at its bottom, add one `import "./<vendor>-provider";` line to `create-provider.ts` (for the registration side effect — the same line `import "./claude-provider";` already is). No other file in the package changes.

**This is verified today with a fake factory, not a second real vendor** — `create-provider.test.ts`'s "multiple registered providers coexist without special-casing any of them" suite registers two in-test fake factories (no SDK, no credential, no network) and confirms `createModelProvider()` dispatches to each purely by name, with Claude's own selection unaffected. That's the correct way to prove the registry mechanism generalizes without shipping a vendor integration the product doesn't use.

## Registering a tool

```ts
import { registerTool } from "@stayw/ai";
import { z } from "zod";

registerTool({
  name: "properties.list",
  description: "Lists active properties",
  inputSchema: z.object({}),
  requiresApproval: false,
  handler: async (_input, ctx) => listProperties(ctx),
});
```

Tools registered with `requiresApproval: true` never run their handler directly — the Tool Execution Engine's `executeTool()` proposes an `AiAction` instead and returns `{ status: "pending_approval", actionId }`. A human then calls `approveAction()`/`rejectAction()` from the Action Approval Framework. Tool `inputSchema`s (Zod) are converted to JSON Schema for the model via `zod-to-json-schema` — the same library `@stayw/mcp-servers` already uses for the same purpose.

## Action state machine

```
PENDING -> APPROVED -> EXECUTED
        -> REJECTED     -> EXECUTION_FAILED
```

`approveAction`/`rejectAction`/`markActionExecuted`/`markActionFailed` all guard on the action's current status and throw `InvalidActionStateError` on a mismatch — see `actions/approval.ts`. This package owns the state transitions and, via `tools/execution-engine.ts`'s `executeApprovedTool`, the one sanctioned way to actually run an approved action's tool. `apps/website/src/domains/ai/services/ai.service.ts`'s `approveAiAction` is what calls it: `approveAction` (PENDING -> APPROVED), then `executeApprovedTool(action.toolName, action.proposedInput, ctx)`, then `markActionExecuted`/`markActionFailed` depending on the outcome.

`executeApprovedTool` exists because `executeTool` can't be reused for this — calling `executeTool` again on a tool with `requiresApproval: true` would just propose a _second_ `AiAction` instead of running anything. It does the same registry lookup + Zod validation as `executeTool`, just skips straight to the handler, and it's the only place outside `executeTool` itself that's allowed to call `tool.handler` — a caller reaching into `getTool()` and invoking the handler directly would bypass that invariant. (`markActionExecuted`/`markActionFailed` existed in this package for a while with no caller anywhere in the app — approving an action didn't actually run anything. That's fixed now; see `apps/website/src/domains/ai/README.md` for the detail, and `orchestrator/orchestrator.e2e.test.ts` for a test that runs the real Planner, Tool Registry, Tool Execution Engine, and Action Approval Framework together through one full prompt -> tool selection -> approval -> execution chain, mocking only the database.)

`listPendingActions()` only ever returns `PENDING` rows — resolve one and it drops out with nothing else in this package showing what happened to it. `listRecentResolvedActions(limit = 20)` is the read side of that: `status IN (EXECUTED, EXECUTION_FAILED, REJECTED)`, newest-first. `apps/website/src/domains/ai`'s `RecentActionsList` is what actually surfaces it in the UI.

## Human Escalation

`escalateConversation({ conversationId, reason, details? })` transitions a conversation to `ESCALATED`. This module only owns that state transition + a log line — the domain layer (`apps/website/src/domains/ai`) is responsible for the permission check, the audit entry, and notifying ops staff. Escalation happens automatically when the Orchestrator's Planner hits `maxToolIterations`, or on demand via an explicit "escalate to human" action.

## Evaluation

`runEvalSuite(cases, modelProvider)` runs a set of `EvalCase`s (a `CompletionInput` + a grader) against any `ModelProvider` — including `NotConfiguredModelProvider` or a hand-rolled test double — and reports pass/fail/rate. The framework doesn't need a real model to be useful: write and wire eval cases now, run them against real output the moment a provider is configured, with zero changes here. Built-in graders: `containsText`, `usesTool`, `stopsWith` (see `evaluation/graders.ts`).

## Logging & Telemetry

`createLogger(component)` returns a leveled logger (`debug`/`info`/`warn`/`error`); `setLogSink`/`resetLogSink` swap where entries go. The default sink only writes `warn`/`error` to console — this repo's lint policy (`eslint-config/base.js`'s `no-console` rule) doesn't allow `console.log`/`console.info`, so `debug`/`info` entries are dropped by default rather than bypassing that rule.

`createTelemetry(component)` is the metrics counterpart — `count`/`duration` events, plus a `timed()` helper that wraps an async operation and always emits its duration (even on failure). Opt-in: a no-op until `setTelemetrySink` is called, since most environments don't want a metrics collector running by default. The Orchestrator emits `turn.started`/`turn.completed` (tagged with the outcome: responded/pending_approval/escalation_recommended) — wire a real sink at app boot to collect them.

## Not built yet, deliberately deferred

- **Knowledge Retrieval** (semantic/long-term memory across conversations) needs a vector store — a separate, credential-gated decision, distinct from the short-term windowing Memory Management already does.
- **No context providers are registered** by any domain yet, so `assembleContext()` returns `[]` and the `{{context}}` prompt placeholder renders empty. `apps/website/src/domains/ai`'s conversation UI works fully without this; richer context (property/reservation/task details per conversation) is a follow-up.
- **`completeStream()` itself still isn't consumed by the app** — it's real on `ClaudeProviderAdapter` (tested against a mocked Anthropic stream) but nothing outside this package's own tests calls it yet. `apps/website`'s ops-assistant UI now does have a streaming transport (`app/api/ai/messages/route.ts` + `ChatComposer.tsx`), but it streams the already-computed final answer from `runOrchestratorTurn` in chunks — a UI-layer choice, made deliberately instead of wiring `completeStream()` in, because of the next bullet.
- **Only text-delta streaming, not tool-call streaming — this is _why_ the app-level streaming above doesn't call `completeStream()` directly.** `completeStream()` yields `text_delta`/`message_stop` only; a real streamed turn could still ask for a tool (the request includes `tools`), and there'd be no way to see that in the stream. Wiring `completeStream()` into the Orchestrator's tool-use loop needs `StreamEvent` to carry `tool_use` blocks first (Anthropic's SDK supports it — `content_block_start`/`input_json_delta`/`content_block_stop` — this package just doesn't parse them yet). Add it once real token-level streaming-with-tools is the priority; until then, chunked delivery of the real final answer (see `apps/website/src/domains/ai/README.md`) gets most of the UX win without this provider-layer change.
- **A second model provider** — not planned, not started, and shouldn't be until StayWhile has a concrete reason to run a second vendor (cost, redundancy, a feature only available elsewhere). The registry exists to make that addition low-risk _when_ it's needed, not to speculatively pre-build it.

See `03 Documentation/adr/0007-ai-platform-layer.md` for the original design rationale.
