import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";

import {
  buildCommandEvidence,
  LOCK_VERIFICATION_EVIDENCE_ACTION,
  OPS_METHODS_BY_STEP,
  parseOpsEvidence,
  type CommandEvidence,
  type OpsEvidence,
  type OpsEvidenceMethod,
  type OpsEvidenceOutcome,
  type RecordedOpsEvidence,
  type VerificationStep,
} from "../lib/lock-verification-evidence";

import { recordAudit } from "@/platform/audit/record-audit";

const LOCK_COMMAND_ACTION = "smart_device.august_lock_command";

export interface LockEvidence {
  commands: CommandEvidence[];
  ops: RecordedOpsEvidence[];
}

function displayName(
  user: { firstName: string | null; lastName: string | null } | null,
): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || null;
}

/**
 * Read-only (smart_devices:read, like the rest of /locks): every lock's
 * StayWhile command evidence and Ops evidence, from the append-only
 * AuditLog. Makes no provider call and writes nothing.
 */
export async function getLockVerificationEvidence(
  actor: AuthContext,
  smartDeviceIds: string[],
): Promise<Map<string, LockEvidence>> {
  await assertPermission(actor, "smart_devices:read");
  const out = new Map<string, LockEvidence>();
  if (smartDeviceIds.length === 0) return out;

  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: "SmartDevice",
      entityId: { in: smartDeviceIds },
      action: { in: [LOCK_COMMAND_ACTION, LOCK_VERIFICATION_EVIDENCE_ACTION] },
    },
    orderBy: { occurredAt: "asc" },
    select: {
      entityId: true,
      action: true,
      afterState: true,
      metadata: true,
      occurredAt: true,
      actorUser: { select: { firstName: true, lastName: true } },
    },
  });

  const commandRows = new Map<
    string,
    Parameters<typeof buildCommandEvidence>[0][number][]
  >();
  const opsRows = new Map<string, RecordedOpsEvidence[]>();
  for (const row of rows) {
    const actorName = displayName(row.actorUser);
    if (row.action === LOCK_COMMAND_ACTION) {
      const list = commandRows.get(row.entityId) ?? [];
      list.push({
        afterState: row.afterState,
        metadata: row.metadata,
        occurredAt: row.occurredAt,
        actorName,
      });
      commandRows.set(row.entityId, list);
    } else {
      const evidence = parseOpsEvidence(row.afterState);
      if (!evidence) continue;
      const list = opsRows.get(row.entityId) ?? [];
      list.push({
        ...evidence,
        recordedAt: row.occurredAt.toISOString(),
        recordedByName: actorName,
      });
      opsRows.set(row.entityId, list);
    }
  }
  for (const id of smartDeviceIds) {
    out.set(id, {
      commands: buildCommandEvidence(commandRows.get(id) ?? []),
      ops: opsRows.get(id) ?? [],
    });
  }
  return out;
}

export interface RecordLockVerificationEvidenceInput {
  smartDeviceId: string;
  step: VerificationStep;
  outcome: OpsEvidenceOutcome;
  method: OpsEvidenceMethod;
  performedBy: string;
  performedAt: Date;
  notes?: string;
}

export type RecordLockVerificationEvidenceResult =
  { status: "success" } | { status: "rejected"; reason: string };

function isRetiredLock(metadata: unknown): boolean {
  const retiredAt =
    metadata && typeof metadata === "object"
      ? (metadata as Record<string, unknown>).retiredAt
      : undefined;
  return (
    typeof retiredAt === "string" &&
    !Number.isNaN(new Date(retiredAt).getTime())
  );
}

/** Allowance for clock skew between the recorder's device and the server. */
const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/**
 * Records one piece of Ops evidence as a NEW AuditLog row (append-only;
 * nothing is edited or deleted). Admin-only: the existing GLOBAL
 * `locks:manage`, no new permission. Never sends a command, never calls
 * August, never changes mapping, holds, eligibility, or command history —
 * and it can never make a lock "Verified": only a successful StayWhile
 * command does that.
 */
export async function recordLockVerificationEvidence(
  actor: AuthContext,
  input: RecordLockVerificationEvidenceInput,
): Promise<RecordLockVerificationEvidenceResult> {
  await assertPermission(actor, "locks:manage");
  if (!OPS_METHODS_BY_STEP[input.step].includes(input.method)) {
    return {
      status: "rejected",
      reason:
        "A remote LOCK/UNLOCK can only be confirmed by an onsite August-app test.",
    };
  }
  if (input.performedAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    return {
      status: "rejected",
      reason: "The check time can't be in the future.",
    };
  }
  const notes = input.notes?.trim() || null;
  if (input.outcome !== "PASSED" && !notes) {
    return {
      status: "rejected",
      reason: "Add a note explaining a failed or not-applicable result.",
    };
  }
  const device = await prisma.smartDevice.findUnique({
    where: { id: input.smartDeviceId },
    select: { id: true, deviceType: true, provider: true, metadata: true },
  });
  if (!device || device.deviceType !== "LOCK" || device.provider !== "AUGUST") {
    return { status: "rejected", reason: "Lock not found." };
  }
  // A retired lock is off the fleet (same rule as isRetired() in
  // smart-devices.service.ts, not imported so this file never loads the
  // August client); evidence can't be attached to it, even by a
  // hand-crafted request.
  if (isRetiredLock(device.metadata)) {
    return { status: "rejected", reason: "This lock is retired." };
  }

  const evidence: OpsEvidence = {
    version: 1,
    step: input.step,
    outcome: input.outcome,
    method: input.method,
    performedBy: input.performedBy.trim(),
    performedAt: input.performedAt.toISOString(),
    notes,
    commandSent: false,
  };
  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: LOCK_VERIFICATION_EVIDENCE_ACTION,
    entityType: "SmartDevice",
    entityId: device.id,
    afterState: { evidence } as unknown as Prisma.InputJsonValue,
  });
  return { status: "success" };
}
