# Audit domain

Status: implemented — audit log + workflow execution history, `/audit` route.

- **Owned model(s)**: `AuditLog`, and (see below) `WorkflowExecution`
- **Permission keys**: `audit_logs:read`
- **Shape**: `services/audit.service.ts` (`listAuditLogs`, `listWorkflowExecutions`), `components/` (`AuditLogList`, `WorkflowExecutionList`). No `schemas/`/`actions.ts` — everything here is read-only.

**Domain vs. platform split**: `src/platform/audit/record-audit.ts` is the reusable _capability_ every domain service calls to write an audit entry (no permission check — it runs on behalf of an already-checked caller). This domain owns the business-facing feature built on top: the audit-log browsing UI, with its own `assertPermission("audit_logs:read")` call.

**Why `WorkflowExecution` lives here too, despite not being in its original owned-model list**: it has no dedicated domain anywhere in the DDD reorg's inventory — n8n's "automations" are plumbing (`@stayw/ai-automation`'s `triggerWorkflow`/`handleN8nCallback`), not a domain with its own permission resource. Both `AuditLog` and `WorkflowExecution` are read-only, cross-cutting system-activity trails ops staff review together, so folding the latter in here (gated by the same `audit_logs:read`, no separate permission resource exists for it) was the more honest call than inventing a new domain for one read-only list. `listWorkflowExecutions` will be empty in most environments — nothing currently calls `triggerWorkflow()` except `properties.service.createProperty` (see that domain's notes), and even that call fails against `N8N_BASE_URL=http://localhost:5678` (a local dev placeholder, not the real n8n Cloud instance) unless something is actually listening there.
