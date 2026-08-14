import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type MaintenanceRequest } from "@stayw/database";

export type { MaintenanceRequest };

import type {
  AssignMaintenanceRequestInput,
  CreateMaintenanceRequestInput,
  ResolveMaintenanceRequestInput,
} from "../schemas/maintenance.schema";

import { recordAudit } from "@/platform/audit/record-audit";
import { NotFoundError } from "@/platform/errors";

const CATEGORY_LABELS: Record<string, string> = {
  PLUMBING: "Plumbing",
  ELECTRICAL: "Electrical",
  HVAC: "HVAC",
  APPLIANCE: "Appliance",
  STRUCTURAL: "Structural",
  PEST_CONTROL: "Pest control",
  OTHER: "Other",
};

export async function listMaintenanceRequests(actor: AuthContext) {
  await assertPermission(actor, "maintenance_requests:read");
  return prisma.maintenanceRequest.findMany({
    orderBy: { reportedAt: "desc" },
    include: { property: true, task: true },
  });
}

/**
 * MaintenanceRequest.taskId is an optional 1:1 FK (unlike CleaningSchedule's
 * required one) — a request is a standalone report until someone assigns a
 * Task to work it, so creation never requires one.
 */
export async function createMaintenanceRequest(
  actor: AuthContext,
  input: CreateMaintenanceRequestInput,
) {
  await assertPermission(actor, "maintenance_requests:create");

  const request = await prisma.maintenanceRequest.create({
    data: {
      propertyId: input.propertyId,
      category: input.category,
      severity: input.severity,
      description: input.description,
      reportedByUserId: actor.userId,
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "maintenance_request.created",
    entityType: "MaintenanceRequest",
    entityId: request.id,
    afterState: request,
  });

  return request;
}

export async function resolveMaintenanceRequest(
  actor: AuthContext,
  requestId: string,
  input: ResolveMaintenanceRequestInput,
) {
  await assertPermission(actor, "maintenance_requests:update");

  const request = await prisma.maintenanceRequest.update({
    where: { id: requestId },
    data: {
      status: "RESOLVED",
      resolutionNotes: input.resolutionNotes || undefined,
      resolvedAt: new Date(),
    },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "maintenance_request.resolved",
    entityType: "MaintenanceRequest",
    entityId: request.id,
    afterState: request,
  });

  return request;
}

/**
 * First assignment creates the backing Task (title derived from category)
 * since `taskId` is optional and none was made at report time; later calls
 * just reassign the existing Task. Either way the request moves to
 * IN_PROGRESS — assignment is what "someone is on it" means here.
 */
export async function assignMaintenanceRequest(
  actor: AuthContext,
  requestId: string,
  input: AssignMaintenanceRequestInput,
) {
  await assertPermission(actor, "maintenance_requests:update");

  const request = await prisma.$transaction(async (tx) => {
    const existing = await tx.maintenanceRequest.findUnique({
      where: { id: requestId },
    });
    if (!existing) {
      throw new NotFoundError("MaintenanceRequest", requestId);
    }

    let taskId = existing.taskId;
    if (!taskId) {
      const task = await tx.task.create({
        data: {
          title: `Maintenance: ${CATEGORY_LABELS[existing.category] ?? existing.category}`,
          type: "MAINTENANCE",
          propertyId: existing.propertyId,
          assignedToUserId: input.assignedToUserId || undefined,
          createdByUserId: actor.userId,
        },
      });
      taskId = task.id;
    } else if (input.assignedToUserId) {
      await tx.task.update({
        where: { id: taskId },
        data: { assignedToUserId: input.assignedToUserId },
      });
    }

    return tx.maintenanceRequest.update({
      where: { id: requestId },
      data: { taskId, status: "IN_PROGRESS" },
    });
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "maintenance_request.assigned",
    entityType: "MaintenanceRequest",
    entityId: request.id,
    afterState: request,
  });

  return request;
}
