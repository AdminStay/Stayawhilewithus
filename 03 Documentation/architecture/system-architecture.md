# System Architecture

This is the top-level map of the StayWhile Operations Platform's architecture as of Phase 1 (Architecture & Foundation). Individual decisions are recorded in `03 Documentation/adr/` — this document synthesizes them into one picture and covers what isn't decision-specific (data flow, folder structure, scalability posture).

## System overview

```mermaid
flowchart LR
    subgraph Client
        Browser
    end

    subgraph "apps/website (Next.js)"
        UI["Dashboard UI\n(Server Components + Server Actions)"]
        API["Route Handlers\n(webhooks, health)"]
        MW["middleware.ts\n(Clerk auth gate)"]
        SVC["Service layer\napps/website/src/server/services"]
    end

    Clerk[("Clerk\n(identity)")]
    DB[("Postgres\n(Supabase)")]
    N8N[("n8n\n(workflow engine)")]
    Claude[("Claude API\n(AI layer)")]
    Providers[["Integration providers\nOwnerRez, Airbnb, Slack,\nAsana, Notion, Gmail,\nGoogle Voice, smart locks/thermostats"]]

    Browser --> MW --> UI
    Browser --> API
    UI --> SVC
    API --> SVC
    SVC -->|"@stayw/database"| DB
    SVC -->|"@stayw/auth: assertPermission"| DB
    SVC -->|"@stayw/ai-automation: triggerWorkflow"| N8N
    N8N -->|"HMAC-signed callback"| API
    MW <-->|verify session| Clerk
    Clerk -->|webhook: user sync| API
    N8N <--> Providers
    SVC -.->|later phases| Claude
```

## Layers

### Frontend

Next.js 15 App Router in `apps/website`, React Server Components by default, Server Actions for mutations, Tailwind CSS (`@stayw/tailwind-config` preset) for styling, `@stayw/ui` for components shared across pages. See ADR-0001.

### Backend

No separate backend service — `apps/website`'s Route Handlers (`app/api/**`) and Server Actions _are_ the backend. See ADR-0001 for the rationale and the explicit revisit trigger.

### Database

PostgreSQL (Supabase in production, local Postgres in dev) via Prisma. Full schema in `packages/database/prisma/schema.prisma`; see `03 Documentation/architecture/erd.md` for the diagram and ADR-0003 for the ORM/RLS decision.

### Authentication & authorization

Clerk for identity, `@stayw/auth` for RBAC, enforced exclusively in the service layer. See ADR-0004.

### AI layer

Claude API integration is scoped for a later phase (AI & Automation, roadmap item 10). The schema already has `AiConversation`/`AiMessage` tables ready (see ERD) so conversation history has a home once that phase starts. Planned shape: AI-assisted guest support and an internal ops assistant, both mediated through the same service-layer/RBAC pattern as everything else — the AI layer does not get a special bypass around authorization.

### Workflow engine

n8n, triggered from the backend via signed webhooks, calling back via a signed webhook. See ADR-0005.

### Integrations

`@stayw/integrations` holds one client folder per provider (OwnerRez, Airbnb, Slack, Asana, Notion, Gmail, Google Voice, Yale, August, Nest, Ecobee, Cielo), all structural stubs in this phase (`NotImplementedError`) — see that package's README. Each provider's `IntegrationConnection` row (schema) tracks connection status and a _reference_ to its credentials (never plaintext tokens in the database — see the field-level comment in `schema.prisma`).

### Background jobs / async work

No separate job queue — n8n handles all of it, per ADR-0001 and ADR-0005.

### Notifications

`Notification` rows are created with `status = PENDING` and follow the same trigger-workflow pattern as any other automation; n8n performs the actual Slack/Email/SMS send and calls back to update status. See the ERD's Notifications section and ADR-0005.

### Audit logging

`AuditLog` is written by every mutating service function (`recordAudit`-shaped call at the end of the business logic step, per the service-layer pattern in `CODING_STANDARDS.md`). Captures actor, action, entity, before/after state, and links to the `WorkflowExecution` that caused it, if any.

## Folder structure

```
apps/website/            Next.js app — dashboard UI + API/webhooks (the only deployable app, see ADR-0001)
packages/database/       Prisma schema, migrations, seed, client singleton
packages/auth/           RBAC engine (permissions catalog, hasPermission/assertPermission)
packages/ui/             Shared React components + Tailwind preset consumers
packages/ai-automation/  triggerWorkflow() + n8n workflow exports
packages/integrations/   One client-stub folder per provider
packages/mcp-servers/    MCP server scaffolding
packages/config/         Shared eslint/typescript/tailwind/vitest configs
03 Documentation/        adr/, architecture/, standards/, roadmap/
```

Module boundary rule: only `apps/website/src/server/services/**` imports `@stayw/database`. See `CODING_STANDARDS.md`.

## Data flow (example: creating a property)

1. Staff member submits the "Add property" form → Server Action (`app/(dashboard)/properties/actions.ts`).
2. Action calls `getCurrentUser()` to resolve the Clerk session to an internal `AuthContext`.
3. Action calls `properties.service.ts#createProperty(actor, input)`.
4. Service asserts `properties:create` permission (`@stayw/auth`, throws `ForbiddenError` if denied).
5. Service validates input with the Zod schema, writes the `Property` row (Prisma), writes an `AuditLog` row, and calls `triggerWorkflow("property.created", ...)`.
6. `triggerWorkflow` writes a `WorkflowExecution` row and POSTs a signed payload to n8n; n8n eventually calls back to `app/api/webhooks/n8n/route.ts`, which updates the `WorkflowExecution` status and writes a follow-up `AuditLog` entry.
7. `revalidatePath` refreshes the properties list; the UI re-renders from the updated `Property` table.

This is the concrete, working reference flow — see `apps/website/app/(dashboard)/properties/` for the actual code.

## Security model

- **Coarse gate**: `middleware.ts` requires a signed-in Clerk session for every route except sign-in/sign-up/webhooks/health.
- **Fine-grained authorization**: exclusively in the service layer via `@stayw/auth`, never in middleware or UI code. See ADR-0004.
- **No RLS**: authorization is application-layer only, since the database is never reached directly from the browser. See ADR-0003.
- **Webhook security**: Clerk webhooks are Svix-verified; n8n webhooks (both directions) are HMAC-SHA256 verified with a shared secret, timing-safe compared.
- **Credentials**: third-party integration credentials are never stored in plaintext in the database (`IntegrationConnection.credentialsRef` is a reference into a secrets store, to be selected when the first real integration ships).
- **Audit trail**: every mutation is attributable (`AuditLog.actorUserId`/`actorType`) and traceable to its automation side effects (`workflowExecutionId`).

## Scalability considerations

- **Serverless-friendly by construction**: no in-process job queue or long-lived state in `apps/website` (n8n owns all async work), so the app scales horizontally without sticky-session concerns.
- **Known future scaling items** (explicitly deferred, not solved in Phase 1):
  - `AuditLog` and `SmartDeviceEvent` will grow large; retention/partitioning strategy needed once volume is real.
  - If webhook/streaming needs outgrow serverless Route Handlers, promote a dedicated `apps/backend` (ADR-0001's revisit trigger).
  - Per-request permission lookups are memoized within a request (React `cache()`) but not cached across requests — acceptable at current scale, worth revisiting if RBAC checks become a hot path.
- **Multi-tenancy is explicitly out of scope** (ADR-0002) — the schema and RBAC model are simpler as a result, at the cost of a real migration if that requirement ever appears.

## What's built vs. deferred (Phase 1 status)

Built and verified in this phase: monorepo tooling, full Prisma schema + migration + seed (verified against a real local Postgres instance), `@stayw/auth` RBAC engine (unit-tested + verified against seeded data), Clerk integration code (sign-in/sign-up pages, webhook sync, JIT fallback — boots correctly, full round-trip pending real Clerk keys), the event-driven workflow trigger/callback plumbing, a working end-to-end vertical slice (Properties), structural scaffolds for integrations and MCP servers, coding standards, and CI.

Deferred to later phases: every real integration implementation, the AI layer, an admin UI for role management, real Supabase/Clerk credentials, and all feature work per the roadmap. See `HANDOFF.md` for the exact next steps.
