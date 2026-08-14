# Guests domain

Status: implemented (list + create). See `apps/website/src/domains/properties/` for the reference pattern this follows.

- **Owned model(s)**: `Guest`
- **Permission keys**: `guests:read`, `guests:create`, `guests:update`, `guests:delete`, `guests:manage` (update/delete/manage not yet wired to UI — service functions can be added when needed)
- **Route**: `/guests`
- **Not yet implemented**: edit/delete guest, linking a guest to `ReservationGuest` (comes with the Reservations domain), no `triggerWorkflow` call yet — no n8n workflow exists for `guest.created` (n8n instance was confirmed empty on 2026-08-06); add one only once a real workflow is built, to avoid spurious `WorkflowExecution` FAILED rows and admin-notification noise.
