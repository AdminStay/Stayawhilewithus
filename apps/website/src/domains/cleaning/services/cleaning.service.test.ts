import { describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => {
  const tx = {
    task: { create: vi.fn(), update: vi.fn() },
    cleaningSchedule: { create: vi.fn(), update: vi.fn() },
  };
  return {
    prisma: {
      cleaningSchedule: {
        findMany: vi.fn(),
        update: vi.fn(),
        findUniqueOrThrow: vi.fn(),
      },
      $transaction: vi.fn((callback: (tx: unknown) => unknown) => callback(tx)),
      __tx: tx,
    },
  };
});

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  cancelCleaningSchedule,
  completeCleaningSchedule,
  createCleaningSchedule,
  listCleaningSchedules,
  listRecentlyRescheduledCleanings,
  markCleaningScheduleMissed,
  rescheduleCleaningSchedule,
} from "./cleaning.service";

import { recordAudit } from "@/platform/audit/record-audit";

const actor = { userId: "user-1" };

const scheduleInput = {
  propertyId: "prop-1",
  reservationId: "",
  cleaningType: "TURNOVER" as const,
  scheduledDate: new Date("2026-09-01"),
  scheduledStartTime: "",
  scheduledEndTime: "",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tx = (prisma as any).__tx;

describe("listCleaningSchedules", () => {
  it("returns schedules with property/reservation/task relations when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.cleaningSchedule.findMany).mockResolvedValueOnce([
      { id: "cs1" },
    ] as never);

    const result = await listCleaningSchedules(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:read",
    );
    expect(prisma.cleaningSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: { property: true, reservation: true, task: true },
      }),
    );
    expect(result).toEqual([{ id: "cs1" }]);
  });

  it("propagates denial when the actor lacks cleaning_schedules:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listCleaningSchedules(actor)).rejects.toThrow();
    expect(prisma.cleaningSchedule.findMany).not.toHaveBeenCalled();
  });
});

describe("createCleaningSchedule", () => {
  it("creates the backing Task and the CleaningSchedule in one transaction, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const task = { id: "task-1" };
    const created = { id: "cs1", taskId: "task-1", ...scheduleInput };
    vi.mocked(tx.task.create).mockResolvedValueOnce(task as never);
    vi.mocked(tx.cleaningSchedule.create).mockResolvedValueOnce(
      created as never,
    );

    const result = await createCleaningSchedule(actor, scheduleInput);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:create",
    );
    expect(tx.task.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "CLEANING",
        propertyId: "prop-1",
        reservationId: undefined,
        createdByUserId: actor.userId,
      }),
    });
    expect(tx.cleaningSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        propertyId: "prop-1",
        reservationId: undefined,
        taskId: "task-1",
        cleaningType: "TURNOVER",
      }),
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "cleaning_schedule.created",
        entityType: "CleaningSchedule",
        entityId: "cs1",
      }),
    );
    expect(result).toEqual(created);
  });

  it("denies creation and performs no writes when the actor lacks cleaning_schedules:create", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      createCleaningSchedule(actor, scheduleInput),
    ).rejects.toThrow();
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("completeCleaningSchedule", () => {
  it("marks the schedule COMPLETED and the linked Task DONE, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "cs1", taskId: "task-1", status: "COMPLETED" };
    vi.mocked(tx.cleaningSchedule.update).mockResolvedValueOnce(
      updated as never,
    );
    vi.mocked(tx.task.update).mockResolvedValueOnce({} as never);

    const result = await completeCleaningSchedule(actor, "cs1");

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
    );
    expect(tx.cleaningSchedule.update).toHaveBeenCalledWith({
      where: { id: "cs1" },
      data: { status: "COMPLETED" },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { status: "DONE", completedAt: expect.any(Date) },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "cleaning_schedule.completed",
        entityType: "CleaningSchedule",
        entityId: "cs1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies completion and performs no writes when the actor lacks cleaning_schedules:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(completeCleaningSchedule(actor, "cs1")).rejects.toThrow();
    expect(tx.cleaningSchedule.update).not.toHaveBeenCalled();
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("cancelCleaningSchedule", () => {
  it("marks the schedule and linked Task CANCELLED, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "cs1", taskId: "task-1", status: "CANCELLED" };
    vi.mocked(tx.cleaningSchedule.update).mockResolvedValueOnce(
      updated as never,
    );
    vi.mocked(tx.task.update).mockResolvedValueOnce({} as never);

    const result = await cancelCleaningSchedule(actor, "cs1");

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
    );
    expect(tx.cleaningSchedule.update).toHaveBeenCalledWith({
      where: { id: "cs1" },
      data: { status: "CANCELLED" },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { status: "CANCELLED" },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "cleaning_schedule.cancelled",
        entityType: "CleaningSchedule",
        entityId: "cs1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies cancellation and performs no writes when the actor lacks cleaning_schedules:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(cancelCleaningSchedule(actor, "cs1")).rejects.toThrow();
    expect(tx.cleaningSchedule.update).not.toHaveBeenCalled();
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("markCleaningScheduleMissed", () => {
  it("marks the schedule MISSED without touching the backing Task, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const updated = { id: "cs1", taskId: "task-1", status: "MISSED" };
    vi.mocked(prisma.cleaningSchedule.update).mockResolvedValueOnce(
      updated as never,
    );

    const result = await markCleaningScheduleMissed(actor, "cs1");

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
    );
    expect(prisma.cleaningSchedule.update).toHaveBeenCalledWith({
      where: { id: "cs1" },
      data: { status: "MISSED" },
    });
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "cleaning_schedule.missed",
        entityType: "CleaningSchedule",
        entityId: "cs1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("denies the transition and performs no writes when the actor lacks cleaning_schedules:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(markCleaningScheduleMissed(actor, "cs1")).rejects.toThrow();
    expect(prisma.cleaningSchedule.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("rescheduleCleaningSchedule", () => {
  const newDate = new Date("2026-09-05");

  it("is a no-op — no writes, no audit — when the submitted date matches the current date", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    const existing = {
      id: "cs1",
      taskId: "task-1",
      scheduledDate: new Date("2026-09-01"),
      originalScheduledDate: null,
    };
    vi.mocked(prisma.cleaningSchedule.findUniqueOrThrow).mockResolvedValueOnce(
      existing as never,
    );

    const result = await rescheduleCleaningSchedule(actor, "cs1", {
      scheduledDate: new Date("2026-09-01"),
    });

    expect(tx.cleaningSchedule.update).not.toHaveBeenCalled();
    expect(tx.task.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
    expect(result).toEqual(existing);
  });

  it("sets originalScheduledDate to the current date on a first reschedule, moves the backing Task's dueAt, and audits it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.cleaningSchedule.findUniqueOrThrow).mockResolvedValueOnce({
      id: "cs1",
      taskId: "task-1",
      scheduledDate: new Date("2026-09-01"),
      originalScheduledDate: null,
    } as never);
    const updated = {
      id: "cs1",
      taskId: "task-1",
      scheduledDate: newDate,
      originalScheduledDate: new Date("2026-09-01"),
    };
    vi.mocked(tx.cleaningSchedule.update).mockResolvedValueOnce(
      updated as never,
    );
    vi.mocked(tx.task.update).mockResolvedValueOnce({} as never);

    const result = await rescheduleCleaningSchedule(actor, "cs1", {
      scheduledDate: newDate,
    });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
    );
    expect(tx.cleaningSchedule.update).toHaveBeenCalledWith({
      where: { id: "cs1" },
      data: {
        scheduledDate: newDate,
        originalScheduledDate: new Date("2026-09-01"),
      },
    });
    expect(tx.task.update).toHaveBeenCalledWith({
      where: { id: "task-1" },
      data: { dueAt: newDate },
    });
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: actor.userId,
        action: "cleaning_schedule.rescheduled",
        entityType: "CleaningSchedule",
        entityId: "cs1",
      }),
    );
    expect(result).toEqual(updated);
  });

  it("keeps the true original date on a second reschedule instead of overwriting it", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.cleaningSchedule.findUniqueOrThrow).mockResolvedValueOnce({
      id: "cs1",
      taskId: "task-1",
      scheduledDate: new Date("2026-09-05"),
      originalScheduledDate: new Date("2026-09-01"),
    } as never);
    vi.mocked(tx.cleaningSchedule.update).mockResolvedValueOnce({} as never);
    vi.mocked(tx.task.update).mockResolvedValueOnce({} as never);

    await rescheduleCleaningSchedule(actor, "cs1", {
      scheduledDate: new Date("2026-09-10"),
    });

    expect(tx.cleaningSchedule.update).toHaveBeenCalledWith({
      where: { id: "cs1" },
      data: {
        scheduledDate: new Date("2026-09-10"),
        originalScheduledDate: new Date("2026-09-01"),
      },
    });
  });

  it("denies rescheduling and performs no writes when the actor lacks cleaning_schedules:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      rescheduleCleaningSchedule(actor, "cs1", { scheduledDate: newDate }),
    ).rejects.toThrow();
    expect(prisma.cleaningSchedule.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.update).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe("listRecentlyRescheduledCleanings", () => {
  it("returns only schedules with a non-null originalScheduledDate, most recently updated first", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.cleaningSchedule.findMany).mockResolvedValueOnce([
      { id: "cs1" },
    ] as never);

    const result = await listRecentlyRescheduledCleanings(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:read",
    );
    expect(prisma.cleaningSchedule.findMany).toHaveBeenCalledWith({
      where: { originalScheduledDate: { not: null } },
      orderBy: { updatedAt: "desc" },
      take: 10,
      include: { property: true },
    });
    expect(result).toEqual([{ id: "cs1" }]);
  });

  it("propagates denial when the actor lacks cleaning_schedules:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listRecentlyRescheduledCleanings(actor)).rejects.toThrow();
    expect(prisma.cleaningSchedule.findMany).not.toHaveBeenCalled();
  });
});
