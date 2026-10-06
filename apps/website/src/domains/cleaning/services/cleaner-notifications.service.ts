import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  CLEANER_NOTIFIED_ACTION,
  parseNotifiedCleaner,
  type CleanerNotificationRecord,
} from "../lib/cleaner-notification";
import { CleaningRuleError } from "../lib/errors";
import type { MarkCleanerNotifiedInput } from "../schemas/cleaning.schema";

import { CLEANER_CHANGE_ROLE_NAMES } from "./cleaning-access";
import { CLEANER_LOCKED_STATUSES } from "./cleaning.service";

import { recordAudit } from "@/platform/audit/record-audit";
import { hasGlobalRole } from "@/platform/auth/is-global-admin";

/**
 * Cleaner Phase 5.2 — "Mark cleaner notified". Records, as an append-only
 * AuditLog entry, that an admin told the job's cleaner (by hand, outside
 * StayWhile). Sends nothing, calls no provider, and never changes the
 * cleaning job or its cleaner. See lib/cleaner-notification.ts for the
 * record's shape.
 *
 * Admin only: cleaning_schedules:update AND the global admin role — the
 * same rule as changing a job's cleaner (the permission alone isn't
 * enough; the "cleaner" role holds it too).
 */
const ADMIN_ONLY_MESSAGE =
  "Only an admin can record that a cleaner was notified.";

function displayName(
  user: { firstName: string | null; lastName: string | null } | null,
): string | null {
  if (!user) return null;
  const name = [user.firstName, user.lastName].filter(Boolean).join(" ");
  return name || null;
}

/** Admin (+ Staff once that role exists) — the same roles that may change a cleaning's cleaner. */
async function assertAdmin(actor: AuthContext) {
  await assertPermission(actor, "cleaning_schedules:update");
  if (!(await hasGlobalRole(actor, CLEANER_CHANGE_ROLE_NAMES))) {
    throw new CleaningRuleError(ADMIN_ONLY_MESSAGE);
  }
}

/**
 * Records one notification for an OPEN job (not COMPLETED/CANCELLED/MISSED)
 * that has a cleaner. `input.cleanerId` is the cleaner the admin saw on the
 * page; if the job's cleaner has changed since, nothing is recorded (the
 * admin may have told the wrong person). Recording again later (e.g. a
 * reminder) adds another entry — it is a history, not a flag.
 */
export async function markCleanerNotified(
  actor: AuthContext,
  input: MarkCleanerNotifiedInput,
): Promise<{ cleanerName: string; notifiedAt: Date }> {
  await assertAdmin(actor);

  return prisma.$transaction(async (tx) => {
    const job = await tx.cleaningSchedule.findUnique({
      where: { id: input.scheduleId },
      select: {
        id: true,
        status: true,
        scheduledDate: true,
        cleaner: { select: { id: true, name: true, status: true } },
        property: { select: { id: true, name: true } },
      },
    });
    if (!job) {
      throw new CleaningRuleError(
        "This cleaning no longer exists. Refresh the page.",
      );
    }
    if (CLEANER_LOCKED_STATUSES.includes(job.status)) {
      throw new CleaningRuleError(
        `This cleaning is ${job.status.toLowerCase()}, so a notification can't be recorded.`,
      );
    }
    if (!job.cleaner) {
      throw new CleaningRuleError(
        "This cleaning has no cleaner yet, so there is no one to notify.",
      );
    }
    if (job.cleaner.id !== input.cleanerId) {
      throw new CleaningRuleError(
        "This cleaning's cleaner was just changed. Refresh the page and check before marking them notified.",
      );
    }
    // 2026-10-07: an inactive cleaner isn't going to do the job — the job
    // needs a new cleaner, not a notification.
    if (job.cleaner.status !== "ACTIVE") {
      throw new CleaningRuleError(
        `${job.cleaner.name} is inactive, so a notification can't be recorded. Choose an active cleaner for this cleaning first.`,
      );
    }

    const entry = await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: CLEANER_NOTIFIED_ACTION,
        entityType: "CleaningSchedule",
        entityId: job.id,
        afterState: {
          cleanerId: job.cleaner.id,
          cleanerName: job.cleaner.name,
        },
        metadata: {
          propertyId: job.property.id,
          propertyName: job.property.name,
          scheduleStatus: job.status,
          scheduledDate: job.scheduledDate.toISOString().slice(0, 10),
          method: "manual",
        },
      },
      tx,
    );

    return { cleanerName: job.cleaner.name, notifiedAt: entry.occurredAt };
  });
}

/**
 * Admin only, read-only: the LATEST recorded notification per job, for the
 * given jobs. Jobs never marked are absent from the map. Reads the
 * AuditLog only (indexed on entityType + entityId); writes nothing.
 */
export async function listLatestCleanerNotifications(
  actor: AuthContext,
  scheduleIds: string[],
): Promise<Map<string, CleanerNotificationRecord>> {
  await assertAdmin(actor);
  const latest = new Map<string, CleanerNotificationRecord>();
  if (scheduleIds.length === 0) return latest;

  const rows = await prisma.auditLog.findMany({
    where: {
      entityType: "CleaningSchedule",
      entityId: { in: scheduleIds },
      action: CLEANER_NOTIFIED_ACTION,
    },
    orderBy: { occurredAt: "desc" },
    select: {
      entityId: true,
      afterState: true,
      occurredAt: true,
      actorUser: { select: { firstName: true, lastName: true } },
    },
  });

  for (const row of rows) {
    if (latest.has(row.entityId)) continue; // newest first
    const cleaner = parseNotifiedCleaner(row.afterState);
    if (!cleaner) continue;
    latest.set(row.entityId, {
      ...cleaner,
      notifiedAt: row.occurredAt,
      notifiedByName: displayName(row.actorUser),
    });
  }
  return latest;
}
