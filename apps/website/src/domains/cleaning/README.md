# Cleaning domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `CleaningSchedule`
- **Permission keys**: `cleaning_schedules:read`, `cleaning_schedules:create`, `cleaning_schedules:update`, `cleaning_schedules:delete`, `cleaning_schedules:manage`
- **Expected shape when implemented**: `services/cleaning.service.ts`, `schemas/cleaning.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

Cleaning-specific detail (scheduled times, cleaning type) on top of the shared `Task` assignment record — see `03 Documentation/architecture/erd.md` for the Task/CleaningSchedule/MaintenanceRequest relationship.
