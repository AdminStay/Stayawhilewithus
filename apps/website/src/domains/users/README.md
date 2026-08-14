# Users domain

Owns `UserRole` assignment (view users, assign/revoke roles). Does not own `User` itself (no create/update/delete of user profile fields — Clerk + `platform/identity/` own that), and does not own `Role`/`Permission` definitions (those are seeded, not editable from this UI).

- **Services**: `services/users.service.ts` — `listUsersWithRoles`, `listAssignableRoles`, `assignUserRole`, `revokeUserRole`.
- **Schemas**: `schemas/users.schema.ts` — `assignUserRoleSchema`.
- **Components**: `components/UserList.tsx`.
- **Actions**: `actions.ts` — `assignUserRoleAction`, `revokeUserRoleAction` (Server Actions).
- **Permissions**: `users:read` (view users), `roles:read` (view the assignable-role list), `roles:manage` (assign/revoke). All three already existed in the permission catalog (`packages/auth/src/permissions.ts` / `packages/database/prisma/seed.ts`) — nothing new was added there. As seeded, only the `admin` role (`permissionKeys: "*"`) holds any of them, so this is admin-only by construction, enforced server-side via `assertPermission` in every service function — the `/users` nav link itself is not hidden from other roles, matching every other route in this app (the page throws `ForbiddenError`, caught by `app/(dashboard)/error.tsx`).
- **Route**: `/users` (`apps/website/app/(dashboard)/users/page.tsx`).

## Why this domain exists

Clerk sign-in only authenticates and JIT-provisions a `User` row with zero `UserRole` assignments (`platform/auth/get-current-user.ts`) — every domain service's `assertPermission` then fails for a brand-new real sign-in until an admin grants a role. Before this domain, the only way to do that was `packages/database/scripts/grant-role.ts`, a CLI script run directly against the database. That script is **still valid and unchanged** — keep it as an emergency/manual fallback for when the app itself is unreachable — but day-to-day role granting should go through this UI now.

## Behavior notes

- **Assignment is idempotent**: assigning a role a user already holds (same user + role + property scope) is a no-op, not an error — mirrors `grant-role.ts`'s existing behavior.
- **Global vs. property-scoped**: `UserRole.propertyId` is nullable (`null` = global). The assign form defaults to "Global"; picking a property scopes the grant to it, same model `packages/auth/src/rbac.ts` already reads.
- **Last-global-admin protection**: `revokeUserRole` refuses to delete the last remaining global `admin` `UserRole` in the system (`ConflictError`), so role management can't accidentally lock itself out through the UI. `grant-role.ts` remains available as a direct-database escape hatch regardless.
