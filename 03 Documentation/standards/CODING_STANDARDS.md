# Coding Standards

These conventions exist so the codebase stays maintainable across years and multiple contributors (human or AI). They're enforced where possible (ESLint rules, TypeScript config, CI) rather than left as tribal knowledge.

## Naming

- **Files**: kebab-case (`properties.service.ts`, `get-current-user.ts`), except React components which are PascalCase (`PropertyCard.tsx`).
- **TypeScript**: `camelCase` for variables/functions, `PascalCase` for types/interfaces/components/classes, `SCREAMING_SNAKE_CASE` for module-level constants and env var keys.
- **Prisma**: models are `PascalCase` singular (`Property`), mapped via `@@map` to `snake_case` plural tables (`properties`); fields are `camelCase`, mapped via `@map` to `snake_case` columns.
- **Permission keys**: `resource:action` (e.g. `reservations:read`), resources are `snake_case` plural, actions are one of `create | read | update | delete | manage`.
- **Audit actions**: `entity.verb` (e.g. `reservation.created`, `workflow.trigger_failed`).
- **Git**: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`, `docs:`, `test:`); branches `feat/<slug>`, `fix/<slug>`, `chore/<slug>`.

## Domain-driven organization

The app is organized around business domains, not technical layers — see `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- `apps/website/src/domains/<domain>/` owns a business domain's `services/`, `schemas/`, `components/`, `actions.ts`, and tests. Every domain has a `README.md` stating its scope, owned Prisma model(s), and permission keys.
- `apps/website/src/platform/` holds true cross-cutting infrastructure with no permission checks of its own (`auth/get-current-user.ts`, `identity/` for Clerk webhook verification/sync, `audit/record-audit.ts`, `notifications/create-notification.ts`, `errors.ts`) — invoked _by_ an already-permission-checked domain service, never called directly by UI code.
- **Reconciliation rule** for domains that look cross-cutting (Audit, Notifications, AI, Integrations): the package or `platform/` helper owns the reusable _capability_ (`recordAudit()`, `createNotification()`, `@stayw/ai`, `@stayw/integrations`); the `domains/<name>/` folder owns the business-facing _feature_ built on top of it (browsing UI, approval queue, connection management), with its own `assertPermission` call because a human now invokes it directly.
- `app/` stays a thin routing shell: `page.tsx`/`layout.tsx`/`route.ts` files that compose components and call service functions from `src/domains/**`, nothing else. Server Actions don't need an `app/`-level shim — only the route file itself must physically live under `app/`; the action implementation can live in the domain folder. Route Handlers (webhooks etc.) do need a thin file under `app/api/**` (URL resolution requires it), but the actual logic lives in `src/platform/**` or the relevant package.
- Import touched files via the `@/*` path alias (`@/domains/...`, `@/platform/...`) rather than relative `../../../` paths.

## Module & import boundaries

- Only `apps/website/src/domains/*/services/**` and `apps/website/src/platform/**` may import `@stayw/database`. UI components, schemas, and actions never touch Prisma directly — they call a service function or read data a service already fetched. Enforced by a `no-restricted-imports` ESLint rule in `apps/website/eslint.config.mjs`, not just convention.
- Components needing a Prisma-derived type import it from the owning domain's service module (which re-exports it), not from `@stayw/database` directly — keeps the boundary rule meaningful for type imports too.
- Shared logic that more than one app/package needs goes in `packages/*`. App-specific logic stays in `apps/website/src`.
- A package only depends on packages "below" it in the stack: `database` → `auth` / `ai-automation` / `ai` → app. No circular workspace dependencies. Packages never import from `apps/website` (e.g. `@stayw/ai-automation`'s webhook/audit writes use its own direct Prisma calls rather than the app's `platform/` helpers).

## Service layer pattern

Every mutating or permission-gated operation is a function in `apps/website/src/domains/<domain>/services/<domain>.service.ts` with this shape:

```ts
export async function createProperty(actor: AuthContext, rawInput: CreatePropertyInput) {
  await assertPermission(actor, "properties:create");          // 1. permission check
  const input = createPropertySchema.parse(rawInput);           // 2. validate
  const record = await prisma.property.create({ data: input }); // 3. business logic
  await recordAudit({ action: "property.created", ... });        // 4. audit write (platform helper)
  await triggerWorkflow({ workflowName: "property.created", ... }); // 5. optional workflow trigger
  return record;                                                  // 6. typed return
}
```

Signature convention: `async function verbNoun(actor: AuthContext, input: SomeInput): Promise<SomeReturn>`. Read-only functions skip steps 2/4/5 but keep the permission check first.

See `apps/website/src/domains/properties/services/properties.service.ts` for the reference implementation.

## API patterns

- **Server Actions** (`"use server"`) are the default for dashboard mutations — colocated in the domain folder (`domains/<domain>/actions.ts`), fully typed, no manual fetch/JSON plumbing. See `apps/website/src/domains/properties/actions.ts`.
- **Route Handlers** (`app/api/**/route.ts`) are reserved for webhooks (Clerk, n8n, future provider webhooks) and any consumer that isn't the Next.js app itself, and stay thin delegators to `src/platform/**` or a package (see `app/api/webhooks/n8n/route.ts` → `@stayw/ai-automation`'s `handleN8nCallback()`). They return a consistent envelope: `{ data, error }`, using `toErrorResponse()` (`apps/website/src/platform/errors.ts`) to map thrown errors to the right status code.

## Validation

- Every service function's input is a Zod schema, colocated in `apps/website/src/domains/<domain>/schemas/<domain>.schema.ts`.
- `z.infer<typeof schema>` is the canonical type for that input — never hand-write a duplicate interface.
- Validate at the boundary (start of the service function, or start of the route handler for webhook payloads), not deeper in the call stack.

## Error handling

- Typed error classes only: `AppError` (base), `NotFoundError`, `ValidationError`, `ConflictError`, `ExternalServiceError` (`apps/website/src/platform/errors.ts`), and `ForbiddenError` (`@stayw/auth`).
- Never let a raw Prisma error or third-party SDK error reach a client response — catch and rethrow as one of the above, or let `toErrorResponse()` map it to a generic 500 with the details logged server-side only.
- Log unexpected (non-`AppError`) errors with `console.error` before returning a generic message — never leak internals in the response body.

## Testing

- **Vitest** for unit tests: service functions (mock `@stayw/database`), RBAC branch logic (`packages/auth/src/rbac.test.ts` is the reference), Zod schema parsing, integration client response parsing against recorded fixtures — **never** live third-party API calls in CI.
- **Playwright** for the small set of critical end-to-end flows (auth round-trip, one golden-path flow per major feature) — not exhaustive UI coverage.
- Minimum bar: every RBAC branch (granted / denied, global / property-scoped) and every state-transition (e.g. task status, workflow execution status) has a test.

## Documentation

- Every package **and every domain folder** has a `README.md`: what it's for, how to use its public exports (or, for a domain, its scope/owned model/permission keys), where to look for more detail.
- Exported service functions carry a one-line TSDoc noting required permission(s) and side effects (audit write, workflow trigger) when non-obvious from the code.
- Architecture-level decisions go in `03 Documentation/adr/` (Nygard format: Status / Context / Decision / Consequences) — not in code comments, and not re-explained inline once an ADR exists.

## Environment & config

- Every env var consumed anywhere in the app is declared in `apps/website/env.ts` (Zod-validated) and documented in the root `.env.example` with a comment.
- `env.ts` fails fast on boot (throws with a clear message) rather than surfacing as an obscure runtime error deep in a request handler.
- Secrets are never committed. `.env*` (except `.env.example`) is gitignored at every directory level.
