# Tasks domain

Status: implemented (list + create + complete). See `apps/website/src/domains/properties/` for the reference pattern this follows.

- **Owned model(s)**: `Task`
- **Permission keys**: `tasks:read`, `tasks:create`, `tasks:update`, `tasks:delete`, `tasks:manage` (delete/manage not yet wired to UI — service functions can be added when needed)
- **Route**: `/tasks`
- **Not yet implemented**: edit/reassign task, task-to-`CleaningSchedule`/`MaintenanceRequest` linkage (comes with those domains), Asana sync (`asanaTaskId` column exists but unused), no `triggerWorkflow` call yet — no n8n workflow exists for `task.created`/`task.completed` (n8n instance was confirmed empty on 2026-08-06, and the MCP connection itself is not currently available this session — see `HANDOFF.md`); add workflow triggers only once real workflows exist, to avoid spurious `WorkflowExecution` FAILED rows and admin-notification noise.

Owns the canonical assignment/status record shared by the Cleaning and Maintenance domains (each of those owns a 1:1 detail table linked via a unique FK to `Task`).
