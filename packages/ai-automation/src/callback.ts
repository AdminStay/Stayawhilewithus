import "server-only";

import { prisma, Prisma } from "@stayw/database";

import { verifySignature } from "./hmac";

export interface N8nCallbackBody {
  correlationId: string;
  n8nExecutionId?: string;
  status: "SUCCEEDED" | "FAILED";
  responsePayload?: Record<string, unknown>;
  errorMessage?: string;
}

export interface N8nCallbackResult {
  status: number;
  body: unknown;
}

/**
 * Handles an inbound n8n -> backend callback: HMAC-verifies the payload,
 * looks up the WorkflowExecution by correlationId, and applies the status
 * update. Idempotent via status-transition guards (only applies if the
 * execution is still PENDING/RUNNING) plus the DB-level unique constraint
 * on n8nExecutionId. Mirrors triggerWorkflow()'s outbound half, giving this
 * package both directions of the n8n integration symmetrically.
 */
export async function handleN8nCallback(
  rawBody: string,
  signatureHeader: string | null,
  sharedSecret: string,
): Promise<N8nCallbackResult> {
  if (
    !signatureHeader ||
    !verifySignature(rawBody, signatureHeader, sharedSecret)
  ) {
    return { status: 401, body: { error: "Invalid signature" } };
  }

  const body = JSON.parse(rawBody) as N8nCallbackBody;

  const execution = await prisma.workflowExecution.findUnique({
    where: { correlationId: body.correlationId },
  });

  if (!execution) {
    return { status: 404, body: { error: "Unknown correlationId" } };
  }

  if (execution.status !== "PENDING" && execution.status !== "RUNNING") {
    // Already terminal — treat as a duplicate delivery, not an error.
    return { status: 200, body: { received: true, duplicate: true } };
  }

  await prisma.workflowExecution.update({
    where: { id: execution.id },
    data: {
      status: body.status,
      n8nExecutionId: body.n8nExecutionId,
      responsePayload: body.responsePayload as
        Prisma.InputJsonValue | undefined,
      errorMessage: body.errorMessage,
      completedAt: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actorType: "WORKFLOW",
      action: `workflow.${body.status === "SUCCEEDED" ? "completed" : "failed"}`,
      entityType: "WorkflowExecution",
      entityId: execution.id,
      workflowExecutionId: execution.id,
      metadata: { workflowName: execution.workflowName },
      occurredAt: new Date(),
    },
  });

  return { status: 200, body: { received: true } };
}
