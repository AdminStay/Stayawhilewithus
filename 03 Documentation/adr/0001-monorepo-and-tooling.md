# ADR-0001: Monorepo structure, tooling, and no separate backend service

## Status

Accepted — 2026-08-04

## Context

The platform needs to house a dashboard UI, an API/webhook surface, a growing set of third-party integration clients, MCP servers, and n8n-triggering automation code, while staying maintainable by a small team over years. We needed to decide: single app vs. monorepo, and whether "backend" deserves its own deployable service from day one.

## Decision

- **Monorepo** using Turborepo + pnpm workspaces. Two workspace roots: `apps/*` (deployable applications) and `packages/*` (shared, non-deployable code), plus `packages/config/*` for shared tooling config.
- **`apps/website`** (Next.js, App Router) is the _only_ deployable app for this phase. It serves the dashboard UI and the entire API/webhook surface via Route Handlers and Server Actions — there is no separate `apps/backend`.
- Shared code is split by concern into packages: `@stayw/database` (Prisma), `@stayw/auth` (RBAC), `@stayw/ui` (components), `@stayw/ai-automation` (n8n triggering), `@stayw/integrations` (provider clients), `@stayw/mcp-servers` (MCP servers), and `@stayw/{eslint,typescript,tailwind,vitest}-config` (shared tooling).
- The original empty `Backend/` placeholder folder is retired.

## Consequences

- One deployable target minimizes operational overhead for a single-tenant, internal tool — consistent with the README's "simplicity over complexity" principle.
- All async/scheduled work is delegated to n8n (see ADR-0005), so there's no need for a long-running Node process to host a job queue or worker independent of the Next.js app.
- MCP servers are independent long-running processes by nature (stdio/SSE transports) and already live in their own package — they are not "the backend," they're a separate integration surface.
- **Revisit trigger**: if the platform later needs persistent WebSocket/streaming connections (e.g. live smart-device event streams, live chat) or webhook volume/latency exceeds what serverless/edge Route Handlers comfortably provide, promote a slice into a dedicated `apps/backend` at that time. This is an explicit, anticipated seam — not a decision we expect to hold forever.
- Every new package must be added to `pnpm-workspace.yaml`'s glob patterns and given its own `package.json`, `tsconfig.json` (extending `@stayw/typescript-config`), and `eslint.config.js` (extending `@stayw/eslint-config`) for the shared tooling to pick it up.
