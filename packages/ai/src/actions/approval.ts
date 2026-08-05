import "server-only";

import { Prisma, prisma } from "@stayw/database";
import type { AiActionStatus } from "@stayw/database/enums";

import { InvalidActionStateError } from "./errors";
import type { ProposeActionInput } from "./types";

/**
 * Action Approval Framework: an AI-proposed action pending human sign-off
 * before it executes. Called by the Tool Registry when a tool is registered
 * with requiresApproval: true — see ../tools/registry.ts. State machine:
 * PENDING -> APPROVED|REJECTED -> (if APPROVED) EXECUTED|EXECUTION_FAILED.
 */
export function proposeAction(input: ProposeActionInput) {
  return prisma.aiAction.create({
    data: {
      conversationId: input.conversationId,
      toolName: input.toolName,
      proposedInput: input.proposedInput as Prisma.InputJsonValue,
      reasoning: input.reasoning,
      riskLevel: input.riskLevel ?? "STANDARD",
      relatedEntityType: input.relatedEntityType,
      relatedEntityId: input.relatedEntityId,
      status: "PENDING",
    },
  });
}

async function transition(
  actionId: string,
  expectedStatus: AiActionStatus,
  data: Prisma.AiActionUpdateInput,
) {
  const action = await prisma.aiAction.findUniqueOrThrow({
    where: { id: actionId },
  });
  if (action.status !== expectedStatus) {
    throw new InvalidActionStateError(actionId, action.status, expectedStatus);
  }
  return prisma.aiAction.update({ where: { id: actionId }, data });
}

export function approveAction(actionId: string, reviewedByUserId: string) {
  return transition(actionId, "PENDING", {
    status: "APPROVED",
    reviewedByUser: { connect: { id: reviewedByUserId } },
    reviewedAt: new Date(),
  });
}

export function rejectAction(
  actionId: string,
  reviewedByUserId: string,
  rejectionReason: string,
) {
  return transition(actionId, "PENDING", {
    status: "REJECTED",
    reviewedByUser: { connect: { id: reviewedByUserId } },
    reviewedAt: new Date(),
    rejectionReason,
  });
}

export function markActionExecuted(
  actionId: string,
  executionResult: Record<string, unknown>,
) {
  return transition(actionId, "APPROVED", {
    status: "EXECUTED",
    executedAt: new Date(),
    executionResult: executionResult as Prisma.InputJsonValue,
  });
}

export function markActionFailed(actionId: string, executionError: string) {
  return transition(actionId, "APPROVED", {
    status: "EXECUTION_FAILED",
    executionError,
  });
}

export function listPendingActions() {
  return prisma.aiAction.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
  });
}
