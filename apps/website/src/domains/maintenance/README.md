# Maintenance domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `MaintenanceRequest`
- **Permission keys**: `maintenance_requests:read`, `maintenance_requests:create`, `maintenance_requests:update`, `maintenance_requests:delete`, `maintenance_requests:manage`
- **Expected shape when implemented**: `services/maintenance.service.ts`, `schemas/maintenance.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

Maintenance-specific detail (category, severity, resolution notes) on top of the shared `Task` assignment record — see `03 Documentation/architecture/erd.md`.
