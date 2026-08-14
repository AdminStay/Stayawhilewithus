import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type CleaningSchedule } from "@stayw/database";

export type { CleaningSchedule };

import type {
  CreateCleaningScheduleInput,
  RescheduleCleaningScheduleInput,
} from "../schemas/cleaning.schema";

import { recordAudit } from "@/platform/audit/record-audit";

const CLEANING_TYPE_LABELS: Record<string, string> = {
  TURNOVER: "Turnover cleaning",
  DEEP_CLEAN: "Deep clean",
  INSPECTION_CLEAN: "Inspection clean",
  MAINTENANCE_CLEAN: "Maintenance clean",
};

export async function listCleaningSchedules(actor: AuthContext) {
  await assertPermission(actor, "cleaning_schedules:read");
  return prisma.cleaningSchedule.findMany({
    orderBy: { scheduledDate: "asc" },
    include: { property: true, reservation: true, task: true },
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
 */
export async function createCleaningSchedule(
  actor: AuthContext,
  input: CreateCleaningScheduleInput,
) {
  await assertPermission(actor, "cleaning_schedules:create");

  const schedule = await prisma.$transaction(async (tx) => {
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

    return tx.cleaningSchedule.create({
      data: {
        propertyId: input.propertyId,
        reservationId: input.reservationId || undefined,
        taskId: task.id,
        cleaningType: input.cleaningType,
        scheduledDate: input.scheduledDate,
        scheduledStartTime: input.scheduledStartTime || undefined,
        scheduledEndTime: input.scheduledEndTime || undefined,
      },
    });
  });

  await recordAudit({
    actorUserId: actor.userId,
    actorType: "USER",
    action: "cleaning_schedule.created",
    entityType: "CleaningSchedule",
    entityId: schedule.id,
    afterState: schedule,
  });

  return schedule;
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
