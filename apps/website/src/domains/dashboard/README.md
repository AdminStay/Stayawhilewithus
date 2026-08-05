# Dashboard domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: none — composition root
- **Permission keys**: none of its own; aggregates read-only data via other domains' existing services
- **Expected shape when implemented**: `services/dashboard.service.ts`, `schemas/dashboard.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

Does not own `app/(dashboard)/layout.tsx` (route-group shell chrome) — that stays in `app/`. This domain's future service composes read-only calls into other domains' already-permission-checked services; it never queries Prisma directly.
