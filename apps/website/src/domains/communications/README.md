# Communications domain

Status: implemented — list threads + start thread + reply, `/communications` route.

- **Owned model(s)**: `MessageThread`, `Message`
- **Permission keys**: `messages:read`, `messages:create`, `messages:update`, `messages:delete`, `messages:manage`
- **Shape**: `services/communications.service.ts` (`listMessageThreads`, `createMessageThread`, `sendMessage`), `schemas/communications.schema.ts`, `components/` (`MessageThreadList`, `CreateMessageThreadForm`), `actions.ts`.

Folder name intentionally differs from the permission resource name (`messages`, not `communications`) — the resource name matches the owned model, the folder name matches the user-facing feature area.

All threads created through this slice are `channel: "IN_APP"` — Slack/Gmail/Google Voice are external channels that plug in via `@stayw/integrations` + n8n once their credentials exist (Increment 2), not this domain. `createMessageThread` creates the `MessageThread` and its first `Message` together in one `prisma.$transaction`, matching the backing-row transaction pattern used by Cleaning and Reservations. Thread status transitions (`CLOSED`/`ARCHIVED`) are deliberately deferred — not needed for this vertical slice, same "ship the slice, extend later" pattern as Cleaning's `CANCELLED`/`MISSED` and Maintenance's task-linking. No `triggerWorkflow` call yet — same n8n deferral reasoning as every other Increment 1 domain.
