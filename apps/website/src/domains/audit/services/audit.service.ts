import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type AuditLog, type WorkflowExecution } from "@stayw/database";

export type { AuditLog, WorkflowExecution };

const RECENT_LIMIT = 100;

export async function listAuditLogs(actor: AuthContext) {
  await assertPermission(actor, "audit_logs:read");
  return prisma.auditLog.findMany({
    orderBy: { occurredAt: "desc" },
    take: RECENT_LIMIT,
    include: { actorUser: true },
  });
}

/**
 * WorkflowExecution has no owning domain of its own (it wasn't part of the
 * DDD reorg's 13-domain inventory) — it lives here because both are
 * read-only system-activity trails ops staff review together, same
 * reasoning as Dashboard being a cross-domain composition root. Gated by
 * the same audit_logs:read permission; no separate permission resource
 * exists for it.
 */
export async function listWorkflowExecutions(actor: AuthContext) {
  await assertPermission(actor, "audit_logs:read");
  return prisma.workflowExecution.findMany({
    orderBy: { startedAt: "desc" },
    take: RECENT_LIMIT,
  });
}
