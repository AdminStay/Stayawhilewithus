# Notifications domain

Status: implemented — list (own inbox) + mark-read, `/notifications` route.

- **Owned model(s)**: `Notification`
- **Permission keys**: `notifications:read`, `notifications:update`
- **Shape**: `services/notifications.service.ts` (`listNotifications`, `markNotificationRead`), `components/NotificationList.tsx`, `actions.ts`. No `schemas/` — there's no user-facing create form (see split below), and `markNotificationRead` only takes an id, matching the id-only mutations elsewhere (e.g. `completeTask`).

**Domain vs. platform split**: `src/platform/notifications/create-notification.ts` is the reusable _capability_ other domains call to create a notification (no permission check — it runs on behalf of an already-checked caller). This domain owns the business-facing feature built on top: the notification center UI (list, mark-read), with its own `assertPermission` call.

**Ownership scoping**: `notifications:read`/`notifications:update` gate _whether_ a user can use the notification center at all, not _whose_ notifications they see — `listNotifications` always scopes to `where: { userId: actor.userId }`, and `markNotificationRead` verifies the target notification's `userId` matches the actor (throwing `NotFoundError` otherwise) before writing, since the permission check alone doesn't enforce row-level ownership the way property-scoped RBAC does for other domains.
