# ADR-0007: AI as a core platform capability (`@stayw/ai`)

## Status

Accepted — 2026-08-06

## Context

`@stayw/ai-automation` already exists, but it is n8n-triggering plumbing: deterministic, event-driven business-process automation (see ADR-0005). The platform separately needs a non-deterministic, conversational capability — a Claude tool-use loop that can answer guest questions, assist ops staff, and eventually propose actions (send a message, adjust a reservation) for a human to approve. Conflating the two under one package would blur a real architectural distinction: n8n workflows are pre-defined and human-authored; the AI Orchestrator decides its own steps at runtime.

## Decision

- **New, separate `packages/ai` (`@stayw/ai`)**, not an expansion of `@stayw/ai-automation`. n8n and the Orchestrator are peers: the Orchestrator can call `triggerWorkflow()` as a registered tool in a future phase, but that bridge is not wired yet.
- **Seven components**, per the platform's brief:
  | Component                               | Status                                                                                                                |
  | --------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
  | Context Engine (`context/`)             | real — provider registry, `assembleContext()` degrades gracefully if a provider throws                                |
  | Knowledge Retrieval (`knowledge/`)      | interface + `NotImplementedError` stub only — real vector-store-backed retrieval is deferred; premature to design now |
  | Prompt Library (`prompts/`)             | real — versioned, in-memory template registry with `{{var}}` substitution                                             |
  | Tool Registry (`tools/`)                | real — `registerTool`/`executeTool`; the approval gate (below) is enforced here, not by callers                       |
  | Orchestrator (`orchestrator/`)          | real plumbing (context → prompt → persist → call model → persist), stub Claude call                                   |
  | Conversation Context (`conversations/`) | real, against the existing `AiConversation`/`AiMessage` models                                                        |
  | Action Approval Framework (`actions/`)  | real, against a new `AiAction` model (below)                                                                          |
- **`@stayw/ai` depends only on `@stayw/database`** — never on `@stayw/integrations`. Wrapping an integration client as a tool handler is the app/domain layer's job (e.g. `apps/website/src/domains/properties/ai-tools.ts`), keeping this package provider-agnostic.
- **Action Approval Framework, new `AiAction` model** (additive-only migration, `packages/database/prisma/schema.prisma`): `id`, `conversationId?`, `toolName`, `proposedInput` (Json), `reasoning?`, `status` (`AiActionStatus`: PENDING/APPROVED/REJECTED/EXECUTED/EXECUTION_FAILED/EXPIRED), `riskLevel` (`AiActionRiskLevel`: LOW/STANDARD/HIGH), `relatedEntityType?`/`relatedEntityId?`, `reviewedByUserId?`/`reviewedAt?`/`rejectionReason?`, `executedAt?`/`executionResult?`/`executionError?`. Plus `ActorType.AI` and `NotificationType.AI_ACTION_PENDING`. A tool registered with `requiresApproval: true` never runs its handler directly: `executeTool()` calls `proposeAction()` instead and returns `{ status: "pending_approval", actionId }`. `approveAction`/`rejectAction`/`markActionExecuted`/`markActionFailed` all guard on the action's current status, throwing `InvalidActionStateError` on a mismatch — a real state machine: `PENDING → APPROVED|REJECTED → (if APPROVED) EXECUTED|EXECUTION_FAILED`.
- **New `packages/auth` resource**: `ai_actions` added to `RESOURCES`; `ops_manager` granted `ai_actions:read`/`ai_actions:update` (reviewing pending actions is an ops-management responsibility).
- **MCP wiring**: `packages/mcp-servers/src/shared/register-tools.ts` (`registerToolsOnServer(server, tools)`) maps `@stayw/ai` `ToolDefinition`s onto the MCP SDK's `ListTools`/`CallTool` handlers, converting Zod schemas via `zod-to-json-schema`. `CallTool` always routes through `executeTool()`, so the approval gate is enforced at this layer too, not bypassed by the MCP transport.
- **Proof-of-concept**: `apps/website/src/domains/properties/ai-tools.ts` registers `properties.list` (`requiresApproval: false`) wrapping the already-tested `listProperties` service — validates the registry against real domain code end-to-end.

## Consequences

- Real Claude wiring is intentionally deferred: `orchestrator/claude-client.ts`'s `NotImplementedClaudeClient` throws `NotImplementedError` until a later phase — the rest of `runOrchestratorTurn()` (context, prompt, persistence) is real and tested today, so that phase only has to fill in one function.
- Every tool call, whether invoked in-process or via MCP, passes through the same `executeTool()` gate — there is exactly one place that decides whether an action needs human sign-off, not one per call site.
- Knowledge Retrieval staying a stub means the Context Engine currently only assembles whatever providers are registered elsewhere (e.g. a future `property-details` provider) — no property manuals/house-rules recall until that phase.
- `AiAction`'s migration is additive-only (new table, new enum values) — verified via the generated SQL before applying; no existing data touched.
