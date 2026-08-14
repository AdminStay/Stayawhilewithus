# Maintenance domain

Status: implemented — list + create + resolve, `/maintenance` route.

- **Owned model(s)**: `MaintenanceRequest`
- **Permission keys**: `maintenance_requests:read`, `maintenance_requests:create`, `maintenance_requests:update`, `maintenance_requests:delete`, `maintenance_requests:manage`
- **Shape**: `services/maintenance.service.ts` (`listMaintenanceRequests`, `createMaintenanceRequest`, `resolveMaintenanceRequest`), `schemas/maintenance.schema.ts`, `components/` (`MaintenanceRequestList`, `CreateMaintenanceRequestForm`), `actions.ts`.

Maintenance-specific detail (category, severity, resolution notes) on top of the shared `Task` assignment record — see `03 Documentation/architecture/erd.md`. Unlike `CleaningSchedule`, `MaintenanceRequest.taskId` is an **optional** 1:1 FK, so `createMaintenanceRequest` never creates a backing `Task` — a request is a standalone report (`OPEN`) until someone assigns a `Task` to work it. Task assignment/linking is deliberately deferred (not needed for this vertical slice), matching the "ship the slice, extend later" pattern used elsewhere (e.g. Cleaning's `CANCELLED`/`MISSED` statuses). `resolveMaintenanceRequest` sets `status=RESOLVED`, `resolvedAt`, and optional `resolutionNotes`. No `triggerWorkflow` call yet — same n8n deferral reasoning as every other Increment 1 domain (no `maintenance_request.created`/`.resolved` workflow exists in n8n yet).
