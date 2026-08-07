# @stayw/database

Prisma schema, migrations, and the shared `PrismaClient` singleton for the StayWhile Operations Platform.

- Schema: `prisma/schema.prisma`
- Migrations: `prisma/migrations/`
- Seed: `prisma/seed.ts` (roles, permission catalog, role-permission grants, bootstrap admin user)

## Usage

```ts
import { prisma } from "@stayw/database";
```

Only import this package from server-side code (`src/server/**` in `apps/website`). See `03 Documentation/standards/CODING_STANDARDS.md` for the import-boundary rule.

## Commands

Run from repo root or with `pnpm --filter @stayw/database <script>`:

- `db:generate` — regenerate the Prisma client
- `db:migrate` — create/apply a dev migration
- `db:migrate:deploy` — apply pending migrations (CI/prod)
- `db:reset` — drop, recreate, migrate, and seed the dev database
- `db:seed` — run the seed script
- `db:grant-role -- --email <email> --role <roleName> [--property <propertyId>]` — grant a role to an existing user. See "Granting roles to new users" below.
- `db:studio` — open Prisma Studio

## Granting roles to new users

Signing in via Clerk only authenticates and creates/links a `User` row (see `apps/website/src/platform/auth/get-current-user.ts`) — it never grants a role. A brand new sign-in has zero `UserRole` rows and will get `ForbiddenError` from every domain service's `assertPermission()` call until an operator explicitly grants one. This is deliberate: authentication and authorization are kept separate, and no login path silently makes someone an admin.

There is no admin UI for this yet (tracked as a real gap, not an oversight). Until one exists, grant roles via:

```
pnpm --filter @stayw/database db:grant-role -- --email someone@example.com --role admin
```

The user must have signed in at least once already (so their `User` row exists). Valid role names: `admin`, `ops_manager`, `cleaner`, `maintenance_tech`, `front_desk`, `read_only` (see `prisma/seed.ts`'s `SYSTEM_ROLES`, or query the `roles` table). Idempotent — running it again for a role the user already has is a no-op.
