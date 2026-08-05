# ADR-0005: Event-driven workflow architecture

## Status

Accepted — 2026-08-04

## Context

The platform needs to run asynchronous/automated work (notification delivery, scheduled sync polling, multi-step automations) without building and operating a separate job-queue infrastructure, per the "n8n only, no in-app queue" decision (see ADR-0001's consequences).

## Decision

- **Outbound (backend → n8n)**: after a service-layer mutation commits, it calls `triggerWorkflow()` (`@stayw/ai-automation`), which: (1) inserts a `WorkflowExecution` row (`status = PENDING`, fresh `correlationId`), (2) HMAC-signs and POSTs the payload to `${N8N_BASE_URL}/webhook/<workflowName>` with a short (~5s) timeout — n8n is expected to accept-and-queue, not synchronously complete, (3) on success, sets `status = RUNNING`.
- **Failure handling (no in-app queue, by design)**: if n8n is unreachable or errors, the execution is marked `FAILED` with the error message, an `AuditLog` row (`actorType = SYSTEM`, action `workflow.trigger_failed`) is written, and an `IN_APP` `Notification` is raised to every user with the global `admin` role — this is the explicit, documented mitigation for accepting "no automatic retry queue" as a tradeoff. A failure is never silent.
- **Inbound (n8n → backend)**: `app/api/webhooks/n8n/route.ts`, HMAC-verified (machine-to-machine — not Clerk auth). Looks up `WorkflowExecution` by `correlationId`, and only applies the update if the execution is still `PENDING`/`RUNNING` (idempotency guard against duplicate deliveries) — plus the DB-level unique constraint on `n8nExecutionId` as a second safety net.
- **Traceability**: `correlationId` (generated at trigger time) threads through `AuditLog.metadata`, `IntegrationSyncLog`, and the n8n callback payload, so a single query can reconstruct the full trace for "what happened for this reservation creation." The originating business event is always audit-logged at the moment of mutation, independent of whether the workflow trigger itself succeeds — `AuditLog` captures _what changed_, `WorkflowExecution` captures the _automation side effect_, linked via `AuditLog.workflowExecutionId`.
- **Scheduled workflows** (e.g. future OwnerRez sync polling) live entirely as n8n cron triggers (`WorkflowExecution.triggerType = SCHEDULED`) that call the same inbound webhook to persist results — one uniform traceability model regardless of what triggered the workflow.
- **Notification delivery** reuses this same pattern: creating a `Notification` row with `status = PENDING` is itself an event that (in a later phase) fires a workflow; n8n performs the actual Slack/Email/SMS send and calls back to set `status = SENT`/`FAILED`.

## Consequences

- One automation system to operate (n8n), keeping the backend stateless and avoiding the operational overhead of a second queue/worker system.
- The explicit `FAILED` + admin-notification path means "n8n was down" is always visible in-app within seconds, not silently dropped — the cost of no automatic retry is paid in visibility instead.
- Every workflow's exported n8n JSON must live in `packages/ai-automation/workflows/` (see that folder's README for the naming convention) and its first node must verify the `x-staywhile-signature` HMAC header — this is a hard requirement for any new workflow, not optional.
- No workflows are implemented yet in this phase — only the trigger/callback plumbing, proven against the `property.created` event in the minimal vertical slice (see `HANDOFF.md`).
