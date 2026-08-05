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

**Status:** The paused refinement work is done and verified (`lint typecheck test build` all green). Git is caught up through this session's tooling/app-code/docs commits made at the start of the 2026-08-06 session — **but this session's own new work (packages/ai, mcp-servers wiring, ADRs 0006-0008, updated docs) is not yet committed** — see "Risks" below. Ready to move to the next priority: credential setup, n8n workflow building, or OwnerRez integration, per user direction.

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

## n8n Instance Discovery — ✅ done (2026-08-06)

Full findings in `N8N_DISCOVERY.md`. Summary: the instance is **effectively empty** — one auto-generated default workflow ("My workflow": manual trigger → unconfigured HTTP Request, inactive, never touched), no tags, no folders beyond the single personal project, and only 3 credentials on file (`Notion account`, `Anthropic account`, `Header Auth account` — no OwnerRez/Slack/Gmail/etc. yet). **Safe to build new workflows without risk of colliding with or duplicating prior work.**

---

# What Is Blocked / Needs Verification First

1. ✅ **n8n MCP tools verified working** (2026-08-06 session). `search_workflows`, `list_credentials`, `get_workflow_details`, `list_tags`, `search_projects` all returned real data — the connection is fully functional, not just account-level.
2. ✅ **OwnerRez confirmed as production data** (2026-08-06 session — user answered directly after being asked a third time). All OwnerRez work must treat reservation/guest records as real. Read-only until the user explicitly authorizes writes.
3. **No OwnerRez PAT is configured anywhere in this codebase.** The user was told explicitly not to paste it into chat; it was never provided by any other channel either. It needs to go into `.env.local`/`.env` (gitignored) before the OwnerRez client can be implemented for real.
4. **`packages/ai` doesn't exist yet.** "Build AI automations using Claude" (one of the user's 10 implementation directives) has no foundation to build on until the paused AI-platform-layer work (schema migration + package scaffold) is finished.

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

- ✅ **RESOLVED (2026-08-06, start of session)**: all prior uncommitted work (original Phase 1, the full DDD/SDK refinement scaffolding, all documentation) is committed to git in three commits (tooling/config, application code, documentation) on `main`. Not yet pushed to `origin` — only a local commit was requested/authorized.
- ⚠️ **NEW as of end of this same session**: the actual architectural-refinement _completion_ work done in this session (packages/ai, mcp-servers wiring, properties.list AI tool, ADRs 0006-0008, updated system-architecture.md/erd.md, permissions/seed changes, the new Prisma migration) is **not yet committed** — `git status` will show it as modified/untracked. Low risk (everything is verified working), but the next session should confirm with the user and commit before building further on top, for the same reason as the original risk below.
- ✅ **RESOLVED (2026-08-06)**: n8n's existing state is now known — see "n8n Instance Discovery" above and `N8N_DISCOVERY.md`. It's empty; safe to build on.
- **The OwnerRez sandbox-vs-production question is a real operational risk** if ignored: testing "reservation sync" against unconfirmed production data could read or (eventually) write real guest/reservation records.
- `schema.prisma` currently has changes (the `AiAction` model, new enums) that are validated but **not migrated** — if another session or tool runs a fresh `prisma migrate dev` without realizing this, double check no conflicting concurrent schema edits have occurred.
- The three audit documents (`INTEGRATION_INVENTORY.md`, `SECURE_CONFIGURATION_CHECKLIST.md`, `N8N_DISCOVERY.md`) are mostly `TBD`/skeleton — don't mistake their existence for completeness.
- Clerk is still running on placeholder (non-functional) API keys; full sign-in has never been tested end-to-end with real credentials.

---

# Exact Next Steps For The New Session

1. Start the new session in this same project directory.
2. Confirm n8n MCP tool availability still holds (was verified working 2026-08-06; re-verify if this is a materially later session).
3. Recommend committing this session's new work (packages/ai, mcp-servers, ADRs, docs) early, given the risk noted above.
4. Ask the user to pick the next priority from "Remaining Implementation Tasks" items 4/6/9/10 (credential setup, OwnerRez real integration, real Claude wiring, or building actual n8n workflows) — all four are now unblocked and it's the user's call to sequence.

---

# Notes

- Package manager: pnpm 9.15.0 (installed via `npm install -g pnpm` this session, wasn't preinstalled). Node: v26.5.0 present; `.nvmrc` pins `20.11.0` as the project's nominal target.
- Local Postgres (Homebrew `postgresql@16`) runs as a background service with trust auth on localhost — fine for local dev only, never replicate this auth config anywhere else.
- `packages/database/.env` and `apps/website/.env.local` contain real local Postgres connection strings and placeholder (non-functional) Clerk/n8n secrets — both gitignored, never commit them.
- The plan file with full remaining-refinement content (exact ADR text scope, exact `@stayw/ai` API shapes, exact file lists) is at `/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md` — read it before redoing design work that's already been thought through.
