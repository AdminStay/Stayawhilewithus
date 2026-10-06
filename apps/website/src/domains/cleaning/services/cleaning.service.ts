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
 * Cleaner Phase 5.3 — OPEN cleaning jobs with no assigned cleaner (the
 * dashboard's "needs attention" count). Same definition as
 * lib/needs-cleaner.ts's needsCleaner(): cleanerId is null and the status
 * isn't COMPLETED/CANCELLED/MISSED. Read-only; assigns nothing.
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
      cleanerId: null,
      status: { notIn: [...CLEANER_LOCKED_STATUSES] },
    },
    orderBy: { scheduledDate: "asc" },
    select: {
      id: true,
      status: true,
      cleanerId: true,
      scheduledDate: true,
      property: { select: { name: true } },
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
 * originalScheduledDate is only ever set once — on the first reschedule —
 * and left alone on every reschedule after that, so it keeps meaning "the
 * date this was first scheduled for," not "the date before the most recent
 * change." The backing Task's dueAt moves with it so "tasks due today"
 * stays accurate. Submitting the same date back is a no-op, not a
 * reschedule — otherwise re-saving the form with nothing actually changed
 * would falsely mark the schedule as rescheduled.
 */
export async function rescheduleCleaningSchedule(
  actor: AuthContext,
  scheduleId: string,
  input: RescheduleCleaningScheduleInput,
) {
  await assertPermission(actor, "cleaning_schedules:update");

  const existing = await prisma.cleaningSchedule.findUniqueOrThrow({
    where: { id: scheduleId },
  });

  if (isSameUtcDate(existing.scheduledDate, input.scheduledDate)) {
    return existing;
  }

  const schedule = await prisma.$transaction(async (tx) => {
    const updated = await tx.cleaningSchedule.update({
      where: { id: scheduleId },
      data: {
        scheduledDate: input.scheduledDate,
        originalScheduledDate:
          existing.originalScheduledDate ?? existing.scheduledDate,
      },
    });

    await tx.task.update({
      where: { id: updated.taskId },
      data: { dueAt: input.scheduledDate },
    });

    return updated;
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "cleaning_schedule.rescheduled",
    entityType: "CleaningSchedule",
    entityId: schedule.id,
    beforeState: existing,
    afterState: schedule,
  });

  return schedule;
}

export async function completeCleaningSchedule(
  actor: AuthContext,
  scheduleId: string,
) {
  await assertPermission(actor, "cleaning_schedules:update");

  const schedule = await prisma.$transaction(async (tx) => {
    const updated = await tx.cleaningSchedule.update({
      where: { id: scheduleId },
      data: { status: "COMPLETED" },
    });

    await tx.task.update({
      where: { id: updated.taskId },
      data: { status: "DONE", completedAt: new Date() },
    });

    return updated;
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "cleaning_schedule.completed",
    entityType: "CleaningSchedule",
    entityId: schedule.id,
    afterState: schedule,
  });

  return schedule;
}

/** Cancelling the schedule also cancels the backing Task — there's no more work to do. */
export async function cancelCleaningSchedule(
  actor: AuthContext,
  scheduleId: string,
) {
  await assertPermission(actor, "cleaning_schedules:update");

  const schedule = await prisma.$transaction(async (tx) => {
    const updated = await tx.cleaningSchedule.update({
      where: { id: scheduleId },
      data: { status: "CANCELLED" },
    });

    await tx.task.update({
      where: { id: updated.taskId },
      data: { status: "CANCELLED" },
    });

    return updated;
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "cleaning_schedule.cancelled",
    entityType: "CleaningSchedule",
    entityId: schedule.id,
    afterState: schedule,
  });

  return schedule;
}

/**
 * A missed cleaning still needs doing — unlike cancel, the backing Task is
 * left as-is (not marked CANCELLED/DONE) so it still shows up as open work.
 */
export async function markCleaningScheduleMissed(
  actor: AuthContext,
  scheduleId: string,
) {
  await assertPermission(actor, "cleaning_schedules:update");

  const schedule = await prisma.cleaningSchedule.update({
    where: { id: scheduleId },
    data: { status: "MISSED" },
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "cleaning_schedule.missed",
    entityType: "CleaningSchedule",
    entityId: schedule.id,
    afterState: schedule,
  });

  return schedule;
}
