# StayWhile Operations Platform

## Session Handoff & Continuity Log

> Update this file at the end of every development session. Read it before starting the next one. It is the project's working memory across conversations.

---

# ⚠️ Workspace Isolation — Read First

**This workspace belongs exclusively to StayWhile.** Per `CLAUDE.md`: never reference, import, reuse, or expose information from another client workspace, and never reuse StayWhile-specific code, data, or documentation in another client's project. If a future session (or the audit methodology developed here) is reused elsewhere, only the _process/template_ travels — never this workspace's actual data, credentials, architecture specifics, or file contents. No other client's workspace should ever be read from or written to during a StayWhile session, and vice versa.

---

# Project Status

## Current Phase

Phase 1 (Architecture & Foundation) is functionally complete. The same-phase **architectural refinement** (Domain-Driven Design reorganization + AI platform layer + Integration SDK) is now **✅ fully complete** as of the 2026-08-06 session — see "AI Platform Layer & Refinement Completion" below. The **technology/integration audit** remains explicitly deprioritized (not cancelled) per the user's earlier instruction. **n8n MCP connection** is connected, verified working, and the instance has been inspected (empty, safe to build on).

**Status:** The paused refinement work is done, verified (`lint typecheck test build` all green), and fully committed to git (local `main`, not pushed) — five commits total from the 2026-08-06 session covering tooling/config, original app code, original docs, the refinement completion code, and the refinement completion docs. Nothing is uncommitted as of end of session. Ready to move to the next priority: credential setup, n8n workflow building, or OwnerRez integration, per user direction.

### Update — 2026-08-06, later same-day session

The above remains accurate as a historical record of that session's end state. Since then, in a **new session**:

- **Increment 1** of `IMPLEMENTATION_PLAN.md` (core ops domains: Properties → Guests → Reservations → Tasks → Cleaning → Maintenance → Notifications → Communications → Dashboard) is now the active phase, superseding "next priority: credential setup, n8n workflow building, or OwnerRez integration" above — the user redirected to this instead. Properties, Guests, Reservations were already done; **Tasks domain shipped this session** (see "Increment 1 Progress" below).
- **n8n MCP connection is no longer live** as of this session — see the dated update under "n8n MCP Connection" below. The "connected, verified working" status above was accurate for the 2026-08-06 morning session; it no longer holds and must be re-checked every session, not assumed from this doc.
- New, previously-undocumented MCP connections (`Slack`, `Asana`, `IFTTT`) were observed this session — see "MCP Connections — 2026-08-06 later session" below.

### Update — 2026-08-07 session

A full new session. User set a mandatory **Continuous Build Mode**: keep implementing without stopping for permission as long as unblocked work exists; credential absence only blocks the literal API-call boundary, not the surrounding UI/service/schema/db/test layers; only stop for a credential that can't be mocked, a login, spending money, a destructive production action, or a genuine safety/design blocker. Also established durable infra-isolation, reuse-before-create, and connection-verification-order policies (all saved to this assistant's cross-session memory, not just this doc).

**Increment 1 — now fully complete** (all 9 domains: Properties, Guests, Reservations, Tasks, Cleaning, Maintenance, Notifications, Communications, Dashboard).

**Increment 1.5 — all 7 previously-deferred extensions shipped**: task reassignment, cleaning cancel/missed, maintenance task-linking/assignment, communications thread close/archive, guest update/soft-delete, reservation status updates, property status update/soft-delete.

**Increment 2 — 5 real, credential-gated adapters built** (actual SDK/API calls behind each provider's interface, safely no-op without a credential, not stubs): `AnthropicClaudeClient` (`@anthropic-ai/sdk`), `OwnerrezClient` (v2 REST, Basic Auth), `SlackClient` (Web API + real `v0=` webhook signature verification), `NotionClient`, `AsanaClient`. 7 more integrations were deliberately left as documented stubs, each with its own specific reason in its package README (not silently skipped) — Gmail/Ecobee need an OAuth token-storage design; Nest requires a mandatory $5 Google registration fee; Google Voice has no public API at all (flagged as a likely scope error in the original plan, worth a decision from the user); Yale/August/Cielo are physical lock/HVAC control where this session's confidence in the current exact API contract was too low to risk fabricating device-control code.

**Increment 3 — Dashboard finish + 3 new domains**: AI domain (`/ai` — ops-assistant conversation UI + AI-action approval queue, built fully end-to-end even without `ANTHROPIC_API_KEY`: a real `SYSTEM`-role message persists explaining the gap instead of a 500), Integrations domain (`/integrations` — connection-status catalog for all 12 providers, idempotently seeds `IntegrationConnection` rows since none existed before, deliberately no "test connection" button since that would mean an unauthenticated live network call), Audit domain (`/audit` — audit log + `WorkflowExecution`/"automations" history, since no domain in the original 13-domain DDD inventory owns that model).

**Increment 4 — `@stayw/ai` platform completion**: user directed finishing the entire AI platform package as production-ready infrastructure (not placeholders) while still crediential-blocked. Shipped: structured logging (`logging/`, console default limited to `warn`/`error` per this repo's lint policy), retries with exponential backoff (`orchestrator/retry.ts`, deliberately excludes `NotImplementedError` — see the bug note below), real streaming (`completeStream()` on `AnthropicClaudeClient`, not yet wired into the Next.js UI), short-term memory/conversation windowing (`memory/window.ts`), a real multi-step agentic tool-use loop replacing the old single-completion `runOrchestratorTurn` (executes tools via the Tool Registry including its approval gate, loops to a safety cap, stops early on pending-approval or the cap), an evaluation framework (`evaluation/` — runs against any `ClaudeClient` including test doubles), and human handoff (`handoff/escalate.ts`, wired into the AI domain both automatically on hitting the loop's iteration cap and manually via a new "Escalate to human" button). `ClaudeClient.complete()`'s return type changed from a bare string to structured content blocks + stop reason (a deliberate breaking change, safe since only this session's own code depended on the old shape). `sendAiMessage` now actually passes tools into the loop, which is what finally makes `registerPropertiesAiTools()` get called for real (previously defined but never invoked from anywhere).

**Real bug found by the test suite's timing, not by inspection**: the first retry-wrapped version of the Claude call retried `NotImplementedError` (missing API key) three times with backoff — ~750ms wasted per call for an error that could never resolve itself. Fixed by excluding it from the retry predicate.

**Verification**: full monorepo `lint typecheck test build` forced fresh (`turbo run ... --force`, no cache) after every single feature landed across this entire session, not just at the end — always 0 errors. Final count: **211 tests** across the monorepo (`website` 99, `@stayw/ai` 67, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 5 — `@stayw/ai` modularization (supersedes the class names in Increment 4's paragraph above)**: user pushed back on the Orchestrator containing business logic and on the Claude-branded interface — a real gap, not just a preference. `orchestrator/run-turn.ts` became `orchestrator/orchestrator.ts`, now a genuinely thin coordinator: it sequences Context Builder → Prompt Management → Conversation Management → Memory Management → a retry-wrapped Model Provider call → **Planner** → Tool Execution Engine (if needed) → Planner again → loop or return, with every decision point delegated to a named module instead of living as inline conditionals. New `planner/` module (`planNextStep`/`planAfterToolExecution`/`planEscalation`) — pure decision logic, no I/O. `tools/registry.ts` (pure catalog) split from a new `tools/execution-engine.ts` (runs a tool + enforces the approval gate) — the registry alone can no longer be mistaken for something that can execute. All Claude-branded types moved to a new `provider/` module and renamed to be provider-agnostic: `ClaudeClient` → `ModelProvider`, `ClaudeMessage`/`ClaudeContentBlock`/`ClaudeCompletionInput`/`ClaudeCompletionResult`/`ClaudeStopReason`/`ClaudeStreamEvent` → `ModelMessage`/`ModelContentBlock`/`CompletionInput`/`CompletionResult`/`StopReason`/`StreamEvent`, `AnthropicClaudeClient` → `ClaudeProviderAdapter`, `NotImplementedClaudeClient` → `NotConfiguredModelProvider`, `createClaudeClient` → `createModelProvider`. `provider/claude-provider.ts` is now the **only** file in the package that knows Anthropic's actual request/response shape — a second vendor means one new adapter file, not a platform rewrite. New telemetry module (`logging/telemetry.ts` — opt-in counters/durations, `createTelemetry`/`timed()`) fills out "Logging & Telemetry" as one explicit responsibility. `apps/website` needed **zero** changes — confirmed by grepping for `Claude` across it before starting; it only ever consumed function-level exports, never the renamed types. Same test scenarios still pass, now split between `orchestrator/orchestrator.test.ts` (end-to-end coordination) and `planner/planner.test.ts` (decision logic in isolation) — this was a structural refactor, not a behavior change. Full monorepo verification forced fresh again — 25/25 tasks, 0 errors, **229 tests** total (`website` 99, `@stayw/ai` 85, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 6 — `@stayw/ai` provider architecture completion**: user asked to finish the provider architecture before any further features — "a reusable AI runtime, not a Claude wrapper," with every vendor-specific implementation confined to `provider/` and everything else depending only on `ModelProvider`. Audited first (grepped the whole package for `claude`/`anthropic`/`@anthropic-ai/sdk`) rather than assuming more work was needed: Increment 5's rename had already confined all real vendor code correctly — the only leaks were prose comments (now scrubbed) and one test's sample model-name string. The actual gap was that `createModelProvider()` was a hardcoded two-branch function, not a real selection mechanism. Fixed with `provider/registry.ts` (`registerModelProviderFactory`/`getModelProviderFactory`/`listModelProviderFactories`), mirroring the Tool Registry/Prompt Management registry pattern already used elsewhere in this same package. `claude-provider.ts` now self-registers (`{ name: "claude", isConfigured, create }`) and is the only file reading `ANTHROPIC_API_KEY`/`ANTHROPIC_MODEL`; `create-provider.ts` no longer imports `ClaudeProviderAdapter` at all — it selects purely by name via `AI_MODEL_PROVIDER` (new env var, defaults to `"claude"`, added to `.env.example`). Verified with a test that registers a fake `"test-vendor"` factory and confirms selection works without any Claude-specific code path. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **235 tests** total (`website` 99, `@stayw/ai` 91, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 7 — `@stayw/ai` provider subsystem finished, then a deliberate stop to architecture work**: user asked for the provider subsystem to be completed as a whole unit (interfaces, registry, factory, adapters, tests, exports, docs) and then explicitly to stop refactoring `@stayw/ai` and resume feature work unless a real limitation turns up. The gap: Increment 6's registry had exactly one adapter (Claude) registered through it, which doesn't actually prove `ModelProvider` generalizes — it could still have been Claude-shaped underneath a generic name and nobody would know. Added a second real adapter, `provider/openai-provider.ts`'s `OpenAiProviderAdapter` (official `openai` SDK), specifically because OpenAI's tool-calling shape is structurally different from Anthropic's (separate `tool_calls` array + separate `role:"tool"` messages, vs. Anthropic's mixed content blocks in one message) — getting both to map cleanly onto `ModelContentBlock[]` is the actual proof, not just another renamed adapter. Checked first that no OpenAI credential exists anywhere in the repo (reuse-before-create policy) before adding the dependency — writing the adapter needs no account, just won't run without `OPENAI_API_KEY`. `create-provider.ts` gained one `import "./openai-provider";` line and otherwise didn't change — still zero vendor class references in the selection logic. `index.ts` now exports the registry functions and `ModelProviderFactory` type too (previously registry-internal). 14 new tests (11 adapter + 3 multi-provider-coexistence). Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **249 tests** total (`website` 99, `@stayw/ai` 105, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**This closes the `@stayw/ai` architecture phase per explicit user instruction.** The provider subsystem is now production-ready: `ModelProvider` interface, `provider/registry.ts`, `createModelProvider()` factory, two real adapters (Claude + OpenAI) plus the `NotConfiguredModelProvider` fallback, 34 provider-level tests, full exports, and `packages/ai/README.md` documents all of it under a "Provider subsystem" section. Next `@stayw/ai` session should default to feature work (Context Engine providers, streaming wired into the Next.js UI, Knowledge Retrieval's vector store, a third provider only if a concrete need shows up) — not more restructuring.

**Increment 8 — correction: Increment 7 overstepped, OpenAI adapter removed, Claude finished instead**: user corrected directly — "Do not implement additional model providers solely to prove the abstraction... only implement providers that are currently required by the StayWhile platform... Favor shipping the StayWhile platform over demonstrating architectural extensibility." Building a real `OpenAiProviderAdapter` to validate the registry pattern was the wrong move regardless of how well-executed it was; StayWhile doesn't use OpenAI. Deleted `provider/openai-provider.ts` + its test, removed the `openai` SDK dependency, reverted `create-provider.ts`/`index.ts`/`.env.example` to Claude-only. Replaced the "two real vendors coexist" test suite with an equivalent that registers **fake** in-test factories instead of asserting against a real second vendor — proves the same registry dispatch mechanism without shipping unused vendor code, which is the actually-correct way to demonstrate extensibility (also true of Increment 6's original fake-`"test-vendor"` tests, which already proved this before Increment 7 added a real second vendor at all). Saved a standing memory (`feedback_no_speculative_provider_implementations`) so this class of overstep doesn't recur — distinct from the adjacent, still-valid principle that _currently-required_ credential-gated integrations (OwnerRez, Slack, etc. from earlier increments) should still get real adapters built ahead of the credential.

Used the correction as the occasion to actually finish the Claude adapter rather than just reverting: `maxTokens` is now configurable (constructor option + `ANTHROPIC_MAX_TOKENS` env var, default raised from 1024 to a more realistic 4096 for ops-assistant replies), and both `complete()`/`completeStream()` now log (`logger.error`) and rethrow on API failure instead of failing with zero observability. 4 new tests for that. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **242 tests** total (`website` 99, `@stayw/ai` 98, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 9 — AI runtime feature work: real tools for guests, reservations, tasks, cleaning**: user declared the provider layer "stable" (Claude provider, registry, factory, tests, docs all complete — 5 explicit criteria) and directed a stop to further `provider/` work absent a real new requirement, with an instruction to resume higher-level AI runtime feature work immediately. Re-verified rather than assuming: reran `packages/ai`'s provider test suite fresh (24/24 passing) and `tsc --noEmit` (clean) before treating the layer as frozen; updated the standing `feedback_no_speculative_provider_implementations` memory to record this as a durable instruction. Picked the next slice from `@stayw/ai/README.md`'s own "not built yet" list rather than inventing new scope: the ops-assistant conversation could only ever call one tool, `properties.list` — `CONVERSATION_TOOL_NAMES` in `apps/website/src/domains/ai/services/ai.service.ts` had exactly one entry. Extended the same proven pattern (`domains/properties/ai-tools.ts`) to the other four Increment-1 domains: new `domains/guests/ai-tools.ts` (`guests.list`), `domains/reservations/ai-tools.ts` (`reservations.list`), `domains/tasks/ai-tools.ts` (`tasks.list`), `domains/cleaning/ai-tools.ts` (`cleaning.list`) — each a thin, read-only (`requiresApproval: false`) wrapper around that domain's existing `list*(actor)` service call, identical shape to the Properties original, plus a matching `ai-tools.test.ts` for each (8 new tests). `ai.service.ts` now registers all 5 domains' tools at module load and passes all 5 names into the orchestrator loop; `ai.service.test.ts` gained mocks for the 4 new domain boundaries. `domains/ai/README.md` updated to describe all 5 tools and the "how to add a sixth" recipe. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **250 tests** total (`website` 107, `@stayw/ai` 98, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 10 — AI Assistant fully wired into the application**: user set a hard split — product features only from here, no more AI architecture, with a concrete priority list: finish tool registration for every domain, expose real business operations, then wire the AI Assistant page (orchestrator connection, tool calls, persistence, tool execution history, streaming, approval flow) before touching OwnerRez or n8n. Shipped:

- **17 tools across 9 domains** (was 5 tools/5 domains): every domain from Increment 1 now has a `domains/<domain>/ai-tools.ts`. Read tools (`requiresApproval: false`) for everything; write tools (`requiresApproval: true`) for the 7 domains where a real single-argument mutation exists (`properties.updateStatus`, `guests.update`, `reservations.updateStatus`, `tasks.complete`, `cleaning.complete`, `communications.sendMessage`, `maintenance.resolve`). Integrations and audit deliberately stayed read-only — connecting/disconnecting an integration is an infra action, and the audit log is append-only.
- **Closed a real, previously-undetected gap**: approving an `AiAction` only ever flipped its status to `APPROVED` — `markActionExecuted`/`markActionFailed` had existed in `@stayw/ai` since Increment 4/5 with **zero callers anywhere in the app**. `approveAiAction` now actually looks the tool up (`getTool`) and runs its handler with the approving human's identity, transitioning to `EXECUTED`/`EXECUTION_FAILED` and auditing either outcome. Without this, the approval queue this session just gave the assistant 7 new write tools for would have been decorative.
- **Tool execution history now persists and renders**: `AiMessage.toolCalls` (a `Json?` schema column) existed but the orchestrator never wrote to it. One additive change to `orchestrator.ts` (both `appendMessage` calls for the assistant's reply now attach `{ calls: allToolCalls }`) plus a `ConversationView` rendering pass — no orchestrator control-flow change.
- **Streaming, scoped honestly**: new `app/api/ai/messages/route.ts` + `ChatComposer.tsx` client component stream the real, already-computed final answer in chunks. This is explicitly _not_ token-level generation from Claude — that needs `StreamEvent` to carry `tool_use` blocks, which it doesn't yet, and extending it is a provider-layer change this session isn't making (provider layer stays frozen per the prior increment's standing instruction). Documented clearly in both `packages/ai/README.md` and the domain README so this isn't mistaken for real model streaming later.
- 33 new/changed tests (2 in `@stayw/ai`, 31 in `website`).

Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **276 tests** total (`website` 132, `@stayw/ai` 99, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4). `next build` succeeded including the new API route (static generation of all 19 routes). Interactive browser check of `/ai` wasn't possible — `next dev` 404s on every dashboard route right now, including untouched ones (`/properties`, `/`) — confirmed pre-existing (Clerk placeholder keys in this dev environment), not a regression from this session's work.

**Increment 11 — closed a real gap in approval execution, added a genuine end-to-end test**: user asked to complete the AI Assistant vertical slice in order (register tools → persist tool calls → complete approval workflow → **execute approved tools through the orchestrator** → stream → verify end-to-end), explicitly deprioritizing "just register more tools." Auditing item 4 against Increment 10 found `approveAiAction` was calling `getTool()` + `tool.handler()` directly — bypassing the Tool Execution Engine's own stated invariant that it's "the only path allowed to actually run a tool handler." Fixed with one small, justified addition: `executeApprovedTool()` in `tools/execution-engine.ts` (same registry lookup + Zod validation as `executeTool`, skips straight to the handler — `executeTool` itself can't be reused post-approval, it would just propose a second `AiAction`). `approveAiAction` now calls this instead. Added the genuine end-to-end test the user asked for: `packages/ai/src/orchestrator/orchestrator.e2e.test.ts` runs the real Orchestrator, Planner, Tool Registry, Tool Execution Engine, and Action Approval Framework together (only `@stayw/database` mocked) through one full prompt → tool selection → pending-approval → approve → execute → persisted-history chain, plus the no-approval-needed path in the same file. 5 more tests beyond that (`executeApprovedTool` coverage, updated `approveAiAction` mocks). Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **281 tests** total (`website` 132, `@stayw/ai` 104, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

Earlier in this session, user also asked to verify no cross-client contamination had occurred (unfamiliar project name "Vuvuzela" mentioned) — verified for real (grepped the whole tree, zero hits; confirmed `package.json` name and every `@stayw/*` workspace package) and confirmed clean: everything in this repo is StayWhile's own work.

**Increment 12 — closed the response loop, resolved-actions view, streamed tool events**: user's next priority list after green tests — persist tool calls/results, stream intermediate tool events, complete the approval UX, verify the full prompt → approval → execution → response cycle, and explicitly hold off on more tools until this works end to end. The real gap this surfaced: execution (Increment 11) worked, but nothing ever reported the outcome back into the conversation an action came from — approving something in the queue gave no visible confirmation in the thread itself, only an audit-log row nobody would normally look at. Fixed:

- `approveAiAction`/`rejectAiAction` now `appendMessage` a `SYSTEM` note into the action's conversation on every outcome — executed (with the real result, same `{ calls: [...] }` shape the Orchestrator writes, so it renders through the existing tool-call UI for free), execution failed (with the real error), or rejected (with the reason). Skipped when `AiAction.conversationId` is null rather than guessed.
- New `listRecentResolvedActions` (`@stayw/ai`) / `listRecentAiActions` (domain) / `RecentActionsList` (UI) — `PendingActionsList` only ever shows `PENDING` rows, so a resolved action previously just vanished with zero confirmation anywhere on the page. Now the last 20 resolved actions show their real outcome.
- `sendAiMessage` now returns `toolCalls` (always computed, just wasn't returned), and `app/api/ai/messages/route.ts` streams one `tool_call` SSE event per call _before_ the text chunks; `ChatComposer` renders each as it arrives. Same honesty standard as the Increment 10 text streaming: real, already-computed events sequenced for delivery, not live generation — documented in the route's comment, still blocked on `StreamEvent` not carrying `tool_use` blocks for anything closer to true interleaved streaming (a provider-layer change deliberately not made).
- Website-level "full cycle" test chaining `sendAiMessage` → `approveAiAction` in one test, alongside the package-level `orchestrator.e2e.test.ts` from Increment 11 — both ends of the stack now have an explicit end-to-end proof, not just per-function unit tests.

Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **287 tests** total (`website` 136, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Increment 13 — client-readiness verification surfaced a real bug, not just missing credentials**: user asked for a Client Readiness Verification with evidence. Investigated directly rather than assuming: decoded `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` (base64 → `placeholder.clerk.accounts.dev$`, not a real Clerk domain), confirmed `CLERK_SECRET_KEY` contains the literal string `placeholder_not_real_do_not_use`, and queried the local dev database directly with `psql` for real row counts. That surfaced a genuine bug: `packages/database/prisma/seed.ts` creates the bootstrap admin `User` row with a placeholder `clerkUserId` (`seed_pending_clerk_link`); `User.email` is `@unique`; and `getCurrentUser()`'s JIT-provisioning path only ever checked for an existing row by `clerkUserId`, never by `email` — so the moment real Clerk keys are configured, the _first_ real sign-in for `admin@stayawhilewithus.com` would crash on a unique-constraint violation instead of linking to the seeded admin role. Fixed by having JIT-provisioning check for an existing row by email first and _claim_ it (update its `clerkUserId`) rather than blindly creating a second row — the seeded row's `UserRole` assignments carry over automatically since it's the same row (5 new tests, `get-current-user.test.ts`, previously untested). Also added demo business data to the seed (`seedDemoData()` — 2 properties, 2 guests, 2 reservations, 2 cleaning schedules with their backing tasks, 1 maintenance request, all clearly fictional) so list pages aren't empty for a walkthrough — actually run against the local dev DB twice to confirm idempotency (stable row counts, no duplicates), not just typechecked. Added an `ANTHROPIC_API_KEY=""` scaffold to `.env.local` after confirming (via this repo's own `N8N_DISCOVERY.md`) that the credential already exists in StayWhile's n8n workspace — no new credential created; n8n MCP isn't connected this session, so the value has to come from the user directly rather than being pulled programmatically. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **292 tests** total (`website` 141, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Client Readiness Verification (answered in full in this session's chat log)** — short version: a real client cannot log in today (Clerk keys are placeholders, confirmed by direct inspection), no staging/production URL exists (local dev only, `http://localhost:3000`), and there was a real bug in the seed-to-real-login path that's now fixed. Shortest remaining path to a demo: real Clerk keys (external, StayWhile's own account) — once those land, the identity-linking fix and demo data in this increment mean sign-in should work correctly on the first try instead of crashing.

**Increment 14 — demo readiness**: user changed the goal from "more features" to "hand a client a URL and credentials, they experience a real product." Priorities in order: auth, demo data, a lively dashboard, the AI workflow only (no new tools), then a walkthrough report.

- **Auth**: real login is still blocked on a Clerk credential decision only the user can make — no existing StayWhile Clerk instance is documented anywhere in this repo (unlike the Anthropic n8n credential, which was), so this needs a reuse-vs-create decision per the Integration Rule, not something to guess at. Everything checkable without it was re-verified green (the Increment 13 seed-linking fix, RBAC's own test suite).
- **Demo data**: `packages/database/prisma/seed.ts` now seeds 2 properties, 2 guests, 3 reservations (one arriving today, one departing today, one upcoming), 2 cleaning schedules, 1 maintenance request, 1 task due today, 3 notifications, 1 message thread, 1 AI conversation. **Flagged, not built**: "Units/Rooms" has no model in the schema at all — `Property` is the rentable unit; raised for a decision instead of inventing a new domain concept.
- **Real bug found and fixed**: seed dates were landing on the _previous_ calendar day in Postgres — this environment's local timezone (UTC+8) is ahead of UTC, and Prisma serializes `@db.Date` columns via the Date object's UTC representation, so local midnight truncated to the wrong day. Caught by querying seeded rows directly with `psql` against `current_date`, not by inspection. Fixed in both the seed script and `dashboard.service.ts` by constructing dates from UTC Y/M/D components consistently. Also cleaned up 2 duplicate rows this session's own earlier seed iteration had orphaned (a title-format change) — direct deletion of this session's own test artifacts, not real data.
- **Dashboard**: now shows occupancy %, arrivals today, departures today, cleaning today, tasks due today, open maintenance, named arrival/departure lists, and recent AI activity (last 5 conversations) — not just static totals. 1 new test.
- **AI Assistant**: unchanged, already complete, re-verified green, no new tools per instruction.

Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **293 tests** total (`website` 142, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4). Seed re-run against the real local dev database (not just typechecked) after every change to confirm idempotency.

**Increment 15 — closed a second duplicate-user path before Clerk goes live**: user confirmed a StayWhile Clerk application already exists (do not create another) and asked for the exact env vars needed. Before answering, audited the rest of the Clerk integration rather than answering from `.env.example` alone — found the identical bug class Increment 13 fixed in `getCurrentUser()`, in a second, independent place: the Clerk webhook sync handler (`apps/website/src/platform/identity/sync-clerk-user.ts`) upserted on `clerkUserId` only, so a real webhook event for an email that already has a row (the seeded placeholder admin) would throw on `User.email`'s unique constraint instead of linking to it — and webhooks can arrive before a user's first page load, so this wasn't just a duplicate of the earlier fix, it was a second live risk. Fixed with the same claim-by-email pattern, 7 new tests (`sync-clerk-user.test.ts`, previously untested). Full monorepo verification forced fresh — 25/25 tasks, 0 errors, **300 tests** total (`website` 149, `@stayw/ai` 106, `@stayw/integrations` 36, `@stayw/auth` 5, `@stayw/mcp-servers` 4).

**Required Clerk env vars** (from `apps/website/env.ts`'s Zod schema — the authoritative source, not `.env.example` alone) — answered in full in chat; short version: `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` + `CLERK_SECRET_KEY` from the existing StayWhile Clerk app's API Keys page (required, real values), `CLERK_WEBHOOK_SIGNING_SECRET` (required by the schema to be non-empty, but doesn't need to be a _real_ webhook secret for a pure local demo — nothing will call `http://localhost:3000/api/webhooks/clerk` from the internet without a tunnel; the JIT-provisioning fallback in `getCurrentUser()` handles login either way), `NEXT_PUBLIC_CLERK_SIGN_IN_URL`/`NEXT_PUBLIC_CLERK_SIGN_UP_URL` already correctly set to `/sign-in`/`/sign-up` in `.env.local`, no change needed.

**Increment 16 — closed the last empty screen, diagnosed the dev-mode 404 precisely**: user confirmed the Clerk fix was done and set a hard stop on further auth work unless testing finds a real bug — full focus on demo readiness. `.env.local` still has placeholder Clerk keys as of this pass (checked directly, not assumed), so login/admin-linkage/page-load verification stays blocked on the user pasting real values in. Everything else: found `audit_logs` was genuinely empty (the seed script bypasses the service layer `recordAudit()` normally writes through) and backfilled 5 entries in the same shape real actions would produce, idempotent; confirmed `integration_connections` only _looked_ empty — it self-seeds the full 12-provider catalog on every page read, verified by reading that code rather than "fixing" a non-issue. Also pinned down exactly why dev mode 404s right now: response headers show `x-clerk-auth-reason: protect-rewrite, dev-browser-missing` — Clerk's normal dev-browser bootstrap redirect, failing because the placeholder key points at a domain that doesn't exist. Confirmed mechanism, not assumption — strong evidence this resolves the moment real keys are in place. Full monorepo verification forced fresh — 25/25 tasks, 0 errors, 300 tests (unchanged — pure seed-script + diagnosis work, no new website code paths this pass).

**Demo Readiness Report** — see this session's chat log for the full report in the user's requested format (login status / URLs / credentials / working modules / blockers). Short version: every seedable table has real demo data now; the only remaining blocker to a full walkthrough is the user pasting real Clerk keys into `apps/website/.env.local` — once that happens, login/admin-linkage/every-page-load should be verifiable immediately (code-side fixes are already in place and tested).

**Increment 17 — full dashboard verification, first commit of the session**: user shifted to "Demo Readiness Mode" — commit the seed work, stop expanding demo data, run a complete per-route check, report status. Committed `packages/database/prisma/seed.ts` (`c594282`) — the first commit landed this entire session. Verified every dashboard module by calling its real service functions (including two real writes) against the real local dev database as the real seeded admin, via a throwaway script deleted immediately after use — the strongest check possible without real Clerk keys, since a literal browser walkthrough still isn't available. All 14 read paths and both write paths succeeded. Also confirmed nav-to-route parity (12 links, 12 pages, exact match) and found **no "Settings" module exists anywhere** — flagged, not built, since it was never part of this app's original domain set. Full checklist and Client Demo Readiness Report delivered in chat.

**Git status**: one commit landed this session (`c594282`, the seed script). Everything else — 17 increments of domain/AI/dashboard/auth work — is still uncommitted. Recommend a small number of logically-grouped commits next (e.g. one for the AI platform work, one for dashboard/demo-readiness, one for the auth fixes), not one giant commit.

**MCP connections**: not re-checked this session (no MCP-dependent work was attempted or needed — every credential-gated integration stayed at the code-adapter stage, never actually connecting to a live external service). Re-verify `claude mcp list` fresh next session per the standing rule, same as always.

**Increment 18 — real Clerk keys landed; first live sign-in crashed every module page, root-caused and fixed**: user reported real Clerk keys are now in `.env.local`, sign-in works, and `/` (dashboard) loads, but every module (`/properties`, `/guests`, etc.) errors. No browser tool was available this session (declined), and curl cannot complete Clerk dev-instance's JS-based `__clerk_db_jwt` handshake, so live HTTP reproduction wasn't possible — root-caused instead via direct DB inspection + code trace, then verified via the DB and full monorepo build/test.

- **Root cause**: `users` table had two rows — the seeded bootstrap admin (`admin@stayawhilewithus.com`, real global `admin` `UserRole`) and a brand-new row JIT-provisioned by `getCurrentUser()` for the real Clerk sign-in, `ryskris0@gmail.com` (different email than the seed expects, so the Increment 13/15 claim-by-email logic correctly didn't match it to the seeded row — this was a genuinely new user, not a bug in that logic). The new row had **zero `UserRole` assignments**, so `assertPermission()` (first line of every domain service's read/write functions) threw `ForbiddenError` for every module. The dashboard page alone was unaffected because `dashboard.service.ts`'s `safeList()` helper explicitly catches `ForbiddenError` and degrades to `[]` per-domain (a deliberate "best-effort summary" design, not a bug) — every other page calls its service directly with no such catch, so the error propagated uncaught into Next's default error overlay.
- **Fix 1 (data)**: granted the real signed-in user (`ryskris0@gmail.com`, id `a42d34fb-e84f-431d-a1c8-7efa63d5337f`) the same global `admin` `UserRole` the seeded admin has. Verified by re-deriving effective permissions directly via SQL join (`user_roles`→`role_permissions`→`permissions`): 79 rows for both users now, exact parity.
- **Fix 2 (code, hardening)**: added `apps/website/app/(dashboard)/error.tsx` — previously no error boundary existed anywhere under the dashboard route group, so any uncaught error (this one, or any future one) rendered Next's raw dev/prod error page instead of an explanation. Now shows a plain "Access denied — ask an administrator to grant you access" message. This does not replace Fix 1; it just stops the _next_ new real sign-in from crashing the same way.
- **Flagged, not built**: there is still no UI or admin flow for granting a role to a new real sign-in — every future first-time real user will hit `ForbiddenError` on every module (now shown gracefully instead of crashing) until someone manually runs the same SQL this session did. This is the same gap Increment 17 already flagged as "no Settings module exists"; this session is direct proof it's a live-blocking gap, not just a hypothetical one.
- **Verification**: full monorepo `lint typecheck test build` forced fresh — 25/25 tasks, 0 errors, production build includes all 12 dashboard routes in the manifest. Confirmed all 11 module `page.tsx` files use the exact same `getCurrentUser()` → service-call pattern (uniform code path, so this one fix applies identically everywhere) — full list checked directly, not sampled. **Could not perform a literal browser click-through** (no browser tool this session); recommend the user do one manual pass to visually confirm, though the evidence (uniform code path + DB permission parity + green build) is as strong as this session's tooling allows.

**Increment 19 — 2026-08-12: client dashboard requirements delivered, real August + Cielo integrations built and Cielo proven live**: user ran a client meeting and returned with an exact, specific dashboard spec, then separately asked for August and Cielo to become real (not stub) integrations. Both are now substantially done. Full detail below; short version: **the dashboard now matches every requirement from the meeting, Cielo is proven live end-to-end except for one external blocker (no real Property records to map devices to), and August is code-complete but pending a human 2FA step only the client can do.**

### The exact client dashboard requirements (from the meeting)

The client's four homepage requirements, verbatim in spirit:

1. **August locks** — separate summary (not folded into a generic "device health" number), online/offline count, low-battery indication, and an "offline + low battery" combined state must be visually distinguishable from "offline" alone or "low battery" alone. Demo/seed data must never be presented as live.
2. **Thermostats** — separate summary from locks, offline status clearly shown, same demo-vs-live honesty rule.
3. **Check-ins / check-outs** — today's arrivals/departures, **plus what's happening on upcoming days** (not just today). Dates must never shift by a day due to timezone handling.
4. **Rescheduled cleanings** — must show that a cleaning was rescheduled, with original date → new date, easy for an ops person to notice without digging into the Cleaning page.

Plus: Notion and OwnerRez should show real data if credentials exist, and an honest "not connected" message otherwise — never fabricated data. **ADR and Revenue must NOT be on the main dashboard** — they stay reachable via the Reservations page/sidebar only. No unrelated redesign; make the requested information obvious, accurate, and demo-ready, not prettier.

### Dashboard: what's built, and what's live vs. demo right now

- `apps/website/src/domains/dashboard/components/DashboardSummary.tsx` and `.../services/dashboard.service.ts` (both currently **untracked** — new this engagement, never committed) now implement all four requirements:
  - Locks and Thermostats are two separate `Metric` tiles in the KPI strip (not merged).
  - Every offline/low-battery device is itemized in "Needs Attention" with wording that distinguishes **Offline** / **Low battery** / **Offline + low battery** (fixed a real bug along the way: a low-battery-but-online device was showing the maintenance-request badge text "Open" — now shows "Low battery"; also fixed a second bug where a device that was both offline and low-battery only ever reported "Offline," silently hiding the battery fact).
  - "Coming Up" section shows upcoming (not-today) check-ins/check-outs within a 6-day window, alongside the existing "Today's Arrivals & Departures."
  - **Timezone bug fixed**: dates on `@db.Date` columns (check-in/out, cleaning dates) were briefly rendered through a local-timezone `toLocaleString()` that could show the wrong calendar day depending on server timezone. Fixed with a dedicated `formatUtcDate()` helper used everywhere a `@db.Date` field renders (rescheduled-cleaning dates, upcoming check-in/out dates).
  - "Rescheduled Cleanings" section shows property + original date → new date + status, positioned in the primary (left) column.
  - Notion/OwnerRez sections show real data when configured, an honest "Not connected — set X to enable" message otherwise. **Neither is configured in this local dev environment as of today** — no `NOTION_API_KEY`/`OWNERREZ_USERNAME`/`OWNERREZ_API_TOKEN` in `.env.local`.
  - ADR/Revenue confirmed absent from the main dashboard; live on `apps/website/app/(dashboard)/reservations/page.tsx`, reachable via the persistent "Reservations" sidebar item.
  - **Demo-vs-live labeling is per-device-row, not per-provider**: `isDemoSmartDevice()` (`smart-devices.service.ts`) checks whether a `SmartDevice` row's `externalDeviceId` starts with `"demo-"` — the only thing `seedDemoSmartDevices()` ever prefixes that way, so a real August lock ID or Cielo MAC address can never collide with it. This was a deliberate redesign away from an earlier per-_provider_ flag (`PROVIDER_CLIENT_STATUS`), because flipping a provider to "real" the moment its client code exists — independent of whether any given environment's rows actually came from a real sync — would have mislabeled lingering demo rows as live. Verified via dedicated tests.
  - Rescheduled-cleaning backend: `CleaningSchedule.originalScheduledDate` (nullable `@db.Date`, migration `20260811153801_add_cleaning_reschedule_tracking`), `rescheduleCleaningSchedule()` service (sets `originalScheduledDate` only on the _first_ reschedule, no-ops with no DB write if the new date equals the current one — a real bug found and fixed), inline reschedule form on `/cleaning`.

**Right now, in this exact database**: August locks = 4 demo rows (all `demo-`-prefixed, correctly labeled "Demo data" on the dashboard) — no live August data yet. Cielo thermostats = **0 rows** — the 2 demo Cielo rows were auto-pruned once real `CIELO_USERNAME`/`CIELO_PASSWORD` were detected in the environment during a seed run (this is the honesty safeguard working correctly, not a bug: `seedDemoSmartDevices()` only seeds a provider's demo rows while its real credentials are absent, and deletes any leftover demo rows the moment real credentials appear). So the dashboard's Cielo tile currently and correctly shows "0/0 — None connected" — no demo data, no live data yet either.

### August: real integration built, proven only up to the credential boundary

`packages/integrations/src/august/` (client.ts, types.ts, README.md, `scripts/login.ts`, `scripts/check.ts`) — all real, verified against `snjoetw/py-august`'s actual source (not guessed), read-only (no lock/unlock implemented, intentionally). `apps/website/src/domains/smart-devices/services/smart-devices.service.ts`'s `syncAugustDevices()` calls it and upserts into `SmartDevice`, gated on `AUGUST_PROPERTY_MAP` (a required env var mapping August `houseId` → StayWhile `Property.id` — there is no verified automatic way to look this up, so it's explicit config, not guessed). A "Sync now" button is wired into `/integrations` for AUGUST.

**Blocked, and correctly not bypassed**: August's login needs a one-time interactive step — password, then a 6-digit verification code sent to the account's email/phone. This literally cannot be completed by an AI assistant: it requires live keyboard input into a running local process, which chat tooling has no channel for. **Kenny needs to provide the verification code**, and the user (not the assistant) runs the login script in their own terminal. This is understood and was not attempted to be bypassed or faked.

**Exact command to resume, once Kenny's code is available:**

```
pnpm --filter @stayw/integrations exec tsx src/august/scripts/login.ts
```

Then, to verify it worked (real, read-only — validates credentials, lists real locks, prints name/houseId/online-offline/battery, never the token):

```
pnpm --filter @stayw/integrations exec tsx src/august/scripts/check.ts
```

### Cielo: proven live end-to-end, blocked on one external fact (not credentials)

`packages/integrations/src/cielo/` — same shape as August. **Corrected a real research error from earlier in this engagement**: an initial pass concluded Cielo had two separate incompatible products/APIs ("Breez Edge" vs. "MRCOOL SmartHVAC"). Re-reading the _current_ source of the reference integration (`bodyscape/cielo_home`, actively maintained, 2025-dated) showed this was wrong — it's one unified backend (`api.smartcielo.com` / `home.cielowigle.com`) serving both brand names. **This is now empirically confirmed, not just theorized**: the real account's login succeeded against exactly this backend.

**Live verification actually performed today** (read-only `validateCredentials()` + `listDevices()`, real credentials, no control actions):

- Login: **succeeded**.
- 6 real devices retrieved:

  | Device                  | MAC          | Status  |
  | ----------------------- | ------------ | ------- |
  | Island Tides - Man cave | D8BFC0FE8756 | ONLINE  |
  | Bahamas - Living Room   | D0EF7624CCD4 | OFFLINE |
  | Ocean Pearl - SPA Room  | B48A0AF68C2A | OFFLINE |
  | 7206 - Office           | C45BBEC42260 | ONLINE  |
  | Miramar Blis - MIL      | 781C3CBADB1C | OFFLINE |
  | Sandy Nudes - Garage    | 781C3CB9ED6C | ONLINE  |

- The real `syncCieloDevices()` function (not a mock — the exact code the "Sync now" button calls) was then actually run against the real database: **result `{ synced: 0, skippedExternalIds: [all 6 MACs] }`**. Zero writes happened.

**The actual blocker**: this database's only two `Property` rows are `internal_code` `DEMO-001`/`DEMO-002` ("Cabin on the Ridge," Estes Park CO; "Downtown Loft," Denver CO) — explicitly fictional demo data. None of the 6 real device names/locations above have any defensible match against them (checked name, `internal_code`, city, state — zero overlap, different region entirely). Per explicit instruction, no mapping was guessed. `CIELO_PROPERTY_MAP` is still `"{}"`.

**Exact next step for Cielo**: either (a) the client's real properties for these 6 locations get created in StayWhile (via the app's normal Property-creation flow) and their IDs given to fill in `CIELO_PROPERTY_MAP`, or (b) the client confirms an explicit correspondence if one of these actually should map to an existing property under a different name. The moment `CIELO_PROPERTY_MAP` has real entries, re-running the sync (same command pattern as the check script, or clicking "Sync now" on `/integrations`) will write real `SmartDevice` rows and they'll appear on the dashboard automatically — `isDemoSmartDevice()` will correctly never flag them as demo, since real MAC addresses can't match the `"demo-"` prefix.

### Environment variables configured (names only — no values here, ever)

In `apps/website/.env.local` (gitignored, confirmed not tracked by git):

- `CIELO_USERNAME`, `CIELO_PASSWORD` — **set**, real, verified working via live login today.
- `CIELO_PROPERTY_MAP` — set to `"{}"` (empty — the actual blocker above).
- `AUGUST_IDENTIFIER`, `AUGUST_INSTALL_ID`, `AUGUST_ACCESS_TOKEN` — **empty**, pending Kenny's code + the user running the login script.
- `AUGUST_PROPERTY_MAP` — set to `"{}"` placeholder (irrelevant until August has a token).
- `NOTION_API_KEY`, `OWNERREZ_USERNAME`, `OWNERREZ_API_TOKEN` — **not set** (unchanged from earlier sessions; Notion/OwnerRez dashboard sections correctly show "Not connected").

### Client isolation — reconfirmed clean this session

No global shell environment variables, no global `.npmrc`/pnpm config, nothing outside this repo's directory tree was read or written at any point. One formatting bug in the user's own saved Cielo credentials (extra stray quote) was fixed via a pattern-based `sed` substitution that never required displaying the actual value. One temporary diagnostic script (used twice, to run the real `syncCieloDevices()` outside the Next/Clerk request cycle) was created inside `apps/website/`, run, and deleted immediately both times — not committed, not left behind.

### Notion / OwnerRez status (unchanged this session, restated for continuity)

Both have real, credential-gated clients (`packages/integrations/src/notion/`, `.../ownerrez/`) built in an earlier session — genuine HTTP calls, no fabricated data, `IntegrationHighlights<T>` discriminated union (`configured: false` vs. `ok: true/false`). Neither has credentials in this local environment right now, so both dashboard sections honestly show "Not connected." No code changes needed here — just credentials, whenever the client wants to provide them.

### Verification (forced fresh, today)

Full monorepo `lint typecheck test build` — **25/25 tasks, 0 errors**. **368 tests total**: `website` 194, `@stayw/ai` 106, `@stayw/integrations` 59, `@stayw/auth` 5, `@stayw/mcp-servers` 4. Production build succeeds (19 routes). Dev server restarted and healthy after every change today.

**Still not committed to git**: everything from this session (dashboard domain files, smart-devices services, August/Cielo real clients + scripts, integrations service additions) is still working-tree changes, same as the large uncommitted body of work already noted elsewhere in this file. `git status` shows the real current state — check it fresh, don't assume from this doc.

## Increment 20 — 2026-08-14: August proven live end-to-end — real properties, real sync, proven idempotent

Continuation of Increment 19's one remaining August blocker (Kenny's 2FA code). The code was hit with three real, successive failures before it actually worked — each root-caused against the actively-maintained `Yale-Libs/yalexs` library rather than guessed at:

1. **404 on every request** — the integration had been ported from `snjoetw/py-august`, unpushed since 2022-01-31. August had since rotated its app-identification values server-side: stale API key, a six-year-old User-Agent, and two now-required headers (`x-august-branding`, `x-august-country`) that were never sent. Fixed by re-porting against `yalexs` (pushed as recently as 2026-08-10).
2. **403 Forbidden, both brands tried** — `yalexs` defines two non-OAuth brands (`august`, `yale_access`) sharing one API key/host, differing only in the `x-august-branding` value (accounts get silently migrated between them by Yale). `login.ts` was fixed to try both automatically against one password entry.
3. **403 with a definitive body, `{"code":"Forbidden","message":"API key is not valid"}`, both brands** — confirmed via real-world reports in `Yale-Libs/yalexs` issues [#99](https://github.com/Yale-Libs/yalexs/issues/99) and [#150](https://github.com/Yale-Libs/yalexs/issues/150) to mean a brand/host/key mismatch, not bad credentials. `yalexs/const.py` actually defines **four** brands, not two — `yale_august` and `yale_global` each have their own API key, and `yale_global` uses an entirely different host (`api.aaecosystem.com`). All four now live in one shared table (`packages/integrations/src/august/types.ts`'s `AUGUST_BRAND_CONFIGS`), used by both `client.ts` and `scripts/login.ts` so they can't drift apart again.

**Real login then succeeded** — matched brand: **`yale_august`** (a Yale-migrated account; yalexs's own enum flags this brand as normally OAuth-only, but the plain password + 2FA-code flow worked anyway). Token valid until 2026-09-12.

**Real device retrieval** (`check.ts`, read-only): 8 real locks across 4 real houses. The user relayed Michelle's full 36-property StayWhile name list plus complete address/type/bed/bath/occupancy/timezone detail for the 4 properties matching those houses. Reconciled without guessing — confirmed aliases: "Bonjour" → **Bonjour AMI**; Island Tides, Miramar Bliss, Aqua Palm unchanged. Two ambiguous locks were resolved by explicit user confirmation, not inferred: "Mother In Law - Door" is Miramar Bliss's second lock; the unbranded "Front Door" (Island Tides, -100% battery — August's "no sensor" reading) is the WiFi bridge/hub, not a real lock.

**4 real `Property` rows created** (leaving `DEMO-001`/`DEMO-002` untouched — confirmed via identical `updatedAt` before/after):

| Property      | Internal code   | id                                     | Real August houseId                    |
| ------------- | --------------- | -------------------------------------- | -------------------------------------- |
| Island Tides  | `ISLAND-TIDES`  | `4baac99a-b3f7-4f5b-8031-afcedae24a00` | `1ee6ffaf-6fe7-42e1-9d4a-bc9e66a677c5` |
| Bonjour AMI   | `BONJOUR-AMI`   | `5c3cdde7-ff8f-47c9-92a0-6b6e61c1b86b` | `81b55799-18f6-48c2-88ec-a8272b5b3b65` |
| Miramar Bliss | `MIRAMAR-BLISS` | `f7d046c6-e089-41e5-893a-620e5e127c18` | `834a41d3-a673-43e8-a2ea-9d50ab5c6d75` |
| Aqua Palm     | `AQUA-PALM`     | `b3177e87-4266-4e99-a2c2-12f264513e48` | `c98c1d75-cc3e-4315-be7a-16d6d37a97c8` |

`AUGUST_PROPERTY_MAP` in `.env.local` now holds all four real houseId→propertyId pairs.

**New: `AUGUST_EXCLUDED_LOCK_IDS`** — env-driven denylist (`smart-devices.service.ts`), holding exactly one confirmed non-lock device (`76CD40D8711A4ABB98D150B4E5612E48`, the Island Tides bridge). Deliberately a per-device confirmed list, not a blanket "skip anything with a weird battery reading" heuristic — a real lock's genuine battery-sensor failure should still surface on the dashboard, not silently disappear.

**Real sync run twice to prove idempotency**: both runs returned `{ synced: 7, skippedExternalIds: [] }`. The second run was verified against the first at the row level — same 7 `SmartDevice` row **IDs** both times (proving the upsert updated existing rows rather than inserting duplicates), zero duplicate `externalDeviceId`s, excluded device still absent (0 rows). Real, live battery/status data for all 7 locks — see the resulting table below.

| Lock                       | Property      | Status  | Battery |
| -------------------------- | ------------- | ------- | ------- |
| Island Tides - Front Door  | Island Tides  | OFFLINE | 97%     |
| Island Tides - Man Cave    | Island Tides  | OFFLINE | 69%     |
| Bonjour - Front Door       | Bonjour AMI   | ONLINE  | 98%     |
| Bonjour - In Law           | Bonjour AMI   | ONLINE  | 87%     |
| Miramar Bliss - Front Door | Miramar Bliss | OFFLINE | 76%     |
| Mother In Law - Door       | Miramar Bliss | OFFLINE | 78%     |
| Aqua Palm - Front Door     | Aqua Palm     | ONLINE  | 99%     |

**New: `updatePropertyOccupancy`** (schema + service + server action + inline `/properties` UI control, mirroring the existing `updatePropertyStatus` pattern) — added because Michelle noted `maxOccupancy` can change with bed-arrangement changes. Structurally independent of the August mapping: `AUGUST_PROPERTY_MAP` is keyed by the property's `id`, which never changes when `maxOccupancy` does. 2 new RBAC tests cover it.

**Verification, forced fresh**: `pnpm turbo run lint typecheck test build --force` — **25/25 tasks, 0 errors**. **370 tests total**: `website` 196 (up from 194 — the 2 new occupancy tests), `@stayw/ai` 106, `@stayw/integrations` 59, `@stayw/auth` 5, `@stayw/mcp-servers` 4. Production build succeeds (19 routes).

**Client isolation reconfirmed**: only `apps/website/.env.local` and this repo's local dev database were touched. No other client's files, credentials, or environments were read or written at any point. Two temporary one-off scripts (property creation + sync, and the second idempotency-proving sync) were created inside `apps/website/`, run, and deleted immediately both times — not committed, not left behind, same pattern as prior sessions' throwaway diagnostic scripts.

**Result: August is now live end-to-end** — real login → real property records → real lock/property mapping → real sync → proven idempotent, all backed by real device data. **No further August work is needed** unless the client adds more properties or locks later (same code path handles it: re-run `check.ts` for new houseIds, extend `AUGUST_PROPERTY_MAP`, re-run the sync).

**Right now, in this exact database**: August locks = 7 real rows across 4 real properties (`ISLAND-TIDES`, `BONJOUR-AMI`, `MIRAMAR-BLISS`, `AQUA-PALM`), correctly labeled live (not demo) — real August lock IDs never match the `"demo-"` prefix `isDemoSmartDevice()` checks for.

**A note for whoever picks up Cielo next, not acted on this session**: two of the six Cielo devices found in Increment 19 — "Island Tides - Man cave" and "Miramar Blis - MIL" — share property names with two of the properties just created here for August (Island Tides, Miramar Bliss). Worth checking whether these are literally the same physical properties before assuming Cielo still needs 6 brand-new ones. This session did not touch Cielo, `CIELO_PROPERTY_MAP`, or any Cielo code — this is only an observation for the next session to verify, not a decision or mapping made here.

## Increment 21 — 2026-08-15: Cielo proven live end-to-end — real properties, real mapping, real sync, proven idempotent

Continuation of Increment 20's flagged Cielo question. The client (via the user, sourced from Michelle) confirmed the property mapping directly — nothing here was guessed:

- **Island Tides** and **Miramar Bliss** — the same physical properties already created for August in Increment 20. Reused their existing `Property.id`s, no new rows.
- **Bahamas**, **Ocean Pearl**, **Sandy Nudes** — 3 new, real properties. Full address/type/bed/bath/occupancy/timezone came from Michelle's list, relayed by the user and used exactly as given (no invented values):

  | Property    | Internal code | id                                     | Address                                         | Type  | Bed/Bath | Max occ. | Timezone         |
  | ----------- | ------------- | -------------------------------------- | ----------------------------------------------- | ----- | -------- | -------- | ---------------- |
  | Bahamas     | `BAHAMAS`     | `87b19371-2828-44ef-8220-0ad4d5f6a361` | 4411 22nd Ave W, Bradenton, FL 34209            | House | 4 / 2    | 12       | America/New_York |
  | Ocean Pearl | `OCEAN-PEARL` | `7b0755a1-9e28-4356-aefb-27e231b233e1` | 2330 Kings Point Dr, Largo, FL 33774            | House | 6 / 4.5  | 14       | America/New_York |
  | Sandy Nudes | `SANDY-NUDES` | `c6ed7ec8-ce8b-43ef-8a66-9284b1d08c77` | 204 W Hibiscus St, South Padre Island, TX 78597 | House | 5 / 3    | 14       | America/Chicago  |

  Created via a temporary Prisma script (same throwaway-script pattern as Increment 20's property creation), run once and deleted immediately — not committed, not left behind.

- **7206 deliberately excluded, not mapped**: Kenny confirmed this device ("7206 - Office", MAC `C45BBEC42260`) is his and Jenny's personal residence and must not appear on the dashboard. Unlike August's `AUGUST_EXCLUDED_LOCK_IDS` (needed because an excluded device shared a houseId with real locks that still had to sync), Cielo's sync already skips any device whose MAC isn't a key in `CIELO_PROPERTY_MAP` — so simply never adding `C45BBEC42260` to the map was sufficient. No new exclusion mechanism was built; verified the skip actually happens (see below) rather than assumed.

**`CIELO_PROPERTY_MAP`** in `apps/website/.env.local` now holds exactly 5 entries (the 5 mapped MACs above); `C45BBEC42260` is absent. `CIELO_USERNAME`/`CIELO_PASSWORD` were not touched — same credentials verified live in Increment 19/20.

**Real sync run twice to prove idempotency**, via a temporary script (same reasoning as Increment 20's: `smart-devices.service.ts` transitively imports `"server-only"`, which unconditionally throws outside Next's request cycle — the script re-implements `syncCieloDevices()`'s exact logic, calling the real `CieloClient` and the real `prisma.smartDevice` table, not a mock). Script created, run twice, deleted immediately after — not committed.

- Both runs: `{ synced: 5, skippedExternalIds: ["C45BBEC42260"] }`.
- Row-level check between runs: **identical 5 `SmartDevice` row IDs both times** — the upsert updated existing rows, not duplicates. Zero duplicate `externalDeviceId`s across the whole table.
- Verified via direct query: all 5 rows correctly joined to their intended property (`BAHAMAS`, `ISLAND-TIDES`, `MIRAMAR-BLISS`, `OCEAN-PEARL`, `SANDY-NUDES`); `C45BBEC42260` present in zero `SmartDevice` rows.
- August confirmed untouched throughout: still exactly 7 `SmartDevice` rows, same row IDs, no code in `packages/integrations/src/august/` or `smart-devices.service.ts`'s August path was modified.
- `DEMO-001`/`DEMO-002` confirmed untouched: `updated_at` unchanged (2026-08-07) before and after this session's writes.

| Device                  | Property      | Status  |
| ----------------------- | ------------- | ------- |
| Island Tides - Man cave | Island Tides  | ONLINE  |
| Bahamas - Living Room   | Bahamas       | OFFLINE |
| Ocean Pearl - SPA Room  | Ocean Pearl   | OFFLINE |
| Miramar Blis - MIL      | Miramar Bliss | OFFLINE |
| Sandy Nudes - Garage    | Sandy Nudes   | ONLINE  |

**Right now, in this exact database**: 9 `Property` rows total (6 real: `ISLAND-TIDES`, `BONJOUR-AMI`, `MIRAMAR-BLISS`, `AQUA-PALM`, `BAHAMAS`, `OCEAN-PEARL`, `SANDY-NUDES` — that's 7, plus 2 demo: `DEMO-001`, `DEMO-002`). `SmartDevice`: 7 `AUGUST` + 5 `CIELO` = 12 total, zero demo rows, zero duplicates. Real MAC addresses never match `isDemoSmartDevice()`'s `"demo-"` prefix check, so all 5 Cielo rows correctly render as live on the dashboard, not demo.

**Verification, forced fresh**: `pnpm turbo run lint typecheck test build --force` — **25/25 tasks, 0 errors**, only pre-existing `import/order` lint warnings (same known pattern from every prior increment). **370 tests total, unchanged from Increment 20** (`website` 196, `@stayw/ai` 106, `@stayw/integrations` 59, `@stayw/auth` 5, `@stayw/mcp-servers` 4) — expected, since this was a data/config change verified by direct database inspection and live sync runs, not new application code needing new tests. Production build succeeds (19 routes).

**Client isolation reconfirmed**: only `apps/website/.env.local` (one line, `CIELO_PROPERTY_MAP`) and this repo's local dev database were touched. No August credentials, code, or data were modified. No other client's files, credentials, or environments were read or written. Two temporary scripts (property creation, sync) were created inside `packages/database/`, run, and deleted immediately — not committed, not left behind, same pattern as Increment 20.

**Result: Cielo is now live end-to-end**, matching August's status. **No further Cielo work is needed** unless the client adds more thermostats later (same resume path as August: re-run `packages/integrations/src/cielo/scripts/check.ts` for new devices, extend `CIELO_PROPERTY_MAP`, re-run the sync).

**Still not committed to git**: this session made no tracked-file changes other than this `HANDOFF.md` update (the 3 Property rows and `SmartDevice` rows live only in the database; `CIELO_PROPERTY_MAP`'s new value lives only in gitignored `apps/website/.env.local`). The large body of prior uncommitted work (Increments 1–20) is still exactly as uncommitted as `git status` showed at the start of this session — untouched by this session, still worth grouping into logical commits whenever the user is ready.

**Exact next step if picking this up later**: nothing is blocked. Both August and Cielo are fully live. Reasonable next priorities, in no particular order: (a) commit the large uncommitted body of work in logical groups, (b) OwnerRez/Notion credential setup if the client wants those dashboard sections live, (c) revisit Increment 18's flagged gap — no UI/admin flow exists yet for granting a role to a new real Clerk sign-in.

## Increment 22 — 2026-08-15 (same day, continued session): Team/Users admin feature, OwnerRez + Notion credentials verified live (read-only), sign-out button, dashboard requirements re-audited

Continuation of the same 2026-08-15 session, after Increment 21. Four threads of work, all still uncommitted at the end of this increment.

### Team & Role Management — closes Increment 18/20's flagged gap

User asked for an admin-only Team/Users section, built as a new `apps/website/src/domains/users/` domain following the established DDD vertical-slice pattern. Uses only pre-existing permission keys (`users:read/create/delete`, `roles:read/manage`) — the permission catalog, `packages/database/prisma/seed.ts`'s role seeds, and every other role's grants are **unchanged**. As seeded, only `admin` (`permissionKeys: "*"`) holds any of these, so the feature is admin-only by construction, enforced server-side via `assertPermission` as the first line of every service function (not by hiding the nav link).

- **View users + their role assignments**, **assign/revoke a role** (global or property-scoped, idempotent — re-assigning an already-held role is a no-op, mirrors `packages/database/scripts/grant-role.ts`'s existing behavior, which remains as a valid emergency/manual fallback).
- **Invite a team member**: sends a real Clerk invitation (`platform/identity/invite-clerk-user.ts`, using Clerk's actual `invitations.createInvitation`/`getInvitationList`/`revokeInvitation` API, verified against the installed SDK's real types before writing). Deliberately creates **no local `User` row** — the invitee's row (and any role) only comes into existence the normal way once they actually accept and sign in. Inviting an email that already has a `User` row (case-insensitively) is rejected rather than sending a duplicate.
- **Deactivate/remove a team member**: sets `User.status = "DEACTIVATED"` only (never `deletedAt`) — the row, its `UserRole` assignments, and every `AuditLog` row referencing it stay intact, so the person stays visible with a "Deactivated" badge instead of disappearing.
- **Last-global-admin protection**: both `revokeUserRole` and `deactivateTeamMember` refuse to remove the last remaining global `admin` assignment in the system (`ConflictError`), so the app can't accidentally lock itself out of role management through the UI.
- **Roles & permissions reference table** (`RolePermissionsList.tsx`): shows each role's actual granted permissions grouped by resource, sourced from a deeper `include` on `listAssignableRoles` — read-only display data, no write path, no schema change. The `admin` role renders as "Unrestricted — all permissions" rather than enumerating ~75 keys.
- **A real access-control gap found and fixed**: `User.status` was never actually checked anywhere — a "deactivated" user's existing session would have sailed through every `assertPermission` call unaffected. Fixed in `platform/auth/get-current-user.ts`: it now throws a new `AccountDeactivatedError` (`platform/errors.ts`) for any non-`ACTIVE` or soft-deleted row, before any permission check runs — enforced uniformly across every route/Server Action in the app, not just this new domain.
- **A second real gap found and fixed, directly requested by the user**: `User.email`'s database unique constraint is case-sensitive, so nothing stopped `Admin@x.com` and `admin@x.com` from becoming two rows. Fixed by normalizing email to lowercase at every write site and switching the claim-by-email lookup from `findUnique` (exact match) to `findFirst` with `mode: "insensitive"`, in both `get-current-user.ts` (JIT provisioning) and `platform/identity/sync-clerk-user.ts` (the Clerk webhook handler) — same fix, same reasoning, both places independently create/claim `User` rows.
- **`admin@stayawhilewithus.com` verified, not created**: queried the local dev DB directly (read-only) — the seeded bootstrap row already exists, status `ACTIVE`, already holding the global `admin` role. Its `clerkUserId` is still the seed placeholder (never claimed by a real sign-in yet) — correctly so, per the explicit instruction not to fabricate a user ahead of a real Clerk sign-in. The moment that email signs in for real (any casing), the case-insensitive claim-by-email fix above links this exact row and its admin role carries over automatically. **No database write was made for this.**
- Verification, forced fresh: **25/25 tasks, 0 errors**, **234/234 `website` tests** (up from 213 — new: 30 in `users.service.test.ts`, 9 in `get-current-user.test.ts`, 8 in `sync-clerk-user.test.ts`, 3 in `invite-clerk-user.test.ts`).

### OwnerRez + Notion: credentials configured and verified live, read-only

User provided both credential sets; added as empty placeholders first (`OWNERREZ_USERNAME`, `OWNERREZ_API_TOKEN`, `NOTION_API_KEY` in `apps/website/.env.local`, gitignored), then the user filled them in directly (never pasted into chat). A presence check (`validateCredentials()` on both `OwnerrezClient`/`NotionClient`, real read-only calls) initially returned two 401s — root-caused (not assumed) to a formatting bug: all three new `.env.local` lines were missing their closing `"`, confirmed via a redacted quote-balance check, not by ever printing the values. Fixed with a blind `sed` line-append (by line number only, values never read or printed) and re-verified: **both credentials are valid.**

A follow-up **read-only discovery pass** (throwaway script, real `GET`-only calls, run once, deleted immediately, never committed) found:

- **OwnerRez**: 20 real properties, recent bookings (19 active, 1 canceled in the last 365 days) — real account, cross-references cleanly against properties already confirmed real via August/Cielo (Island Tides, Miramar Bliss, Aqua Palm, Sandy Nudes all appear).
- **Notion**: 100+ accessible pages/databases (search API reported more beyond the first page — not fully enumerated), mostly a nested page hierarchy (regional grouping pages → individual property sub-pages) rather than flat databases, plus 4 real databases with retrieved schemas (`View of Listings` is the closest thing to a structured property table: Address/Bedrooms/Bathrooms/Airbnb+VRBO links/Guidebook).
- **No property mapping was inferred or attempted.** Property names differ across systems in ways that aren't safely automatable (e.g. OwnerRez `Miramar-Bliss` vs. a Notion page titled `🏡 Miramar Bliss` vs. StayWhile's own `internalCode` `MIRAMAR-BLISS`) — flagged explicitly as needing the user's/Michelle's/Kenny's confirmation, same standard already used for `AUGUST_PROPERTY_MAP`/`CIELO_PROPERTY_MAP`.

**A hard safety rule was added at the user's explicit direction**, recorded in both `packages/integrations/src/notion/README.md` and `packages/integrations/src/ownerrez/README.md` (dated 2026-08-15) and in a new standing cross-session memory (`feedback_notion_ownerrez_read_only_safety`): **Notion is a strictly read-only source of truth for Kenny & Jenny's existing information — never create/update/overwrite/rename/archive/delete/append to any existing Notion content, any conflict must be reported to the user, never auto-resolved by writing back.** OwnerRez remains read-only unless the user explicitly authorizes a specific write. No inferred mappings, ever. Before any sync/write implementation for either integration, the exact reads/mappings/writes must be shown to the user for approval first. This applies only to this client's own configured credentials.

The dashboard's existing Notion/OwnerRez sections (`getNotionHighlights`/`getOwnerRezHighlights` in `apps/website/src/domains/integrations/services/integrations.service.ts`, built in Increment 19 before real credentials existed) were **not modified this session** — they already only call read endpoints, already never write anywhere, and will now show real data automatically now that the credentials are valid, with zero code change required.

### Dashboard requirements re-audited against Michelle/Kenny's spec — all confirmed already implemented

Read `dashboard.service.ts` and `DashboardSummary.tsx` in full plus two read-only DB checks (device counts, rescheduled-cleaning count) rather than trusting prior notes. Result — everything already built in Increment 19, still correct today:

| Requirement                                         | Status                                                                                                                                                                                                                                     |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| August lock summary + offline/low-battery alerts    | **Confirmed done** — separate `Locks` KPI tile; "Needs Attention" itemizes `Offline` / `Low battery (X%)` / `Offline + low battery` distinctly. Live data confirmed: **7 real August locks, 0 demo rows**.                                 |
| Thermostat summary + offline alerts                 | **Confirmed done** — separate `Thermostats` tile, same itemization. Live data confirmed: **5 real Cielo thermostats, 0 demo rows**.                                                                                                        |
| Daily check-ins/check-outs                          | **Confirmed done, unchanged** — "Check-ins today"/"Departures today" metrics + "Today's Arrivals & Departures" section.                                                                                                                    |
| Rescheduled cleanings on homepage                   | **Confirmed done** — "Rescheduled Cleanings" section renders whenever any exist; **1 row currently in the DB**, actively showing.                                                                                                          |
| ADR/Revenue off homepage, sidebar/Reservations only | **Confirmed done, unchanged** — absent from `DashboardSummary.tsx`; still live only on `/reservations`, reachable via the persistent sidebar item.                                                                                         |
| OwnerRez/Notion read-only dashboard visibility      | **Confirmed done** for what's safely buildable without a mapping decision (see above) — real data now flows automatically since credentials are valid; no property attribution, no writes, matching the explicit no-inferred-mapping rule. |

No application code was changed as a result of this audit — everything asked for was already correct.

### Sign-out

Added a dedicated, always-visible "Sign out" icon button to the dashboard sidebar footer (`apps/website/app/(dashboard)/layout.tsx`), using Clerk's own `<SignOutButton redirectUrl="/sign-in">` (real prop verified against the installed `@clerk/clerk-react` SDK types before use, not guessed) wrapping a labeled icon button, sitting next to the existing `UserButton` (whose own built-in sign-out menu item is untouched — this adds a second, more discoverable path, not a replacement). `redirectUrl="/sign-in"` is set directly on the button so the return-to-login-screen behavior doesn't depend on middleware fallback chains. Touches nothing in `packages/auth`'s RBAC layer — pure Clerk session action. Verification, scoped to `website`, forced fresh: **6/6 tasks, 0 errors, 234/234 tests** (unchanged count — this file has no dedicated test, matching this codebase's convention of not unit-testing layout/chrome components; typecheck+build exercise the new import/JSX).

### Dev server

Started for this project on **port 3001**, not 3000 — port 3000 was found already occupied by a **different client's** dev server (Client B / Cabin Collective, confirmed via the process's own working directory before touching anything, then left completely alone). `GET /api/health` confirmed the server itself boots and serves correctly; `GET /` 404s under `curl` for the same known, pre-existing Clerk dev-browser-handshake reason documented in earlier increments (not a regression) — full visual confirmation of the dashboard needs a real browser, which wasn't available this session (Chrome extension declined).

### Client isolation, reconfirmed

One real lapse this session, disclosed in full to the user at the time: a single dependency-lookup command was scoped wrong (`find /` instead of scoped to this repo's own `node_modules`) while verifying the Clerk invitations API — caught and corrected within the same turn, never read its output, no file content outside this repo was ever read/written at any point this session. Every other command, including the port-3000 investigation above, was read-only and repo/process-scoped before any action was taken.

### Git status at the end of this increment

**Nothing has been committed or pushed this session** (`main` still exactly at `d041f2e`, same as it's been since the Users/Roles feature was pushed earlier in the day). The working tree has 20 uncommitted files, all additive, all reviewed:

- Modified (15): `apps/website/app/(dashboard)/layout.tsx` (sign-out), `apps/website/app/(dashboard)/users/page.tsx`, `apps/website/src/domains/users/{README.md, actions.ts, components/UserList.tsx, schemas/users.schema.ts, services/users.service.ts, services/users.service.test.ts}`, `apps/website/src/platform/{errors.ts, auth/get-current-user.ts, auth/get-current-user.test.ts, identity/sync-clerk-user.ts, identity/sync-clerk-user.test.ts}`, `packages/integrations/src/{notion,ownerrez}/README.md`.
- New (5): `apps/website/src/domains/users/components/{InviteTeamMemberForm.tsx, PendingInvitationsList.tsx, RolePermissionsList.tsx}`, `apps/website/src/platform/identity/{invite-clerk-user.ts, invite-clerk-user.test.ts}`.

**Explicitly not touched this session**: `packages/database/prisma/schema.prisma`, `packages/database/prisma/seed.ts`, `packages/auth/src/permissions.ts` (no schema/migration/permission-catalog changes anywhere in this increment), `packages/integrations/src/august/`, `packages/integrations/src/cielo/`, `apps/website/src/domains/smart-devices/` (August/Cielo untouched, as instructed), and the actual `notion/client.ts`/`ownerrez/client.ts` write surfaces (no sync/write code exists for either — by design, pending the user's explicit approval of exact reads/mappings/writes).

### Current status (superseded by Increment 23 below): WAITING FOR CLIENT FEEDBACK

User has asked Michelle and Kenny to test the dashboard and the sign-out flow before anything further happens. **The next step is to wait for that feedback** — no new feature work, no property mappings, no sync implementation, no external-system writes, unless the user explicitly requests it in the meantime.

---

## Increment 23 — 2026-08-17: production cutover (Supabase migration + Vercel + Clerk testing-phase gate)

User asked to move the dashboard off `localhost` onto a real, testable production URL, without yet purchasing `stayawhilewithus-dashboard.com` (confirmed unregistered via WHOIS). Deliberately chose Vercel's existing free `.vercel.app` alias and the existing Clerk **Development** instance for a testing phase, deferring the custom domain and a Clerk **Production** instance (which Clerk's own docs confirm requires DNS control over a domain the user owns — not possible on a shared `vercel.app` subdomain) to a later phase.

### Database: migrated to the existing StayWhile Supabase project (not a new one)

Per ADR-0003, Supabase is production's intended database. User confirmed a StayWhile Supabase project already exists (workspace **StayWhileWithUs**, project **AdminStay's Project**) — investigated it directly (read-only) rather than assuming: confirmed empty (no `_prisma_migrations` table, zero rows in `information_schema.tables`) before touching anything. Ran a 3-phase migration, each phase explicitly approved before executing:

- **Phase 1 — schema**: `prisma migrate deploy` against Supabase. All 3 existing migrations applied (`20260804150049_init`, `20260805172538_add_ai_action_approval_framework`, `20260811153801_add_cleaning_reschedule_tracking`), 25 tables created, verified empty immediately after.
- **Phase 2 — export**: filtered, explicit-column `\copy` export from local `staywhile_dev` into a new gitignored `.migration-exports/` directory (verified ignored via `git check-ignore` before any file was written; `.gitignore` gained one new line, `/.migration-exports/`). Only the approved production dataset was exported, with every original UUID preserved (no re-seed, no regeneration): 75 permissions, 6 roles, 118 role_permissions, 1 user (`admin@stayawhilewithus.com` only), 1 user_role (its global `admin` assignment), 7 real properties (excluding `DEMO-001`/`DEMO-002`), 12 real smart devices (7 August + 5 Cielo).
- **Phase 3 — import**: same fixed CSV snapshot imported into Supabase in FK-dependency order. Verified row-for-row afterward: counts matched exactly (75/6/118/1/1/7/12), `admin@stayawhilewithus.com` is `ACTIVE` with the global `admin` role, 0 `DEMO-%` properties, 0 rows for the 7206 device or the excluded August bridge, all 12 smart devices resolve to one of the 7 real properties (0 orphans), every non-approved operational table (`guests`, `reservations`, `tasks`, `cleaning_schedules`, `maintenance_requests`, `messages`, `notifications`, `audit_logs`, `ai_*`, `integration_*`, `workflow_executions`) confirmed still empty, and local `staywhile_dev`'s own counts confirmed unchanged throughout (nothing was ever written back to local).

**Explicitly and deliberately not migrated**: `ryskris0@gmail.com` (stays dev-only, per user decision), `DEMO-001`/`DEMO-002` and everything that existed only because of them (100% of local `reservations`/`guests`/`tasks`/`cleaning_schedules`/`maintenance_requests`/`message_threads` were confirmed demo-only before this decision, via FK linkage, not assumed), and all local `audit_logs` (production's audit trail starts clean at cutover).

**New credential file**: `.env.supabase-migration.local` (repo root, gitignored) holds `STAYWHILE_SUPABASE_DATABASE_URL` (transaction pooler, port 6543) and `STAYWHILE_SUPABASE_DIRECT_URL` (session pooler, port 5432) — real, verified-working values, kept separate from the app's own `DATABASE_URL`/`DIRECT_URL` so they can never be picked up accidentally. Values were never printed/logged this session; two formatting bugs (missing closing quote, same class as the earlier Cielo credential bug) were fixed via blind line-append, same technique as before.

**Real infra finding**: this machine's home Wi-Fi silently drops outbound TCP to Supabase's Postgres ports (5432 and 6543) — confirmed via bounded DNS+TCP diagnostics (DNS resolves; neither port connects). A phone hotspot connection reaches both fine. Anyone doing further direct DB work against this Supabase project from this location needs to be off that Wi-Fi (hotspot or a fixed network config) — not a Supabase or credential problem.

### Vercel: pointed at Supabase, same existing project and URL

User reversed an earlier plan to rename the Vercel project — kept the existing project name (`stayawhilewithus-website`) and its existing free alias `https://stayawhilewithus-website.vercel.app` rather than purchasing a domain or renaming. Confirmed (via GitHub's Deployments API, deployment SHAs matching local commit history) this is the correct, already-connected StayWhile Vercel project, with a working Supabase integration already installed at the Vercel-team level whose project reference the user manually confirmed matches the migrated Supabase project.

Applied by the user directly via the Vercel dashboard (no Vercel API/CLI credential was ever available or used this session — an accidental `vercel whoami` early on triggered an interactive OAuth device flow that was deliberately left incomplete, never logged in): `DATABASE_URL` → Supabase transaction pooler, `DIRECT_URL` → Supabase session pooler, `NEXT_PUBLIC_APP_URL` → `https://stayawhilewithus-website.vercel.app`. Redeployed. Verified read-only afterward: `/sign-in` returns `200`; Supabase independently re-confirmed (over the hotspot) to hold exactly 7 properties/0 demo/12 smart devices/admin `ACTIVE` with global admin role. Note for future sessions: a manual "Redeploy" from Vercel's own dashboard does not create a new entry in GitHub's Deployments API (no new git push occurred) — a missing new deployment record there is expected and is not evidence the GitHub↔Vercel integration broke.

### Clerk: testing-phase plan handed to user, application not yet confirmed

Decision: keep the existing Clerk **Development** instance (`adjusted-seahorse-68`) — no second Clerk app. Checklist given to the user (dashboard-only changes, no Clerk API/CLI access was used or available for these specific settings):

1. Disable the **Password** authentication strategy (email-code first factor is already enabled and required — no change needed there).
2. Set sign-up mode to **Restricted** (was `"public"`).
3. Add `https://stayawhilewithus-website.vercel.app` as an allowed origin (was unset/`null`).
4. Add a webhook at `https://stayawhilewithus-website.vercel.app/api/webhooks/clerk`, subscribed to exactly `user.created`/`user.updated`/`user.deleted` (confirmed these are the only 3 events `apps/website/src/platform/identity/sync-clerk-user.ts` actually handles — read from the code, not guessed).
5. Copy the webhook's signing secret into Vercel's `CLERK_WEBHOOK_SIGNING_SECRET` (Production), redeploy.

**As of this note, it is not yet confirmed whether the user has applied this checklist.** Do not assume it's done in a future session — check.

### Explicit acceptance gate for this testing phase (standing instruction — read this before doing anything further)

The dashboard may only be declared **"Ready for Michelle and Kenny to test"** after every one of these is verified — and anything requiring a real browser/inbox (email-code login, logout) must be manually confirmed by the user, never assumed or claimed passed on the assistant's behalf:

- `https://stayawhilewithus-website.vercel.app/sign-in` loads
- Email one-time-code login works (**manual, user-confirmed**)
- `admin@stayawhilewithus.com` has unrestricted global admin access
- 7 real properties are visible
- 12 real smart devices are visible
- No `DEMO` properties appear
- Logout works (**manual, user-confirmed**)
- OwnerRez remains read-only
- Notion remains read-only
- No other client's environment (Supabase/Vercel/Clerk/database/local server) was inspected, modified, stopped, connected, or affected

**Until every item above is verified, and the user has explicitly said the gate is satisfied, do not say anything is "ready."** Once it is: the exact required phrase is **"Ready for Michelle and Kenny to test."** After that phrase is said, **stop** — do not start new feature work, property mappings, OwnerRez/Notion sync, write functionality, Supabase data changes, or further Vercel/Clerk changes, and do not act on any assumption about what Michelle or Kenny will want — wait for the user to relay their actual feedback first.

### Isolation, reconfirmed throughout this session

Every step was scoped to the one confirmed StayWhile Supabase project, the one confirmed StayWhile Vercel project, and the one confirmed StayWhile Clerk Development instance. A dedicated repo-scoped environment-isolation audit was run before any migration work (local DB name/source, shell env override risk, repo-local mechanisms that could point at a shared database) — nothing found. No other client's Supabase, Vercel, Clerk, database, repository, or running local server was inspected, connected to, or modified at any point.

---

## Increment 24 — 2026-08-18: two real production bugs found and fixed via live testing, admin@stayawhilewithus.com invited, ryskris0@gmail.com set up as second global admin, Locks drill-down page added

Continuation of Increment 23's cutover, driven by actually testing the live production login rather than assuming the earlier work was sufficient — both bugs below were only found because real sign-in attempts were made, not by code review.

### Bug 1 — Prisma query engine missing from the Vercel serverless bundle (fixed, committed, deployed)

First real production sign-in attempt (`ryskris0@gmail.com`) crashed with Next.js's generic "Application error" page. Vercel's own runtime logs (checked by the user, not assumed) showed the real cause: `PrismaClientInitializationError: ... could not locate the Query Engine for runtime "rhel-openssl-3.0.x"`. Root-caused precisely: `apps/website/package.json` depends only on `@stayw/database` (a sibling workspace package), never on `@prisma/client` directly — with pnpm's non-hoisted `node_modules`, Next.js's build-time file tracer failed to detect and bundle the Prisma-generated native query engine binary, which lives deep in the root `.pnpm` virtual store. Reproduced locally before touching anything (a clean build's `.next/server` output had zero references to the engine binary in any `.nft.json` trace file, and the binary itself was physically absent) — then fixed with Prisma's own documented minimal fix: added `@prisma/nextjs-monorepo-workaround-plugin` (pinned to `6.19.3`, the exact resolved `prisma`/`@prisma/client` version confirmed from `pnpm-lock.yaml`, matching Vercel's own error output — not the outdated `^6.1.0` range in `package.json`) as a devDependency of `apps/website`, and wired `PrismaPlugin()` into `next.config.js`'s server-side webpack config. One incidental fix: this repo's `no-require-imports` ESLint rule fired on Prisma's own documented `require()` usage in the CommonJS `next.config.js` — resolved with a single targeted inline disable comment, not a rule change. Verified before deploying: same before/after trace-file check, now showing the engine binary referenced in 22+ `.nft.json` files and physically present in `.next/server/chunks/`. Full monorepo `lint typecheck test build --force` green, 25/25. Committed as a single 3-file commit (`next.config.js`, `package.json`, `pnpm-lock.yaml` only — every other pre-existing uncommitted file deliberately excluded), pushed to `main`, auto-deployed by Vercel. Confirmed fixed by a real second sign-in attempt succeeding.

### Bug 2 — Prisma + Supabase transaction-pooler prepared-statement conflict (fixed, Vercel env only, no code change)

Retrying the RBAC bootstrap (`packages/database/scripts/grant-role.ts` against production Supabase) failed with Postgres error `42P05: prepared statement "s0" already exists` — the well-documented Prisma-vs-Supavisor-transaction-mode-pooler incompatibility (Prisma's prepared statements aren't supported by pgbouncer transaction mode without `?pgbouncer=true`). Confirmed nothing had been written before fixing (full read-only recheck of `users`/`user_roles`/`properties`/`smart_devices` counts, all unchanged). Fixed by appending `?pgbouncer=true&connection_limit=1` to the **`DATABASE_URL`** value only (transaction pooler, port 6543) in Vercel's Production env and in `.env.supabase-migration.local`'s `STAYWHILE_SUPABASE_DATABASE_URL` — `DIRECT_URL` (session pooler, port 5432) deliberately left untouched, since it doesn't hit this issue. Verified with a real read-only Prisma query through the qualified URL before retrying anything. `grant-role.ts` retry succeeded on the first attempt afterward.

### Admin accounts

- **`admin@stayawhilewithus.com`**: real Clerk invitation sent (via the Backend API, mirroring the app's own `createClerkInvitation()` call exactly). Not yet accepted as of this note — check current state before assuming otherwise.
- **`ryskris0@gmail.com`** (the user's own personal testing account, already had a real Clerk identity from earlier local-dev sessions): signed in for real through the production app's normal email-code flow (no invitation needed — Clerk's Restricted/invite-only mode only gates new sign-_up_, not sign-_in_ for an existing account, confirmed against Clerk's own docs before relying on this). JIT-provisioned exactly one Supabase `User` row, zero duplicates. Initially had zero RBAC roles (expected — authentication and authorization are deliberately separate in this app); granted the existing global `admin` role via `grant-role.ts` (Bug 2 above blocked the first attempt) — verified afterward: exactly one global `admin` `UserRole`, `property_id` null, `status ACTIVE`. `admin@stayawhilewithus.com`'s own row/role confirmed untouched throughout both admin-setup threads.

### New: `/locks` drill-down page

User requested a dedicated Locks page for the client-testing/feedback phase, in addition to (not replacing) the existing homepage August-lock summary. Added `apps/website/app/(dashboard)/locks/page.tsx` + `apps/website/src/domains/smart-devices/components/LocksList.tsx`, using the **exact same** `listSmartDevices()` service call and `isLowBattery`/`getBatteryLevel`/`isDemoSmartDevice` helpers the homepage already uses — no second data source, no change to August sync/mapping logic, no new RBAC permission (reuses the existing `smart_devices:read` check already inside `listSmartDevices()`). Nav item added under Operations, after Properties (`packages/ui/src/components/Sidebar.tsx` gained a `lock` icon key; `apps/website/src/platform/layout/nav-config.ts` gained the route). Shows summary metrics (Total/Online/Offline/Low battery) + a per-lock table (Property, Lock name, Status, Battery %, Offline/Low-battery/Both warning badges, Provider, Last synced) — `lastSeenAt` rendered as `—` when null (offline locks), no invented fallback timestamp. Verified against real production data: exactly 7 real August locks, 0 demo rows, matches the homepage's own device counts exactly. Homepage (`DashboardSummary.tsx`/`dashboard.service.ts`) deliberately untouched — confirmed via `git status` showing zero modifications to either file — so the original client-requested homepage sections (August lock summary with offline/low-battery/both distinction, Thermostats summary, Today's Arrivals & Departures, Coming Up, Rescheduled Cleanings, Notion/OwnerRez read-only visibility, ADR/Revenue kept off the homepage) are all still exactly as they were. Full monorepo verification green, 25/25. **Not committed/pushed — waiting for user approval.**

### Standing acceptance gate — still not cleared as of this note

The dashboard still cannot be declared "Ready for Michelle and Kenny to test" — `admin@stayawhilewithus.com` hasn't completed its own invitation/login yet, and a full click-through (real email-code login + logout, both user-confirmed, not assumed) hasn't happened since the two bug fixes above landed. See Increment 23's full gate checklist — it still applies unchanged. Do not say the "ready" phrase until every item on it passes.

---

# What Has Been Completed

## Original Phase 1 (verified working)

- Turborepo + pnpm monorepo: `apps/website`, `packages/{database,auth,ai-automation,integrations,mcp-servers,ui,config}`.
- Full Prisma schema (25+ models), migrated and seeded against a local Postgres instance (Homebrew `postgresql@16` — Docker wasn't available in this dev environment; functionally equivalent, see ADR-0003).
- `@stayw/auth` RBAC engine, Clerk integration (code-complete, placeholder keys), event-driven n8n workflow trigger/callback plumbing, a working Properties vertical slice, CI, coding standards, ADRs 0001–0005.

## Architectural Refinement (this session, DDD + AI platform + Integration SDK)

User requested three refinements on top of the approved Phase 1 architecture. Status per piece:

1. **Domain-Driven Design reorganization — ✅ done and verified.**
   - `apps/website/src/server/**` retired. Replaced with `apps/website/src/domains/<domain>/` (business logic) and `apps/website/src/platform/` (cross-cutting infra with no permission checks of its own: `auth/get-current-user.ts`, `identity/verify-clerk-webhook.ts`, `identity/sync-clerk-user.ts`, `audit/record-audit.ts`, `notifications/create-notification.ts`, `errors.ts`).
   - `domains/properties/` fully migrated (services, schemas, components split out of the old inline page, actions, a new `properties.service.test.ts` covering RBAC grant/deny — this test didn't exist before).
   - The other 12 domains (`dashboard`, `reservations`, `guests`, `communications`, `cleaning`, `maintenance`, `tasks`, `smart-devices`, `integrations`, `ai`, `notifications`, `audit`) have **README-only skeletons** — no code yet, just scope/owned-model/permission-key documentation.
   - Clerk webhook route rewritten thin, delegating to `platform/identity/`. n8n webhook route rewritten thin, delegating to a new `packages/ai-automation/src/callback.ts` (`handleN8nCallback`) — that package now owns both directions of the n8n integration symmetrically.
   - New ESLint `no-restricted-imports` rule in `apps/website/eslint.config.mjs` enforces that only `src/domains/*/services/**` and `src/platform/**` may import `@stayw/database` — a real lint error, not just convention.
   - `CODING_STANDARDS.md` updated to match (module boundaries, service-layer example, API patterns, validation paths).
   - Verified: full monorepo `lint typecheck test build` all green after this migration, including a production build with `/properties` still in the route manifest.

2. **Integration SDK — ✅ done and verified.**
   - `packages/integrations/src/core/` now has `types.ts` (`BaseIntegrationClient` + `SyncCapable`/`WebhookReceivable`/`MessagingCapable`/`MediaUploadCapable` capability interfaces + `IntegrationCapability` union), `capabilities.ts` (type guards), `errors.ts`.
   - All 12 provider stubs (OwnerRez, Airbnb, Slack, Asana, Notion, Gmail, Google Voice, Yale, August, Nest, Ecobee, Cielo) rewritten to implement the new interface + correct capability set, **and a real pre-existing bug was fixed**: a bulk-generation script using macOS's BSD `sed` had silently produced broken class names (`UownerrezClient`, `UgoogleUvoiceClient`, etc.) — all corrected (`OwnerrezClient`, `GoogleVoiceClient`, etc.).
   - Every method still throws `NotImplementedError` — this is SDK _shape_ only, no real provider logic yet. **OwnerRez's client is still a stub** — building the real v2 API integration is unstarted implementation work, not a refinement-phase task.
   - Package README documents the capability matrix and the `IntegrationSyncLog` convention. Unit tests added (`core/capabilities.test.ts`) covering type-guard narrowing and that every method still throws.

3. **AI platform layer — ✅ done and verified (completed 2026-08-06).**
   - `packages/database/prisma/schema.prisma`'s `AiAction` model + `AiActionStatus`/`AiActionRiskLevel` enums, `ActorType.AI`, `NotificationType.AI_ACTION_PENDING` are migrated (`20260805172538_add_ai_action_approval_framework` — confirmed additive-only from the generated SQL: 2 new enums, 2 new enum values, 1 new table, 2 indexes, 2 FKs, nothing dropped/altered).
   - `packages/auth/src/permissions.ts` and `prisma/seed.ts` both have the new `ai_actions` resource (15 resources × 5 actions = 75 permissions total); `ops_manager` granted `ai_actions:read`/`ai_actions:update` (12 permissions, up from 10). Re-seeded successfully.
   - **`packages/ai` (`@stayw/ai`) is scaffolded and implemented**: Context Engine (real), Knowledge Retrieval (stub, `NotImplementedError`), Prompt Library (real), Tool Registry (real, enforces the approval gate), Orchestrator (real plumbing, stub Claude call via `NotImplementedClaudeClient`), Conversation Context (real, against `AiConversation`/`AiMessage`), Action Approval Framework (real, against `AiAction`, with a genuine `PENDING → APPROVED|REJECTED → EXECUTED|EXECUTION_FAILED` state machine guarded by `InvalidActionStateError`). 28 unit tests, all passing.
   - `packages/mcp-servers/src/shared/register-tools.ts` wires `@stayw/ai`'s Tool Registry onto the MCP SDK's `ListTools`/`CallTool` handlers (via `zod-to-json-schema`); every `CallTool` routes through `executeTool()`, so the approval gate applies over MCP too. 4 unit tests against a mocked `Server`.
   - **Proof-of-concept**: `apps/website/src/domains/properties/ai-tools.ts` registers a `properties.list` tool (read-only, `requiresApproval: false`) wrapping the already-tested `listProperties` service. 2 unit tests (mocking `@stayw/ai` itself, not its internals — see the note on the `server-only` package below).
   - **ADRs 0006 (DDD), 0007 (AI platform), 0008 (Integration SDK) written**; ADR-0001 updated to list `@stayw/ai` and cross-reference ADR-0006. `system-architecture.md` and `erd.md` updated (mermaid diagrams, folder structure, AI layer section, module-boundary line, data-flow file references, `AiAction`'s state machine explained).
   - **Full monorepo verification pass, all green**: `pnpm lint` (0 errors, only pre-existing `import/order` warnings from the repo's established `vi.mock`-between-imports test pattern), `pnpm typecheck`, `pnpm test` (46 tests across 8 packages), `pnpm build` (production build succeeds, `/properties` still in the route manifest).
   - **One real tooling bug found and fixed along the way**: root `package.json`'s `lint-staged` ran bare `eslint --fix` from the repo root, which can never resolve any package's flat `eslint.config.*` (ESLint v9 flat config only looks at the invocation `cwd`, unlike the old cascading `.eslintrc`). Real linting already runs correctly per-package via `turbo run lint` (used in CI) — pre-commit now only runs `prettier --write`.
   - **A `server-only` cross-package testing note for future sessions**: any workspace package with `import "server-only"` (currently `@stayw/database`, `@stayw/ai-automation`, `@stayw/ai`) can be tested **within its own package** by mocking `server-only` via a `vitest.setup.ts` (see `packages/ai/vitest.setup.ts`, mirroring `apps/website/vitest.setup.mts`'s existing pattern) — this works because first-party/inlined source goes through Vitest's transform pipeline where `vi.mock` applies. It does **not** reliably work when a _different_ package (e.g. `apps/website`) imports that package for real and expects the mock to propagate across the package boundary — Vitest externalizes workspace `node_modules` packages by default, and their internal `import "server-only"` then resolves via real Node resolution (hitting the real throwing module) instead of Vitest's mock registry. `apps/website/src/domains/properties/ai-tools.test.ts` works around this by mocking `@stayw/ai` itself at that boundary (matching how `properties.service.test.ts` already mocks every other cross-package dependency) rather than exercising `@stayw/ai`'s real internals from outside its own package.

## Increment 1 Progress — Core Ops Domains (`IMPLEMENTATION_PLAN.md`)

Started 2026-08-06 (same day as the architectural refinement, in later sessions). Same vertical-slice pattern each time: `schemas/` (Zod) → `services/` (assertPermission → validate → prisma → recordAudit) → `components/` → `actions.ts` (Server Actions) → thin `app/(dashboard)/<domain>/page.tsx` → RBAC tests.

- **Guests** — ✅ done (2026-08-06). List + create, 4 RBAC tests, `/guests` route.
- **Reservations** — ✅ done (2026-08-06). List + create, 4 RBAC tests, `/reservations` route. Manual bookings use `source=DIRECT` + generated UUID `externalReservationId`; writes the `ReservationGuest` join row in the same transaction.
- **Tasks** — ✅ done (2026-08-06, later session). List + create + complete, 6 RBAC tests, `/tasks` route + nav link. Schema/service/components (`createTaskSchema`, `listTasks`/`createTask`/`completeTask`, `TaskList`/`CreateTaskForm`) already existed from an earlier session; this session added `actions.ts`, the route, the nav link, and the tests. `completeTask` sets `status=DONE` + `completedAt`. Full monorepo `lint typecheck test build` verified green (25/25 tasks) after landing.
- **Cleaning schedules** — ✅ done (2026-08-06, same later session). List + create + complete, 6 RBAC tests, `/cleaning` route + nav link. `CleaningSchedule.taskId` is a required unique FK, so `createCleaningSchedule` creates the backing `Task` (type `CLEANING`) and the `CleaningSchedule` row together in one `prisma.$transaction`; `completeCleaningSchedule` updates both rows in one transaction too, mirroring the Reservations `Reservation`+`ReservationGuest` pattern. `CANCELLED`/`MISSED` statuses exist on the model but aren't wired to any UI action yet. Full monorepo `lint typecheck test build` verified green (25/25 tasks) after landing.
- None of Guests/Reservations/Tasks wire a `triggerWorkflow(...)` call yet — no n8n workflow exists for `guest.created`/`task.created`/etc. (n8n instance confirmed empty 2026-08-06; n8n MCP connection itself is also currently unavailable, see above). Add workflow triggers once real n8n workflows exist, to avoid spurious `WorkflowExecution` FAILED rows and admin-notification noise.
- As of the end of the "Tasks shipped" session, this work (Guests, Reservations, Tasks domain code; `layout.tsx` nav updates; `IMPLEMENTATION_PLAN.md`; this file) was **not yet committed to git** — still local working-tree changes. Confirm current `git status` before assuming otherwise.

## Technology & Integration Audit — ⚠️ explicitly abandoned mid-way

User asked for a full platform/credential audit, we agreed on a safe split (architecture-only data in git; sensitive account details as placeholders only), and created three files:

- `INTEGRATION_INVENTORY.md` — architecture-level platform inventory. **Only OwnerRez's high-level status was captured** ("in use," PAT created) before the user said "we are skipping the remaining audit." Every other platform is still `pending interview`.
- `SECURE_CONFIGURATION_CHECKLIST.md` — placeholder checklist (`<TO_BE_PROVIDED>` etc.) for every platform's credential needs. Fully templated, no real values, nothing filled in yet.
- `N8N_DISCOVERY.md` — architecture-only n8n deep-dive template. Entirely unfilled (`TBD` throughout) — **the audit was abandoned before any of n8n's existing workflows, credentials, or connected services were actually inspected.**

**This matters for the next session**: nobody has looked at what's already inside StayWhile's n8n instance. Don't assume it's empty — inspect it first (see Next Steps).

## n8n MCP Connection — ✅ connected, authenticated, and verified working (2026-08-06)

- User registered `n8n` as an HTTP MCP server: `claude mcp add --transport http n8n https://adminstay.app.n8n.cloud/mcp-server/http` (n8n Cloud, not self-hosted).
- Initial registration needed authentication. Browser-based `claude mcp login n8n` **cannot run through the assistant's Bash tool** (confirmed by trying it — fails with "stdin isn't a terminal"). The user ran it themselves in their own terminal successfully.
- `claude mcp list` now shows `n8n: https://adminstay.app.n8n.cloud/mcp-server/http (HTTP) - ✔ Connected`.
- **Verified working in the 2026-08-06 session**: `mcp__n8n__search_workflows`, `list_credentials`, `get_workflow_details`, `list_tags`, `search_projects` all called successfully and returned real account data. No further debugging needed for tool access.

### Update — 2026-08-06, later same-day session: n8n found disconnected

The verification above was real and accurate for that session. In a **later session the same day**, `claude mcp list` no longer showed `n8n` at all — only `IFTTT`, `Asana` (needs auth), and `Slack` were registered. **MCP server availability is session-specific and was not assumed to carry over** — no n8n tool calls were made or simulated once this was discovered. This does not overwrite the earlier "verified working" finding — both are true at their respective points in time. The user needs to reconnect n8n (re-run the registration/login flow from their own terminal, same as the original setup) before any n8n-dependent work can resume. Every future session must re-run `claude mcp list` and not assume n8n (or any MCP server) is still connected based on this document.

## MCP Connections — 2026-08-06, later same-day session: Slack / Asana / IFTTT observed, ownership unconfirmed

In the same later session, three MCP connections appeared in `claude mcp list` that are **not mentioned anywhere else in this document** and were never set up or discussed in any prior documented session:

- `Slack` — ✔ Connected
- `Asana` — needs authentication
- `IFTTT` — ✔ Connected

Per explicit user instruction (2026-08-06, that session): do not interact with any of these, or any future MCP connection, unless the user explicitly confirms it belongs to the StayWhile workspace. If ownership cannot be confirmed, ignore it completely. As of the end of that session, ownership had not been confirmed for any of the three, so none were used. Any future session must re-check this — the user may confirm ownership later, at which point this note should be updated (additively, not by deletion) to reflect that.

## n8n Instance Discovery — ✅ done (2026-08-06)

Full findings in `N8N_DISCOVERY.md`. Summary: the instance is **effectively empty** — one auto-generated default workflow ("My workflow": manual trigger → unconfigured HTTP Request, inactive, never touched), no tags, no folders beyond the single personal project, and only 3 credentials on file (`Notion account`, `Anthropic account`, `Header Auth account` — no OwnerRez/Slack/Gmail/etc. yet). **Safe to build new workflows without risk of colliding with or duplicating prior work.**

---

# What Is Blocked / Needs Verification First

1. ✅ **n8n MCP tools verified working** (2026-08-06 session). `search_workflows`, `list_credentials`, `get_workflow_details`, `list_tags`, `search_projects` all returned real data — the connection is fully functional, not just account-level.
2. ✅ **OwnerRez confirmed as production data** (2026-08-06 session — user answered directly after being asked a third time). All OwnerRez work must treat reservation/guest records as real. Read-only until the user explicitly authorizes writes.
3. **No OwnerRez PAT is configured anywhere in this codebase.** The user was told explicitly not to paste it into chat; it was never provided by any other channel either. It needs to go into `.env.local`/`.env` (gitignored) before the OwnerRez client can be implemented for real.
4. ✅ ~~`packages/ai` doesn't exist yet~~ — long since built and complete, see Increment 4–13 above. Stale as of 2026-08-12; kept for historical record only.

## Current blockers (updated 2026-08-14, see Increment 20 for full detail)

5. ✅ **RESOLVED (2026-08-14) — August is live end-to-end.** Real login (brand `yale_august`, token valid until 2026-09-12), 4 real `Property` rows created, `AUGUST_PROPERTY_MAP` fully populated, real sync run twice and proven idempotent (7/7 locks synced both times, no duplicates), the one non-lock device excluded by confirmed ID. No further action needed unless the client adds more properties/locks — see Increment 20 for the exact resume path if that happens.
6. ✅ **RESOLVED (2026-08-15) — Cielo is live end-to-end.** Client-confirmed mapping (via the user, sourced from Michelle): Island Tides and Miramar Bliss reuse the `Property` rows already created for August; Bahamas, Ocean Pearl, and Sandy Nudes are 3 new real `Property` rows created from Michelle's actual address/type/bed/bath/occupancy/timezone data (no fabrication). 7206 (Kenny & Jenny's personal residence, per Kenny's explicit confirmation) is deliberately excluded — omitted from `CIELO_PROPERTY_MAP` entirely, so it's skipped by the sync and never becomes a `SmartDevice` row. Real sync run twice, proven idempotent (5/5 synced both times, identical row IDs, zero duplicates). See Increment 21 for full detail. No further action needed unless the client adds more thermostats.
7. **Notion / OwnerRez** — code complete, credential-gated, currently unconfigured in this local environment. Not blocked on anything code-side; just waiting on the client to provide `NOTION_API_KEY` and/or `OWNERREZ_USERNAME`+`OWNERREZ_API_TOKEN` if/when they want those dashboard sections live.

---

# Architectural Decisions Made This Session

(In addition to ADRs 0001–0005 from original Phase 1, which stand unchanged.)

- **DDD folder structure**: `apps/website/src/domains/<domain>/` for business logic, `apps/website/src/platform/` for cross-cutting infra with no permission checks of its own. Reconciliation rule for domains that look cross-cutting (Audit, Notifications, AI, Integrations): the _package/platform layer_ owns the reusable capability; the _domain folder_ owns the human-facing feature built on top, with its own `assertPermission` call. — **needs ADR-0006**, not yet written.
- **AI platform layer**: a new, separate `packages/ai` (`@stayw/ai`), not an expansion of `@stayw/ai-automation`. n8n = deterministic business-process automation; the AI Orchestrator (not yet built) = a non-deterministic Claude tool-use loop — they're peers, with the Orchestrator able to call `triggerWorkflow()` as a future registered tool (not wired yet). Action Approval Framework needed a genuinely new `AiAction` table (confirmed gap, now in schema). Knowledge Retrieval is interface + stub only, deliberately deferred. — **needs ADR-0007**, not yet written.
- **Integration SDK**: base interface (universal methods) + capability interfaces (`SyncCapable`/`WebhookReceivable`/`MessagingCapable`/`MediaUploadCapable`), declared via a `capabilities` array, narrowed safely via type guards. No `IntegrationConnection`/`IntegrationSyncLog` schema changes needed — capability-to-sync-log mapping is a documented convention, not a new column. — **needs ADR-0008**, not yet written.
- **n8n is n8n Cloud** (`adminstay.app.n8n.cloud`), not self-hosted — confirmed by the MCP server URL the user registered.
- **MCP tool access requires a fresh session** — confirmed both by official Claude Code documentation and by direct testing in this session (`ToolSearch` returned nothing for n8n despite a successful account-level connection).

---

# Remaining Implementation Tasks, In Priority Order

1. ✅ ~~New session bootstrap: verify n8n MCP tools~~ — done 2026-08-06.
2. ✅ ~~Finish the paused architectural refinement~~ — done and fully verified 2026-08-06, see "AI platform layer" above. `/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md` is now fully executed; no need to re-read it for design content (only for historical context).
3. **Commit this session's new work** (packages/ai, mcp-servers wiring, ADRs 0006-0008, updated docs) — see "Risks" below, not yet done as of end of session.
4. **Credential setup**: get the OwnerRez PAT into `.env.local`/`.env` (never into git, never pasted into chat). OwnerRez is now **confirmed production data** (2026-08-06) — read-only until explicitly authorized otherwise.
5. ✅ ~~n8n discovery~~ — done 2026-08-06, instance confirmed empty, see `N8N_DISCOVERY.md`. Safe to build real workflows without collision risk.
6. **OwnerRez v2 API integration**: implement `packages/integrations/src/ownerrez/client.ts` for real (currently a structural stub, now shaped per ADR-0008's capability interfaces). Build and test reservation synchronization — read-only first, given the confirmed-production data.
7. **Webhook listeners** where OwnerRez/other providers support them (`WebhookReceivable` capability already modeled in the SDK).
8. **Connect the dashboard backend** to real synced data (extends the `domains/reservations/`, `domains/properties/` pattern already established).
9. **Real Claude wiring in the Orchestrator**: `packages/ai/src/orchestrator/claude-client.ts`'s `NotImplementedClaudeClient` is the one piece of `@stayw/ai` still stubbed — everything around it (context, prompts, persistence) is real and tested. Also still a stub: Knowledge Retrieval.
10. **Build real n8n workflows**: reservation notifications, guest communications, etc. — the instance is empty and ready.
11. Continue the platform-by-platform audit interview for the remaining platforms (Airbnb, Slack, Asana, Notion, Gmail, Google Voice, GitHub, Supabase, Vercel, Claude API, MCP Servers, Yale, August, Nest, Ecobee, Honeywell, Cielo) **if/when the user wants it resumed** — it was explicitly deprioritized, not cancelled.

---

# Assumptions Made

- OwnerRez reservation-sync testing will hit **production data** — confirmed directly by the user 2026-08-06, no longer an assumption.
- n8n is **Cloud-hosted**, not self-hosted (inferred from the registered MCP server's URL).
- The audit's "skip remaining" instruction applies to the **interview process**, not to the two safe artifacts already created (`INTEGRATION_INVENTORY.md`, `SECURE_CONFIGURATION_CHECKLIST.md`) — those stay as living documents to fill in opportunistically during implementation, not deleted.
- "Take over implementation" and "only ask for approval before destructive changes" is scoped to **this project's own resources** (its database, its repo, its n8n workflows) — it does not extend to skipping confirmation for genuinely irreversible or cross-system actions (e.g. force-pushes, dropping tables, production data mutations) per this assistant's standing safety practice, which the user has not overridden.
- Local Postgres (Homebrew, not Docker) remains an acceptable dev substitute per ADR-0003; production still targets Supabase.

---

# Risks & Warnings

- ✅ **RESOLVED (2026-08-06)**: all work from this session — original Phase 1, the DDD/SDK refinement scaffolding, all original documentation, and the refinement-completion work (packages/ai, mcp-servers wiring, ADRs 0006-0008, updated docs) — is committed to git across five commits on `main`. Working tree is clean as of end of session. Not yet pushed to `origin` — only local commits were requested/authorized.
- ✅ **RESOLVED (2026-08-06)**: n8n's existing state is now known — see "n8n Instance Discovery" above and `N8N_DISCOVERY.md`. It's empty; safe to build on.
- ✅ **RESOLVED (2026-08-06)**: OwnerRez is confirmed production data (see "What Is Blocked," item 2) — no longer an open question. Any reservation-sync work must treat this as real guest/reservation data, read-only until explicitly authorized otherwise.
- ✅ **RESOLVED (2026-08-06)**: `AiAction` and its enums are migrated (`20260805172538_add_ai_action_approval_framework`, confirmed additive-only). `schema.prisma` and the database are in sync.
- The three audit documents (`INTEGRATION_INVENTORY.md`, `SECURE_CONFIGURATION_CHECKLIST.md`, `N8N_DISCOVERY.md`) are mostly `TBD`/skeleton — don't mistake their existence for completeness.
- Clerk is still running on placeholder (non-functional) API keys; full sign-in has never been tested end-to-end with real credentials.

---

# Exact Next Steps For The New Session

1. Start the new session in this same project directory.
2. Confirm n8n MCP tool availability still holds (was verified working 2026-08-06; re-verify if this is a materially later session).
3. Recommend committing this session's new work (packages/ai, mcp-servers, ADRs, docs) early, given the risk noted above.
4. Ask the user to pick the next priority from "Remaining Implementation Tasks" items 4/6/9/10 (credential setup, OwnerRez real integration, real Claude wiring, or building actual n8n workflows) — all four are now unblocked and it's the user's call to sequence.

### Update — 2026-08-06, later same-day session (supersedes steps 2 and 4 above; step 1 and 3's intent still stand)

The user has since directed work to continue down **Increment 1** of `IMPLEMENTATION_PLAN.md` (core ops domains) rather than jumping to the credential-gated Increment 2 items. Revised steps for the next new session:

1. Start the new session in this same project directory (unchanged).
2. **Re-run `claude mcp list` fresh — do not assume n8n, or any other connection documented in this file, is still live.** See "n8n MCP Connection" and "MCP Connections" updates above.
3. Recommend committing any currently-uncommitted work — check `git status` for the real current state.
4. Continue Increment 1 at the next undone domain per `IMPLEMENTATION_PLAN.md`'s table (Cleaning schedules, once Tasks is committed) using the same vertical-slice pattern, referencing `apps/website/src/domains/tasks/` as the most recent worked example.
5. Only return to Increment 2 items (credential setup, OwnerRez, Claude wiring, n8n workflows) once Increment 1 is further along or the user redirects.

### Update — 2026-08-07 session (supersedes all steps above; Increments 1, 1.5, 3, and 4 are now done)

1. Start the new session in this same project directory (unchanged).
2. Re-run `claude mcp list` fresh if any MCP-dependent work is planned — not needed last session, don't assume it's still true.
3. Recommend committing — there is now a very large amount of uncommitted work spanning this session and the prior one; check `git status` for the real current state before assuming anything is saved.
4. Everything left in `IMPLEMENTATION_PLAN.md` is genuinely credential-, money-, login-, or design-decision-gated (see Increment 2's table). Real next steps, in rough priority:
   - If the user provides `ANTHROPIC_API_KEY`, `OWNERREZ_USERNAME`+`OWNERREZ_API_TOKEN`, `SLACK_BOT_TOKEN`+`SLACK_SIGNING_SECRET`, `NOTION_API_KEY`, or `ASANA_ACCESS_TOKEN`: the adapters are already real and code-complete — verify against a live account and wire up any missing env declaration in `apps/website/env.ts`.
   - Ask the user for a decision on Google Voice (no public API exists — drop it, or substitute something like Twilio).
   - If real Clerk keys become available, test the actual sign-in round-trip end-to-end for the first time.
   - The Orchestrator's tool-use loop is now real and wired to the AI domain (Increment 4) — Context Engine wiring (real context providers for `assembleContext()`, so the `{{context}}` prompt placeholder isn't empty) is the next genuinely no-credential AI feature, if the user wants richer conversations. Wiring `completeStream()` into the actual Next.js UI (a streaming route handler + client component) is the other one.
   - Knowledge Retrieval (semantic/long-term memory) needs a vector store decision from the user before any code — a real infra/credential question, not a coding gap.

### Update — 2026-08-12 session (supersedes the steps above; see Increment 19 for full detail)

Everything above this update is now historical — the AI platform, dashboard demo-readiness, and Clerk auth work it describes are all done. The project is now in **live-integration verification mode** for August/Cielo. Exact order of work for the next session:

1. Start in this same project directory. Run `git status` for the real current state — a large amount of work (including all of today's dashboard + August/Cielo work) is still uncommitted.
2. **Check whether Kenny has provided the August verification code.** If yes: the user runs `pnpm --filter @stayw/integrations exec tsx src/august/scripts/login.ts` themselves (interactive, needs their own terminal — an assistant cannot do this step). Once it reports success, run `pnpm --filter @stayw/integrations exec tsx src/august/scripts/check.ts` to confirm real locks/battery/online-offline, then fill in `AUGUST_PROPERTY_MAP` using the real houseId values it prints, then run the real August sync and verify the dashboard's Locks section.
3. **Check whether the client has resolved the Cielo property-mapping blocker** (real Property records created for Island Tides / Bahamas / Ocean Pearl / 7206 / Miramar Blis / Sandy Nudes, or an explicit correspondence to existing properties). If yes: fill in `CIELO_PROPERTY_MAP`, re-run `syncCieloDevices`, confirm the resulting `SmartDevice` rows via `psql`, then confirm the dashboard's Thermostats section shows them as live (not demo).
4. If neither is resolved yet: there's no further live-integration work possible without client input — this is a legitimate stopping point, not a gap to work around. Everything else (dashboard requirements, both integrations' code, tests) is done and verified; re-confirm with a fresh `pnpm turbo run lint typecheck test build --force` if picking up other work, since that's cheap and catches drift.
5. Do not attempt to complete August's login without a human entering the real password/2FA code, and do not guess a Cielo property mapping — both are explicit standing instructions from the client.

### Update — 2026-08-14 session (August done — see Increment 20 for full detail)

Kenny's code arrived, the user ran the login themselves, and August is now **fully live end-to-end** — real login, 4 real properties, real lock mapping, real sync proven idempotent (twice).

### Update — 2026-08-15 session (supersedes all steps above; Cielo is now also done — see Increment 21 for full detail)

Both August and Cielo are now fully live. Nothing is blocked. Exact order of work for the next session:

1. Start in this same project directory. Run `git status` for the real current state — a very large amount of work (everything from Increment 1 through 21) is still uncommitted; recommend committing in logically-grouped chunks (re-derive current groupings from `git status` directly rather than assuming any prior note's grouping is still accurate).
2. No live-integration blockers remain. Reasonable next priorities, the user's call to sequence: (a) commit the large uncommitted body of work, (b) OwnerRez/Notion credential setup if the client wants those dashboard sections live (both are code-complete, just unconfigured in this environment), (c) Increment 18's flagged gap — no UI/admin flow exists yet for granting a role to a new real Clerk sign-in, so every future first-time real user still needs a manual SQL grant.
3. If the client adds more August locks or Cielo thermostats later: same resume path both times — re-run the respective `check.ts` script, extend the respective `*_PROPERTY_MAP`, re-run the sync.

### Update — 2026-08-15 session, continued (supersedes all steps above — see Increment 22 for full detail)

**Current status: WAITING FOR CLIENT FEEDBACK.** Michelle and Kenny are testing the dashboard and the new sign-out flow; the user has explicitly asked for no further feature work, mappings, syncs, or external-system writes until they give new instructions. Exact order of work for the next session:

1. Start in this same project directory. **Check with the user for feedback from Michelle/Kenny before doing anything else** — if none yet, the correct action is to wait, not to proceed with new work independently.
2. Run `git status` for the real current state — 20 files uncommitted (the Team/Users admin feature across Increments 21–22, the case-insensitive-email + last-admin-deactivation-guard fixes, the Notion/OwnerRez read-only safety README updates, and the sign-out button), plus everything from Increments 1–20 already noted as uncommitted in every prior update. Do not assume only the sign-out file is uncommitted — see Increment 22's "Git status at the end of this increment" for the exact file list.
3. Once feedback arrives and the user is ready: commit the uncommitted work in logically-grouped chunks (re-derive current groupings from `git status` directly). The Team/Users feature, the RBAC safety fixes, the Notion/OwnerRez doc updates, and the sign-out button are four reasonably separable commits, but confirm with the user before grouping.
4. **Do not implement any OwnerRez/Notion sync or write path** without first showing the user the exact reads, exact property mappings, and exact writes, and getting explicit approval — this is a standing hard rule (see `packages/integrations/src/notion/README.md`, `packages/integrations/src/ownerrez/README.md`, and the `feedback_notion_ownerrez_read_only_safety` cross-session memory), not just a one-time instruction.
5. **StayWhile's dev server may still be running on port 3001** (started this session because port 3000 belongs to a different client's project — never touch whatever is on port 3000 without first confirming, the same way this session did, that it actually belongs to StayWhile). Check `lsof -i :3001` before assuming it's still up; restart with `PORT=3001 pnpm --filter website dev` if not.
6. If the client adds more August locks or Cielo thermostats later: unchanged, same resume path as before (step 3 in the prior update block).

### Update — 2026-08-17 session (supersedes all steps above — see Increment 23 for full detail)

**Current status: PRODUCTION CUTOVER IN PROGRESS — Clerk testing-phase gate not yet cleared.** Do not resume the "commit uncommitted work" / "wait for Michelle & Kenny feedback on the old dev flow" track above — that was superseded the moment this session began production migration work. Exact state:

- **Supabase**: migration complete and fully verified (Phase 1–3, see Increment 23). The existing StayWhile Supabase project now holds exactly the approved production dataset. Do not re-run any phase of this migration or treat it as still pending.
- **Vercel**: `DATABASE_URL`/`DIRECT_URL`/`NEXT_PUBLIC_APP_URL` already updated and redeployed, pointing at Supabase. Live at `https://stayawhilewithus-website.vercel.app` (project not renamed — user reversed that plan; do not rename it).
- **Clerk**: a testing-phase checklist was handed to the user (disable Password strategy, restrict sign-up, add allowed origin, add webhook + its signing secret to Vercel) — **check with the user whether this has actually been applied yet before assuming it has.**
- **Standing acceptance gate** (see Increment 23 for the full checklist): the dashboard cannot be declared ready for Michelle/Kenny until every gate item is verified, with browser/inbox-dependent items (email-code login, logout) confirmed by the user directly, never assumed. The required exact phrase, once cleared, is **"Ready for Michelle and Kenny to test."**
- **After that phrase is said**: stop. No new feature work, property mappings, OwnerRez/Notion sync, write functionality, Supabase data changes, or further Vercel/Clerk changes — and no acting on assumptions about Michelle or Kenny's preferences — until the user relays their actual feedback.
- The large body of previously-uncommitted work (Increments 1–22) is **still uncommitted** — this session added no new commits either. Still worth grouping and committing whenever the user is ready, but that's independent of and lower-priority than the production cutover/testing-gate work above.
- Local dev server situation (port 3001 vs. another client's port 3000) is unchanged from the prior note — still applies if local dev work resumes.

### Update — 2026-08-18 session (supersedes all steps above — see Increment 24 for full detail)

**Current status: still PRODUCTION CUTOVER IN PROGRESS — acceptance gate still not cleared.** This session found and fixed two real production bugs via actual live-login testing (not code review), got `ryskris0@gmail.com` working end-to-end as a second global admin, and added a `/locks` drill-down page at the user's request. Exact state for the next session:

- **Two real bugs fixed this session** — full detail in Increment 24: (1) Prisma query engine wasn't bundled into the Vercel serverless function (fixed via `@prisma/nextjs-monorepo-workaround-plugin`, committed as `e23bcd0`, already deployed and confirmed working by a real sign-in); (2) Prisma + Supabase transaction-pooler prepared-statement conflict (`42P05`), fixed by appending `?pgbouncer=true&connection_limit=1` to Vercel's Production `DATABASE_URL` only — **do not remove this query string**, it's required, not optional.
- **`admin@stayawhilewithus.com`**: invited via Clerk, **not yet confirmed accepted/signed-in as of this note** — check current state, don't assume either way.
- **`ryskris0@gmail.com`**: fully working — real Clerk sign-in, one clean Supabase row, global `admin` role granted and verified. This is the user's own personal testing account, kept deliberately separate from `admin@stayawhilewithus.com`.
- **`/locks` page**: implemented and verified against real production data (7 real August locks, 0 demo), full suite green (25/25) — **not committed/pushed yet**, waiting for user approval. Files: `apps/website/app/(dashboard)/locks/page.tsx`, `apps/website/src/domains/smart-devices/components/LocksList.tsx`, plus small additive changes to `packages/ui/src/components/Sidebar.tsx` and `apps/website/src/platform/layout/nav-config.ts`. Homepage (`DashboardSummary.tsx`/`dashboard.service.ts`) deliberately untouched.
- **Standing acceptance gate unchanged** (Increment 23's full checklist still applies): do not say **"Ready for Michelle and Kenny to test"** until every item passes, with email-code login and logout confirmed by the user directly. Not cleared as of this note — `admin@stayawhilewithus.com`'s own login is still outstanding, and a full click-through hasn't happened since the bug fixes landed.
- The large body of previously-uncommitted work (Increments 1–22) is still uncommitted, plus now the `/locks` feature is also uncommitted pending approval. Still lower priority than clearing the acceptance gate.

---

# Notes

- Package manager: pnpm 9.15.0 (installed via `npm install -g pnpm` this session, wasn't preinstalled). Node: v26.5.0 present; `.nvmrc` pins `20.11.0` as the project's nominal target.
- Local Postgres (Homebrew `postgresql@16`) runs as a background service with trust auth on localhost — fine for local dev only, never replicate this auth config anywhere else.
- `packages/database/.env` and `apps/website/.env.local` contain real local Postgres connection strings and placeholder (non-functional) Clerk/n8n secrets — both gitignored, never commit them.
- The plan file with full remaining-refinement content (exact ADR text scope, exact `@stayw/ai` API shapes, exact file lists) is at `/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md` — read it before redoing design work that's already been thought through.
