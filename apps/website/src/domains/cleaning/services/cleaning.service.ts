import "server-only";

import { assertPermission, hasPermission, type AuthContext } from "@stayw/auth";
import {
  prisma,
  type CleaningSchedule,
  type CleaningStatus,
  type Prisma,
} from "@stayw/database";

export type { CleaningSchedule };

import { CLEANING_TYPE_LABELS } from "../lib/cleaner-message";
import { CleaningRuleError } from "../lib/errors";
import type {
  AssignCleaningScheduleCleanerInput,
  CreateCleaningScheduleInput,
  RescheduleCleaningScheduleInput,
} from "../schemas/cleaning.schema";

import { findCurrentPrimaryCleanerId } from "@/domains/cleaners/services/cleaner-assignments.service";
import { recordAudit } from "@/platform/audit/record-audit";
import { isGlobalAdmin } from "@/platform/auth/is-global-admin";

/**
 * A cleaning's cleaner can't be assigned, changed or cleared once the job is
 * completed, cancelled or marked missed.
 */
export const CLEANER_LOCKED_STATUSES: readonly CleaningStatus[] = [
  "COMPLETED",
  "CANCELLED",
  "MISSED",
];

/** Names only — a cleaner's phone never leaves the cleaners domain from here. */
const JOB_CLEANER_SELECT = {
  select: { id: true, name: true, status: true },
} as const;

const ADMIN_ONLY_MESSAGE =
  "Only an admin can choose or change the cleaner on a cleaning.";

/**
 * Each schedule carries its stored cleaner (id/name/status — never a
 * phone). The cleaner is shown only to viewers with cleaners:read, the same
 * gate as the Cleaner column on /properties; for everyone else `cleaner` is
 * null, so this also holds for the cleaning.list AI tool.
 */
export async function listCleaningSchedules(actor: AuthContext) {
  await assertPermission(actor, "cleaning_schedules:read");
  const canSeeCleaners = await hasPermission(actor, "cleaners:read");
  const schedules = await prisma.cleaningSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    include: {
      property: true,
      reservation: true,
      task: true,
      cleaner: JOB_CLEANER_SELECT,
    },
  });
  return canSeeCleaners
    ? schedules
    : schedules.map((s) => ({ ...s, cleanerId: null, cleaner: null }));
}

/**
 * Changing which cleaner a cleaning goes to is admin-only for this phase
 * (Cleaner Phase 4): cleaning_schedules:update AND the global admin role —
 * the permission alone isn't enough, because the "cleaner" role holds it
 * too. Used both to enforce the rule and to decide whether /cleaning shows
 * the control.
 */
export async function canChangeCleaningCleaner(
  actor: AuthContext,
): Promise<boolean> {
  return (
    (await hasPermission(actor, "cleaning_schedules:update")) &&
    (await isGlobalAdmin(actor))
  );
}

async function assertActiveCleaner(
  tx: Prisma.TransactionClient,
  cleanerId: string,
) {
  const cleaner = await tx.cleaner.findUnique({
    where: { id: cleanerId },
    select: { id: true, name: true, status: true },
  });
  if (!cleaner) throw new CleaningRuleError("That cleaner no longer exists.");
  if (cleaner.status !== "ACTIVE") {
    throw new CleaningRuleError(
      `${cleaner.name} is inactive. Choose an active cleaner.`,
    );
  }
  return cleaner;
}

/**
 * Cleaner Phase 5.3 — OPEN cleaning jobs with no usable cleaner (the
 * dashboard's "needs attention" count). Same definition as
 * lib/needs-cleaner.ts's needsCleaner(): the status isn't
 * COMPLETED/CANCELLED/MISSED and either cleanerId is null or (2026-10-07)
 * the stored cleaner is no longer ACTIVE. Read-only; assigns nothing.
 *
 * Requires cleaning_schedules:read AND cleaners:read — without the latter,
 * a job's cleaner is hidden, so "has no cleaner" can't be shown (same rule
 * as the Cleaner column). Throws ForbiddenError otherwise, which the
 * dashboard's safeList() turns into "nothing to show".
 */
export async function listCleaningJobsNeedingCleaner(actor: AuthContext) {
  await assertPermission(actor, "cleaning_schedules:read");
  await assertPermission(actor, "cleaners:read");
  return prisma.cleaningSchedule.findMany({
    where: {
      status: { notIn: [...CLEANER_LOCKED_STATUSES] },
      OR: [{ cleanerId: null }, { cleaner: { status: { not: "ACTIVE" } } }],
    },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      status: true,
      cleanerId: true,
      scheduledDate: true,
      property: { select: { name: true } },
      cleaner: { select: { status: true } },
    },
  });
}

/** Schedules that have been moved at least once since creation — for dashboard visibility into what changed. */
export async function listRecentlyRescheduledCleanings(actor: AuthContext) {
  await assertPermission(actor, "cleaning_schedules:read");
  return prisma.cleaningSchedule.findMany({
    where: { originalScheduledDate: { not: null } },
    orderBy: { updatedAt: "desc" },
    take: 10,
    include: { property: true },
  });
}

/**
 * CleaningSchedule has a required 1:1 `taskId` FK, so the Task it rides on
 * is created in the same transaction rather than requiring a pre-existing
 * one to be selected.
 *
 * Cleaner (Cleaner Phase 4): the default is the property's current ACTIVE
 * PRIMARY at this moment, copied onto the job — it does not follow later
 * assignment changes. No PRIMARY (e.g. a team-only property) → no cleaner
 * ("Needs cleaner"); a TEAM_MEMBER is never picked automatically. An
 * explicit `input.cleanerId` that differs from that default ("" = none, or
 * another cleaner) is a choice of cleaner, so it needs admin, and a chosen
 * cleaner must be ACTIVE.
 */
export async function createCleaningSchedule(
  actor: AuthContext,
  input: CreateCleaningScheduleInput,
) {
  await assertPermission(actor, "cleaning_schedules:create");

  const { schedule, cleanerSource } = await prisma.$transaction(async (tx) => {
    const defaultCleanerId = await findCurrentPrimaryCleanerId(
      tx,
      input.propertyId,
    );
    const cleanerId =
      input.cleanerId === undefined
        ? defaultCleanerId
        : input.cleanerId || null;
    const isDefault = cleanerId === defaultCleanerId;
    if (!isDefault) {
      if (!(await canChangeCleaningCleaner(actor))) {
        throw new CleaningRuleError(ADMIN_ONLY_MESSAGE);
      }
      if (cleanerId !== null) await assertActiveCleaner(tx, cleanerId);
    }

    const task = await tx.task.create({
      data: {
        title: CLEANING_TYPE_LABELS[input.cleaningType] ?? "Cleaning",
        type: "CLEANING",
        propertyId: input.propertyId,
        reservationId: input.reservationId || undefined,
        dueAt: input.scheduledDate,
        createdByUserId: actor.userId,
      },
    });

    const created = await tx.cleaningSchedule.create({
      data: {
        propertyId: input.propertyId,
        reservationId: input.reservationId || undefined,
        taskId: task.id,
        cleaningType: input.cleaningType,
        scheduledDate: input.scheduledDate,
        scheduledStartTime: input.scheduledStartTime || undefined,
        scheduledEndTime: input.scheduledEndTime || undefined,
        cleanerId,
      },
    });

    return {
      schedule: created,
      cleanerSource:
        cleanerId === null
          ? "none"
          : isDefault
            ? "property_primary"
            : "selected",
    };
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "cleaning_schedule.created",
    entityType: "CleaningSchedule",
    entityId: schedule.id,
    afterState: schedule,
    metadata: { cleanerSource },
  });

  return schedule;
}

/**
 * Sets — or, with `cleanerId: null`, clears back to "Needs cleaner" — the
 * cleaner on ONE cleaning (Cleaner Phase 4 per-job override). Admin only
 * (see canChangeCleaningCleaner); a cleaner must be ACTIVE but need not be
 * the property's current PRIMARY or team. Clearing never picks anyone else
 * (no TEAM_MEMBER fallback) and touches only this job. Refused on a
 * COMPLETED, CANCELLED or MISSED job — the status condition is part of the
 * UPDATE itself, so a job closed a moment earlier can't slip through.
 * Choosing what the job already has (same cleaner, or clearing an
 * unassigned job) is a no-op (no write, no audit). The audit entry records
 * names and ids only, never a phone number.
 */
export async function assignCleaningScheduleCleaner(
  actor: AuthContext,
  input: AssignCleaningScheduleCleanerInput,
) {
  await assertPermission(actor, "cleaning_schedules:update");
  if (!(await isGlobalAdmin(actor))) {
    throw new CleaningRuleError(ADMIN_ONLY_MESSAGE);
  }

  return prisma.$transaction(async (tx) => {
    const existing = await tx.cleaningSchedule.findUnique({
      where: { id: input.scheduleId },
      include: {
        cleaner: { select: { id: true, name: true } },
        property: { select: { id: true, name: true } },
      },
    });
    if (!existing) {
      throw new CleaningRuleError(
        "This cleaning no longer exists. Refresh the page.",
      );
    }
    if (CLEANER_LOCKED_STATUSES.includes(existing.status)) {
      throw new CleaningRuleError(
        `This cleaning is ${existing.status.toLowerCase()}, so its cleaner can't be changed.`,
      );
    }

    const cleaner =
      input.cleanerId === null
        ? null
        : await assertActiveCleaner(tx, input.cleanerId);
    const cleanerId = cleaner?.id ?? null;
    const cleanerName = cleaner?.name ?? null;
    if (existing.cleanerId === cleanerId) {
      return { changed: false, cleanerName };
    }

    const { count } = await tx.cleaningSchedule.updateMany({
      where: {
        id: existing.id,
        status: { notIn: [...CLEANER_LOCKED_STATUSES] },
      },
      data: { cleanerId },
    });
    if (count === 0) {
      throw new CleaningRuleError(
        "This cleaning was just completed, cancelled or marked missed. Refresh the page.",
      );
    }

    const propertyPrimaryCleanerId = await findCurrentPrimaryCleanerId(
      tx,
      existing.propertyId,
    );

    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cleaning_schedule.cleaner_changed",
        entityType: "CleaningSchedule",
        entityId: existing.id,
        beforeState: {
          cleanerId: existing.cleanerId,
          cleanerName: existing.cleaner?.name ?? null,
        },
        afterState: { cleanerId, cleanerName },
        metadata: {
          propertyId: existing.property.id,
          propertyName: existing.property.name,
          scheduleStatus: existing.status,
          propertyPrimaryCleanerId,
          isPropertyPrimary:
            cleanerId !== null && propertyPrimaryCleanerId === cleanerId,
        },
      },
      tx,
    );

    return { changed: true, cleanerName };
  });
}

function isSameUtcDate(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

/**
 * Lifecycle rules (2026-10-07), enforced here on the server — not only by
 * which buttons /cleaning shows — so every caller (forms, the cleaning.complete
 * AI tool, a stale page) gets the same answer:
 *   - complete / cancel / missed only from an OPEN job (SCHEDULED or
 *     IN_PROGRESS); a completed, cancelled or missed job can't be closed again
 *     or switched to another closed status;
 *   - reschedule an open or MISSED job; never a COMPLETED or CANCELLED one.
 *     Rescheduling a MISSED job reopens it as SCHEDULED (it still needs doing).
 * The status condition is part of each UPDATE, so a job closed a moment
 * earlier can't slip through between the read and the write.
 */
export const CLEANING_OPEN_STATUSES: readonly CleaningStatus[] = [
  "SCHEDULED",
  "IN_PROGRESS",
];
export const CLEANING_RESCHEDULABLE_STATUSES: readonly CleaningStatus[] = [
  ...CLEANING_OPEN_STATUSES,
  "MISSED",
];

const STATUS_WORDS: Record<CleaningStatus, string> = {
  SCHEDULED: "scheduled",
  IN_PROGRESS: "in progress",
  COMPLETED: "completed",
  CANCELLED: "cancelled",
  MISSED: "marked missed",
};

const CHANGED_MEANWHILE_MESSAGE =
  "This cleaning was just changed by someone else. Refresh the page.";

async function findScheduleOrThrow(
  tx: Prisma.TransactionClient,
  scheduleId: string,
) {
  const existing = await tx.cleaningSchedule.findUnique({
    where: { id: scheduleId },
  });
  if (!existing) {
    throw new CleaningRuleError(
      "This cleaning no longer exists. Refresh the page.",
    );
  }
  return existing;
}

/**
 * originalScheduledDate is only ever set once — on the first reschedule —
 * and left alone on every reschedule after that, so it keeps meaning "the
 * date this was first scheduled for," not "the date before the most recent
 * change." The backing Task's dueAt moves with it so "tasks due today"
 * stays accurate. Submitting the same date back for an open job is a no-op,
 * not a reschedule — otherwise re-saving the form with nothing actually
 * changed would falsely mark the schedule as rescheduled. For a MISSED job
 * the same date is a real change: it reopens the job on that date.
 */
export async function rescheduleCleaningSchedule(
  actor: AuthContext,
  scheduleId: string,
  input: RescheduleCleaningScheduleInput,
) {
  await assertPermission(actor, "cleaning_schedules:update");

  return prisma.$transaction(async (tx) => {
    const existing = await findScheduleOrThrow(tx, scheduleId);
    if (!CLEANING_RESCHEDULABLE_STATUSES.includes(existing.status)) {
      throw new CleaningRuleError(
        `This cleaning is ${STATUS_WORDS[existing.status]}, so it can't be rescheduled.`,
      );
    }

    const reopen = existing.status === "MISSED";
    const dateChanged = !isSameUtcDate(
      existing.scheduledDate,
      input.scheduledDate,
    );
    if (!reopen && !dateChanged) return existing;

    const data = {
      ...(dateChanged && {
        scheduledDate: input.scheduledDate,
        originalScheduledDate:
          existing.originalScheduledDate ?? existing.scheduledDate,
      }),
      ...(reopen && { status: "SCHEDULED" as const }),
    };
    const { count } = await tx.cleaningSchedule.updateMany({
      where: {
        id: existing.id,
        status: { in: [...CLEANING_RESCHEDULABLE_STATUSES] },
      },
      data,
    });
    if (count === 0) throw new CleaningRuleError(CHANGED_MEANWHILE_MESSAGE);

    if (dateChanged) {
      await tx.task.update({
        where: { id: existing.taskId },
        data: { dueAt: input.scheduledDate },
      });
    }

    const schedule = { ...existing, ...data };
    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cleaning_schedule.rescheduled",
        entityType: "CleaningSchedule",
        entityId: existing.id,
        beforeState: existing,
        afterState: schedule,
        ...(reopen && { metadata: { reopenedFromMissed: true } }),
      },
      tx,
    );
    return schedule;
  });
}

/**
 * Moves an OPEN job to a closed status, with the status condition in the
 * UPDATE, the backing Task change (if any) in the same transaction, and an
 * audit entry carrying both the before and after state.
 */
async function closeCleaningSchedule(
  actor: AuthContext,
  scheduleId: string,
  to: "COMPLETED" | "CANCELLED" | "MISSED",
  action: string,
  taskData: Prisma.TaskUpdateInput | null,
) {
  await assertPermission(actor, "cleaning_schedules:update");

  return prisma.$transaction(async (tx) => {
    const existing = await findScheduleOrThrow(tx, scheduleId);
    if (!CLEANING_OPEN_STATUSES.includes(existing.status)) {
      throw new CleaningRuleError(
        `This cleaning is already ${STATUS_WORDS[existing.status]}, so it can't be ${STATUS_WORDS[to]}.`,
      );
    }

    const { count } = await tx.cleaningSchedule.updateMany({
      where: {
        id: existing.id,
        status: { in: [...CLEANING_OPEN_STATUSES] },
      },
      data: { status: to },
    });
    if (count === 0) throw new CleaningRuleError(CHANGED_MEANWHILE_MESSAGE);

    if (taskData) {
      await tx.task.update({ where: { id: existing.taskId }, data: taskData });
    }

    const schedule = { ...existing, status: to };
    await recordAudit(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action,
        entityType: "CleaningSchedule",
        entityId: existing.id,
        beforeState: existing,
        afterState: schedule,
      },
      tx,
    );
    return schedule;
  });
}

export async function completeCleaningSchedule(
  actor: AuthContext,
  scheduleId: string,
) {
  return closeCleaningSchedule(
    actor,
    scheduleId,
    "COMPLETED",
    "cleaning_schedule.completed",
    { status: "DONE", completedAt: new Date() },
  );
}

/** Cancelling the schedule also cancels the backing Task — there's no more work to do. */
export async function cancelCleaningSchedule(
  actor: AuthContext,
  scheduleId: string,
) {
  return closeCleaningSchedule(
    actor,
    scheduleId,
    "CANCELLED",
    "cleaning_schedule.cancelled",
    { status: "CANCELLED" },
  );
}

/**
 * A missed cleaning still needs doing — unlike cancel, the backing Task is
 * left as-is (not marked CANCELLED/DONE) so it still shows up as open work,
 * and rescheduling the job reopens it (see rescheduleCleaningSchedule).
 */
export async function markCleaningScheduleMissed(
  actor: AuthContext,
  scheduleId: string,
) {
  return closeCleaningSchedule(
    actor,
    scheduleId,
    "MISSED",
    "cleaning_schedule.missed",
    null,
  );
}
