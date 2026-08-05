# ADR-0006: Domain-driven folder structure for apps/website

## Status

Accepted — 2026-08-06

## Context

`apps/website/src/server/**` organized code by technical layer (services, schemas) rather than business domain. As the platform grows to cover reservations, guests, communications, cleaning, maintenance, tasks, smart devices, integrations, AI, notifications, and audit, a layer-first structure makes it hard to see a domain's full surface area (its model, its permissions, its UI) in one place, and invites cross-domain coupling since nothing signals a boundary.

## Decision

- **`apps/website/src/domains/<domain>/`** owns business logic: `services/<domain>.service.ts` (assertPermission → zod validate → prisma → recordAudit → optional triggerWorkflow → return), `schemas/`, `components/`, `actions.ts` (Server Actions — no `app/` shim needed since only route files themselves must live under `app/`), an optional `ai-tools.ts` registering the domain's capabilities with `@stayw/ai`'s Tool Registry, and a `README.md` (scope, owned model(s), permission keys, routes).
- **`apps/website/src/platform/`** replaces `src/server/` for true cross-cutting infra with no permission check of its own: `auth/get-current-user.ts`, `identity/{verify-clerk-webhook,sync-clerk-user}.ts`, `audit/record-audit.ts`, `notifications/create-notification.ts`, `errors.ts`.
- **Domain vs. cross-cutting tension** (Audit, Notifications, AI, Integrations): the package/platform layer owns the reusable _capability_ (`recordAudit()`, `createNotification()`, `@stayw/ai`, `@stayw/integrations`) with no permission check — it's infra invoked by an already-checked caller. The _domain folder_ owns the human-facing _feature_ built on top (browsing UI, approval queue, connection management), with its own `assertPermission` call, because a human now invokes it directly.
- **Module boundary, enforced**: only `apps/website/src/domains/*/services/**` and `apps/website/src/platform/**` may import `@stayw/database` — a real ESLint `no-restricted-imports` rule in `apps/website/eslint.config.mjs`, not just convention.
- **13 domains total**: `dashboard`, `properties`, `reservations`, `guests`, `communications`, `cleaning`, `maintenance`, `tasks`, `smart-devices`, `integrations`, `ai`, `notifications`, `audit`. Only `properties` is fully migrated in this pass; the other 12 are README-only skeletons (scope/model/permissions documented, no code yet) — no empty placeholder subfolders, since git doesn't track them and there's no defined method surface to stub yet.
- Webhook routes stay thin: `app/api/webhooks/clerk/route.ts` delegates to `platform/identity/`; `app/api/webhooks/n8n/route.ts` delegates to `@stayw/ai-automation`'s `handleN8nCallback()`, giving that package both directions of the n8n integration (trigger + callback) symmetrically.

## Consequences

- A new contributor can open one domain folder and see its entire surface: model ownership, permission keys, services, UI, and (optionally) AI tool registrations — no need to trace through a shared `server/` tree.
- The lint rule makes the module boundary a build failure, not a code-review nit — `@stayw/database` leaking into a component or route file is now caught automatically.
- 12 domains being README-only is real, tracked scope debt, not an oversight — each README documents exactly what's deferred so a future session can migrate one domain at a time without re-deriving scope.
- `@stayw/ai-automation`'s `trigger.ts`/`callback.ts` keep their own direct `prisma`/`recordAudit`-equivalent calls rather than importing the app's `platform/` helpers — packages never depend on the app. This asymmetry predates this refactor and isn't introduced by it.
