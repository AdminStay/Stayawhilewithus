# Audit domain

Status: not yet implemented — README skeleton only, establishing the pattern for this phase. See `03 Documentation/adr/0006-domain-driven-folder-structure.md`.

- **Owned model(s)**: `AuditLog`
- **Permission keys**: `audit_logs:read`
- **Expected shape when implemented**: `services/audit.service.ts`, `schemas/audit.schema.ts`, `components/`, `actions.ts`, `README.md` (this file, expanded).

**Domain vs. platform split**: `src/platform/audit/record-audit.ts` is the reusable _capability_ every domain service calls to write an audit entry (no permission check — it runs on behalf of an already-checked caller). This domain owns the business-facing feature built on top: the audit-log browsing/filtering UI, with its own `assertPermission("audit_logs:read")` call.
