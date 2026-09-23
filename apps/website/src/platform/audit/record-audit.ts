import "server-only";

import type { ActorType, AuditLog, Prisma } from "@stayw/database";
import { prisma } from "@stayw/database";

export interface RecordAuditInput {
  actorUserId?: string;
  actorType: ActorType;
  action: string;
  entityType: string;
  entityId: string;
  beforeState?: Prisma.InputJsonValue;
  afterState?: Prisma.InputJsonValue;
  workflowExecutionId?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Single write path for AuditLog rows from app-layer domain services. Called
 * as the audit-write step of the service-layer pattern (see
 * CODING_STANDARDS.md) — never call prisma.auditLog.create directly from a
 * domain service.
 *
 * `client` (2026-09-23, item C's atomicity review) is an OPTIONAL, purely
 * additive parameter — every one of this function's existing ~22 call
 * sites keeps calling `recordAudit(input)` with one argument, unchanged,
 * and continues writing through the global `prisma` singleton exactly as
 * before. It exists solely so a caller that's already inside its own
 * `prisma.$transaction(async (tx) => ...)` callback can pass that same
 * `tx` client through, making its own state-changing write and this audit
 * entry genuinely atomic (both commit or both roll back together) —
 * see retireSmartDevice() (smart-devices.service.ts) for the first real
 * use of this. `Prisma.TransactionClient` is a strict subset of the real
 * `PrismaClient` shape, so passing the plain global `prisma` singleton
 * (the default) satisfies this parameter's type with no cast needed.
 */
export async function recordAudit(
  input: RecordAuditInput,
  client: Prisma.TransactionClient = prisma,
): Promise<AuditLog> {
  return client.auditLog.create({
    data: {
      actorUserId: input.actorUserId,
      actorType: input.actorType,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      beforeState: input.beforeState,
      afterState: input.afterState,
      workflowExecutionId: input.workflowExecutionId,
      metadata: input.metadata,
      occurredAt: new Date(),
    },
  });
}
