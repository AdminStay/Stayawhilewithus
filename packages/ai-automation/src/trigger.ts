import "server-only";

import { prisma, Prisma } from "@stayw/database";

import { signPayload } from "./hmac";

export interface TriggerWorkflowInput {
  workflowName: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  payload: Record<string, unknown>;
  triggerType?: "EVENT" | "SCHEDULED" | "MANUAL";
  triggerSource: string;
}

const N8N_TIMEOUT_MS = 5000;

function getN8nConfig() {
  const baseUrl = process.env.N8N_BASE_URL;
  const secret = process.env.N8N_WEBHOOK_SHARED_SECRET;
  if (!baseUrl || !secret) {
    throw new Error(
      "N8N_BASE_URL / N8N_WEBHOOK_SHARED_SECRET are not configured.",
    );
  }
  return { baseUrl, secret };
}

/**
 * Fires an n8n workflow for a backend event and records a WorkflowExecution
 * row for traceability. correlationId threads through AuditLog.metadata,
 * IntegrationSyncLog, and the n8n callback payload so a single query can
 * reconstruct the full trace for "what happened for this X."
 *
 * Failure mode (n8n unreachable, no in-app queue by design): marks the
 * execution FAILED and raises a Notification to ops admins so the gap is
 * visible immediately, per ADR-0005.
 */
export async function triggerWorkflow(input: TriggerWorkflowInput) {
  const execution = await prisma.workflowExecution.create({
    data: {
      workflowName: input.workflowName,
      triggerType: input.triggerType ?? "EVENT",
      triggerSource: input.triggerSource,
      status: "PENDING",
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      requestPayload: input.payload as Prisma.InputJsonValue,
    },
  });

  try {
    const { baseUrl, secret } = getN8nConfig();
    const body = JSON.stringify({
      ...input.payload,
      correlationId: execution.correlationId,
    });
    const signature = signPayload(body, secret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), N8N_TIMEOUT_MS);

    const response = await fetch(`${baseUrl}/webhook/${input.workflowName}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-staywhile-signature": signature,
      },
      body,
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (!response.ok) {
      throw new Error(`n8n responded with ${response.status}`);
    }

    return await prisma.workflowExecution.update({
      where: { id: execution.id },
      data: { status: "RUNNING" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    const [failed] = await prisma.$transaction([
      prisma.workflowExecution.update({
        where: { id: execution.id },
        data: {
          status: "FAILED",
          errorMessage: message,
          completedAt: new Date(),
        },
      }),
      prisma.auditLog.create({
        data: {
          actorType: "SYSTEM",
          action: "workflow.trigger_failed",
          entityType: "WorkflowExecution",
          entityId: execution.id,
          workflowExecutionId: execution.id,
          metadata: { workflowName: input.workflowName, error: message },
          occurredAt: new Date(),
        },
      }),
    ]);

    await notifyAdminsOfWorkflowFailure(
      input.workflowName,
      execution.id,
      message,
    );

    return failed;
  }
}

async function notifyAdminsOfWorkflowFailure(
  workflowName: string,
  executionId: string,
  message: string,
) {
  const adminRole = await prisma.role.findUnique({ where: { name: "admin" } });
  if (!adminRole) return;

  const admins = await prisma.userRole.findMany({
    where: { roleId: adminRole.id, propertyId: null },
    select: { userId: true },
    distinct: ["userId"],
  });

  if (admins.length === 0) return;

  await prisma.notification.createMany({
    data: admins.map((a) => ({
      userId: a.userId,
      type: "WORKFLOW_FAILURE" as const,
      title: `Workflow "${workflowName}" failed to trigger`,
      body: message,
      channel: "IN_APP" as const,
      status: "PENDING" as const,
      relatedEntityType: "WorkflowExecution",
      relatedEntityId: executionId,
    })),
  });
}
