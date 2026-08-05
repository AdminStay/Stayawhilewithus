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
 */
export async function recordAudit(input: RecordAuditInput): Promise<AuditLog> {
  return prisma.auditLog.create({
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
