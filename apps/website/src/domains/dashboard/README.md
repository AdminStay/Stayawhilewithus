# Dashboard domain

Status: implemented — composition-root summary at `/` (root route), the last Increment 1 slice.

- **Owned model(s)**: none — composition root
- **Permission keys**: none of its own; aggregates read-only data via other domains' existing services (each already runs its own `assertPermission`)
- **Shape**: `services/dashboard.service.ts` (`getDashboardSummary`), `components/DashboardSummary.tsx`. No `schemas/`/`actions.ts` — read-only, no mutations.

Does not own `app/(dashboard)/layout.tsx` (route-group shell chrome) — that stays in `app/`. `getDashboardSummary` never queries Prisma directly; it calls `list*` from every other implemented domain's service (Properties, Guests, Reservations, Tasks, Cleaning, Maintenance, Notifications, Communications) and derives a few summary filters (open tasks, upcoming cleanings, open maintenance requests, unread notifications).

**Graceful degradation, not all-or-nothing**: each underlying call is wrapped in `safeList()`, which resolves to `[]` on `ForbiddenError` and rethrows anything else. Different roles hold different permission subsets — without this, a user missing even one `*:read` permission (e.g. `messages:read`) would get a hard error on the dashboard instead of a summary with that section empty.

`app/page.tsx` (root, outside the `(dashboard)` group) previously just `redirect("/properties")`'d — it's been removed in favor of `app/(dashboard)/page.tsx`, so `/` now renders the real dashboard with the same nav chrome as every other route instead of redirecting.
