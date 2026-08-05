# ADR-0003: Database and ORM strategy

## Status

Accepted — 2026-08-04

## Context

The platform needs a relational database (properties, reservations, tasks, etc. are inherently relational with strong referential-integrity needs) and a way to define, evolve, and query that schema in a type-safe way from a TypeScript codebase.

## Decision

- **PostgreSQL** via **Supabase** in production; a local PostgreSQL instance for development (this phase used Homebrew-installed PostgreSQL 16 rather than Docker, since Docker wasn't available in the dev environment — functionally equivalent for our purposes; either works for local dev).
- **Prisma** as the ORM: schema-as-code in `packages/database/prisma/schema.prisma`, Prisma Migrate generates versioned SQL migrations in `packages/database/prisma/migrations/`.
- Supabase's connection pooling gotcha is handled explicitly: `DATABASE_URL` (pooled, pgbouncer) is used by the app at runtime; `DIRECT_URL` (direct connection) is used by Prisma Migrate. Both are documented in `.env.example`.
- **No Postgres Row Level Security (RLS) is used.** All database access goes through Prisma from the trusted server-side service layer (`apps/website/src/server/services/**`) using a single application database role. Authorization is enforced exclusively in that service layer via `@stayw/auth` (see ADR-0004), not via RLS policies.

## Consequences

- Prisma gives strong TypeScript DX (generated types, autocomplete, compile-time query safety) and keeps schema + migrations in sync automatically via `prisma migrate dev`.
- Omitting RLS is a deliberate simplification: Supabase users often assume RLS by default (it's Supabase's flagship security feature for client-direct database access), but this platform never accesses Postgres directly from the browser — every request goes through the Next.js server, which already enforces authorization. Adding RLS on top would be redundant defense-in-depth at the cost of real complexity (policy-per-table, harder debugging of "why did this query return nothing"). If a future requirement introduces direct client-to-Supabase access (e.g. Supabase Realtime subscriptions from the browser), RLS must be reconsidered at that time.
- Conventions applied schema-wide: UUID primary keys (`@default(uuid()) @db.Uuid`), `createdAt`/`updatedAt` timestamps on every table, soft delete via nullable `deletedAt` on entities needing reversible deletion (`User`, `Property`, `Guest`), and `snake_case` database mapping via `@@map`/`@map` while Prisma models stay `camelCase`/`PascalCase`.
- **Known limitation**: Postgres treats `NULL` as distinct in unique constraints, so `UserRole`'s `@@unique([userId, roleId, propertyId])` does not prevent a user from accidentally being assigned the exact same _global_ role (`propertyId = null`) twice. This is harmless (the permission set is a union, so a duplicate grants nothing extra) and is accepted as a known limitation rather than solved with a partial unique index in this phase.
