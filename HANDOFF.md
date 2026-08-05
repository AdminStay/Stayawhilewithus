# StayWhile Operations Platform

## Session Handoff & Continuity Log

> Update this file at the end of every development session. Read it before starting the next one. It is the project's working memory across conversations.

---

# ⚠️ Workspace Isolation — Read First

**This workspace belongs exclusively to StayWhile.** Per `CLAUDE.md`: never reference, import, reuse, or expose information from another client workspace, and never reuse StayWhile-specific code, data, or documentation in another client's project. If a future session (or the audit methodology developed here) is reused elsewhere, only the _process/template_ travels — never this workspace's actual data, credentials, architecture specifics, or file contents. No other client's workspace should ever be read from or written to during a StayWhile session, and vice versa.

---

# Project Status

## Current Phase

Phase 1 (Architecture & Foundation) is functionally complete, followed by a same-phase **architectural refinement** (Domain-Driven Design reorganization + AI platform layer + Integration SDK) that is **partially complete — paused mid-refinement**, followed by a **technology/integration audit that was started and then explicitly abandoned by the user** in favor of jumping to implementation, followed by **n8n MCP connection setup**, which succeeded but could not be used in that session.

**Status:** Paused between work streams. Nothing is broken, but nothing has been committed to git yet — see "Risks" below.

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

3. **AI platform layer — ⚠️ paused, partially done.**
   - **Done:** `packages/database/prisma/schema.prisma` has a new `AiAction` model (Action Approval Framework — pending/approved/rejected/executed AI-proposed actions) plus `AiActionStatus`/`AiActionRiskLevel` enums, `ActorType.AI`, `NotificationType.AI_ACTION_PENDING`, and the `AiConversation`/`User` reverse relations. **`prisma validate` passes** — the schema file is internally consistent.
   - **Not done:** the migration has **not been run** against the database (`prisma migrate dev --name add_ai_action_approval_framework` is the pending command — additive-only, safe, but not yet executed). `packages/auth/src/permissions.ts` and `prisma/seed.ts` have **not** been updated with the new `ai_actions` resource/permissions yet. The new `packages/ai` (`@stayw/ai`) package itself — Context Engine, Knowledge Retrieval stub, Prompt Library, MCP Tool Registry, Orchestrator, Conversation Context, Action Approval Framework functions — **has not been scaffolded at all**. `packages/mcp-servers`' tool-registry wiring is also not started.
   - **ADRs 0006 (DDD), 0007 (AI platform), 0008 (Integration SDK) have not been written yet**, nor have `system-architecture.md`/`erd.md` been updated to reflect any of this session's refinement work. This is real documentation debt — the approved plan (`/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md`) has the exact content to write.

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

1. **New session bootstrap**: verify n8n MCP tools are actually loaded (see "What Is Blocked," item 1). If not working, debug before anything else.
2. **Finish the paused architectural refinement** (recommended before AI/integration feature work, since later work depends on it):
   - Run `prisma migrate dev --name add_ai_action_approval_framework` (additive-only, safe).
   - Add `ai_actions` resource + `ops_manager` grants to `packages/auth/src/permissions.ts` and `prisma/seed.ts`; re-seed.
   - Scaffold `packages/ai` (`@stayw/ai`): Context Engine, Prompt Library, Tool Registry, Orchestrator (stub Claude call), Conversation Context, Action Approval Framework — with tests. Knowledge Retrieval stays a stub.
   - Wire `packages/mcp-servers/src/shared/register-tools.ts` to the new Tool Registry.
   - Write ADR-0006, ADR-0007, ADR-0008; update `system-architecture.md` and `erd.md` to reflect the DDD/AI/SDK changes. (Full content already scoped in `/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md`.)
   - Full monorepo verification pass (`lint typecheck test build`).
3. **Credential setup**: get the OwnerRez PAT into `.env.local`/`.env` (never into git, never pasted into chat). Confirm OwnerRez sandbox-vs-production before any sync testing.
4. **n8n discovery (resumed, via MCP this time, not the abandoned manual interview)**: inspect existing workflows, credentials, webhooks, connected services directly through the n8n MCP tools before building anything new. Update `N8N_DISCOVERY.md` with what's actually found.
5. **OwnerRez v2 API integration**: implement `packages/integrations/src/ownerrez/client.ts` for real (currently a structural stub). Build and test reservation synchronization — read-only first, given the unresolved sandbox/production question.
6. **Webhook listeners** where OwnerRez/other providers support them (`WebhookReceivable` capability already modeled in the SDK).
7. **Connect the dashboard backend** to real synced data (extends the `domains/reservations/`, `domains/properties/` pattern already established).
8. **AI automations using Claude** — depends on step 2's `packages/ai` work being done first.
9. Continue the platform-by-platform audit interview for the remaining platforms (Airbnb, Slack, Asana, Notion, Gmail, Google Voice, GitHub, Supabase, Vercel, Claude API, MCP Servers, Yale, August, Nest, Ecobee, Honeywell, Cielo) **if/when the user wants it resumed** — it was explicitly deprioritized, not cancelled.

---

# Assumptions Made

- OwnerRez reservation-sync testing will hit **production data** — confirmed directly by the user 2026-08-06, no longer an assumption.
- n8n is **Cloud-hosted**, not self-hosted (inferred from the registered MCP server's URL).
- The audit's "skip remaining" instruction applies to the **interview process**, not to the two safe artifacts already created (`INTEGRATION_INVENTORY.md`, `SECURE_CONFIGURATION_CHECKLIST.md`) — those stay as living documents to fill in opportunistically during implementation, not deleted.
- "Take over implementation" and "only ask for approval before destructive changes" is scoped to **this project's own resources** (its database, its repo, its n8n workflows) — it does not extend to skipping confirmation for genuinely irreversible or cross-system actions (e.g. force-pushes, dropping tables, production data mutations) per this assistant's standing safety practice, which the user has not overridden.
- Local Postgres (Homebrew, not Docker) remains an acceptable dev substitute per ADR-0003; production still targets Supabase.

---

# Risks & Warnings

- ✅ **RESOLVED (2026-08-06)**: all prior uncommitted work (original Phase 1, the full DDD/SDK refinement, all documentation) is now committed to git in three commits (tooling/config, application code, documentation) on `main`. Not yet pushed to `origin` — only a local commit was requested/authorized.
- ✅ **RESOLVED (2026-08-06)**: n8n's existing state is now known — see "n8n Instance Discovery" above and `N8N_DISCOVERY.md`. It's empty; safe to build on.
- **The OwnerRez sandbox-vs-production question is a real operational risk** if ignored: testing "reservation sync" against unconfirmed production data could read or (eventually) write real guest/reservation records.
- `schema.prisma` currently has changes (the `AiAction` model, new enums) that are validated but **not migrated** — if another session or tool runs a fresh `prisma migrate dev` without realizing this, double check no conflicting concurrent schema edits have occurred.
- The three audit documents (`INTEGRATION_INVENTORY.md`, `SECURE_CONFIGURATION_CHECKLIST.md`, `N8N_DISCOVERY.md`) are mostly `TBD`/skeleton — don't mistake their existence for completeness.
- Clerk is still running on placeholder (non-functional) API keys; full sign-in has never been tested end-to-end with real credentials.

---

# Exact Next Steps For The New Session

1. Start the new session in this same project directory.
2. Immediately verify n8n MCP tool availability (`ToolSearch` or equivalent) — do not assume.
3. Ask the user (still unanswered): OwnerRez sandbox or production?
4. Propose resuming the paused architectural refinement (item 2 in "Remaining Implementation Tasks") before diving into n8n workflow building, since the AI-automation work depends on it — but this is the user's call to sequence, not a hard requirement.
5. Once n8n MCP tools are confirmed working, inspect existing n8n workflows/credentials/webhooks before creating anything new.
6. Recommend committing the current working tree to git early in the new session, given the risk noted above.

---

# Notes

- Package manager: pnpm 9.15.0 (installed via `npm install -g pnpm` this session, wasn't preinstalled). Node: v26.5.0 present; `.nvmrc` pins `20.11.0` as the project's nominal target.
- Local Postgres (Homebrew `postgresql@16`) runs as a background service with trust auth on localhost — fine for local dev only, never replicate this auth config anywhere else.
- `packages/database/.env` and `apps/website/.env.local` contain real local Postgres connection strings and placeholder (non-functional) Clerk/n8n secrets — both gitignored, never commit them.
- The plan file with full remaining-refinement content (exact ADR text scope, exact `@stayw/ai` API shapes, exact file lists) is at `/Users/kristinejoyreyes/.claude/plans/memoized-baking-otter.md` — read it before redoing design work that's already been thought through.
