# Resources domain

Status: implemented (list + create + edit + soft delete). "General Resources / Helpful Links" — a configurable, dashboard-managed catalog (SOPs, vendor/service-provider info, general operations links), requested at the September 16 meeting. Not a Notion view, not hard-coded.

- **Owned model(s)**: `ResourceLink`
- **Permission keys**: `resource_links:read`, `resource_links:create`, `resource_links:update`, `resource_links:delete`, `resource_links:manage` (manage not yet wired to UI)
- **Route**: `/resources`
- **V1 read access, deliberately narrow**: `admin` (full CRUD) and `ops_manager` (read-only) only — `cleaner`/`maintenance_tech`/`front_desk`/`read_only` do not have `resource_links:read` yet, pending Kenny/Michelle's decision on which other roles should see this. Expanding read access later is a seed-file grant change only — no schema or service change needed.
- **Soft delete**: `deletedAt`, matching `Property`'s own convention — "delete" hides a row from `listResourceLinks`, never removes it.
- **Not yet implemented (explicitly out of scope for V1)**: tags/multi-category, favorites, click analytics, workflow automation, per-property write-permission scoping beyond the existing generic RBAC system.
