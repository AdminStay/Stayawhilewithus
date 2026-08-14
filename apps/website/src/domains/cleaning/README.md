# Cleaning domain

Status: implemented (list + create + complete + reschedule). See `apps/website/src/domains/properties/` for the reference pattern this follows.

- **Owned model(s)**: `CleaningSchedule`
- **Permission keys**: `cleaning_schedules:read`, `cleaning_schedules:create`, `cleaning_schedules:update`, `cleaning_schedules:delete`, `cleaning_schedules:manage` (delete/manage not yet wired to UI — service functions can be added when needed)
- **Route**: `/cleaning`
- **Rescheduling**: `rescheduleCleaningSchedule` moves `scheduledDate`, records the very first original date in `originalScheduledDate` (subsequent reschedules don't overwrite it — see the field's doc comment on the Prisma model), keeps the backing `Task.dueAt` in sync in the same transaction, and is a no-op (no write, no audit entry) if the new date matches the current one. Surfaced on `/cleaning` (inline per-row form) and on the main dashboard's "Rescheduled Cleanings" section.
- **Not yet implemented**: cancelling a schedule (`CANCELLED`/`MISSED` statuses exist on the model but nothing sets them yet), no `triggerWorkflow` call yet — no n8n workflow exists for `cleaning_schedule.created`/`.completed` (n8n instance confirmed empty 2026-08-06; n8n MCP connection itself is not currently available this session — see `HANDOFF.md`).

Cleaning-specific detail (scheduled times, cleaning type) on top of the shared `Task` assignment record — see `03 Documentation/architecture/erd.md` for the Task/CleaningSchedule/MaintenanceRequest relationship. `createCleaningSchedule` creates the backing `Task` (type `CLEANING`) and the `CleaningSchedule` row together in a single `prisma.$transaction`, since `CleaningSchedule.taskId` is a required unique FK. `completeCleaningSchedule` likewise updates both rows (`CleaningSchedule.status → COMPLETED`, `Task.status → DONE`) in one transaction.
