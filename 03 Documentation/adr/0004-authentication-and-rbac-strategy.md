# ADR-0004: Authentication and RBAC strategy

## Status

Accepted — 2026-08-04

## Context

The platform needs to know who a user is (authentication) and what they're allowed to do (authorization), with the security model built first so every subsequent feature respects it, per the project's stated development principles. StayWhile ops staff (cleaners, maintenance techs, front desk) are typically assigned to a subset of properties, while managers/admins need reach across the whole portfolio.

## Decision

- **Clerk** handles identity only. No Clerk Organizations are used (single-tenant, per ADR-0002).
- **Dual-path identity sync**: primary path is Clerk webhooks (`user.created`/`user.updated`/`user.deleted`, Svix-verified) upserting into the internal `User` table; `user.deleted` soft-deletes (`status = DEACTIVATED`, `deletedAt` set) rather than hard-deleting, to preserve foreign-key integrity with `AuditLog`, `Task`, etc. Fallback path is `getCurrentUser()`, called at the start of every request needing an `AuthContext`, which just-in-time provisions the `User` row via Clerk's backend API if a webhook hasn't landed yet — no request fails purely due to webhook delivery timing.
- **`@stayw/auth`** is the sole authorization mechanism: `assertPermission(actor, permissionKey, { propertyId? })` and `hasPermission(...)`. Roles are **never** synced from Clerk — `UserRole` is fully internal, managed by admins.
- **Enforcement lives exclusively in the service layer** (`apps/website/src/server/services/**`), never in middleware. `middleware.ts` only gates coarse "must be signed in" (via `clerkMiddleware()` + `auth.protect()`). This is defense-in-depth with a single source of truth: every mutating or data-returning service function starts with an `assertPermission` call, so a request can never bypass authorization by hitting a different entry point.
- **Property-scoped roles**: `UserRole.propertyId` is nullable — `null` means a global role assignment (matches on any permission check regardless of property), a set value means the role only applies when checking permissions for that specific property. A single `UserRole` table models both cases rather than having separate global-role and property-role tables, since the permission-granting logic (via `RolePermission`) is identical either way — only the _scope_ of the match differs.

## Consequences

- Identity and authorization are cleanly separated: swapping Clerk for another auth provider later would only require changing the sync path and `getCurrentUser()`, not the RBAC model.
- Because enforcement is server-side and centralized, there's no way for a new page or API route to accidentally skip authorization — the pattern is "call the service function," and the service function itself refuses unauthorized calls.
- Property-scoped roles let StayWhile assign a cleaner to exactly the properties they work at, without needing per-property role definitions (`cleaner` is one row in `Role`, assigned N times with different `propertyId`s).
- Full Clerk sign-in/webhook verification is deferred until real Clerk API keys are provided (this phase used placeholder keys sufficient to boot the app and prove the middleware gate is active) — see `HANDOFF.md` for what's pending.
