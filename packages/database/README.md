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
- `db:studio` — open Prisma Studio
