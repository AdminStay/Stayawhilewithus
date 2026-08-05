# Notifications domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `Notification`
- **Permission keys**: `notifications:read`, `notifications:update`
- **Expected shape when implemented**: `services/notifications.service.ts`, `schemas/notifications.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

**Domain vs. platform split**: `src/platform/notifications/create-notification.ts` is the reusable _capability_ other domains call to create a notification (no permission check — it runs on behalf of an already-checked caller). This domain owns the business-facing feature built on top: the notification center UI (list, mark-read), with its own `assertPermission` call.
