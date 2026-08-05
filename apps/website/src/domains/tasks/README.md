# Tasks domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `Task`
- **Permission keys**: `tasks:read`, `tasks:create`, `tasks:update`, `tasks:delete`, `tasks:manage`
- **Expected shape when implemented**: `services/tasks.service.ts`, `schemas/tasks.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

Owns the canonical assignment/status record shared by the Cleaning and Maintenance domains (each of those owns a 1:1 detail table linked via a unique FK to `Task`).
