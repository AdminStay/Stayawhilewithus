import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => {
  const tx = {
    task: { create: vi.fn(), update: vi.fn() },
    cleaningSchedule: {
      create: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    // findCurrentPrimaryCleanerId (cleaners domain) runs for real against
    // this mock, inside the same transaction as the create.
    propertyCleanerAssignment: { findFirst: vi.fn() },
    cleaner: { findUnique: vi.fn() },
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
  hasPermission: vi.fn(),
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: vi.fn(),
}));

vi.mock("@/platform/auth/is-global-admin", () => ({
  isGlobalAdmin: vi.fn(),
}));

import { assertPermission, hasPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { CleaningRuleError } from "../lib/errors";

import {
  assignCleaningScheduleCleaner,
  cancelCleaningSchedule,
  canChangeCleaningCleaner,
  completeCleaningSchedule,
  createCleaningSchedule,
  listCleaningJobsNeedingCleaner,
  listCleaningSchedules,
  listRecentlyRescheduledCleanings,
  markCleaningScheduleMissed,
  rescheduleCleaningSchedule,
} from "./cleaning.service";

import { recordAudit } from "@/platform/audit/record-audit";
import { isGlobalAdmin } from "@/platform/auth/is-global-admin";

// clearMocks resets calls between tests but not queued *Once values or
// implementations — reset the Phase 4 mocks fully so one test's leftovers
// can't leak into the next.
beforeEach(() => {
  vi.mocked(hasPermission).mockReset();
  vi.mocked(isGlobalAdmin).mockReset();
  for (const fn of [
    tx.propertyCleanerAssignment.findFirst,
    tx.cleaner.findUnique,
    tx.cleaningSchedule.findUnique,
    tx.cleaningSchedule.updateMany,
  ]) {
    vi.mocked(fn).mockReset();
  }
  vi.mocked(tx.propertyCleanerAssignment.findFirst).mockResolvedValue(null);
});

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
  it("returns schedules with property/reservation/task relations and the job's cleaner (name only) for cleaners:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(hasPermission).mockResolvedValueOnce(true);
    const row = {
      id: "cs1",
      cleanerId: "c1",
      cleaner: { id: "c1", name: "Alex", status: "ACTIVE" },
    };
    vi.mocked(prisma.cleaningSchedule.findMany).mockResolvedValueOnce([
      row,
    ] as never);

    const result = await listCleaningSchedules(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:read",
    );
    expect(hasPermission).toHaveBeenCalledWith(actor, "cleaners:read");
    expect(prisma.cleaningSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          property: true,
          reservation: true,
          task: true,
          // A select, never the whole Cleaner row — no phone field.
          cleaner: { select: { id: true, name: true, status: true } },
        },
      }),
    );
    expect(result).toEqual([row]);
  });

  it("hides the job's cleaner from a viewer without cleaners:read", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(hasPermission).mockResolvedValueOnce(false);
    vi.mocked(prisma.cleaningSchedule.findMany).mockResolvedValueOnce([
      {
        id: "cs1",
        cleanerId: "c1",
        cleaner: { id: "c1", name: "Alex", status: "ACTIVE" },
      },
    ] as never);

    const result = await listCleaningSchedules(actor);

    expect(result).toEqual([{ id: "cs1", cleanerId: null, cleaner: null }]);
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

// ── Cleaner Phase 4 ─────────────────────────────────────────────────────

const PROPERTY = "22222222-2222-2222-2222-222222222222";
const SCHEDULE = "55555555-5555-5555-5555-555555555555";
const ALEX = "33333333-3333-3333-3333-333333333333";
const SAM = "44444444-4444-4444-4444-444444444444";
const KRIS = "66666666-6666-6666-6666-666666666666";
const LOLIS = "77777777-7777-7777-7777-777777777777";
const NAMES: Record<string, string> = {
  [ALEX]: "Alex",
  [SAM]: "Sam",
  [KRIS]: "Kris",
  [LOLIS]: "Lolis",
};

const phase4Input = { ...scheduleInput, propertyId: PROPERTY };

/** The property's current ACTIVE PRIMARY, as the real lookup would return it. */
function primaryIs(cleanerId: string | null) {
  vi.mocked(tx.propertyCleanerAssignment.findFirst).mockResolvedValue(
    cleanerId ? { cleanerId } : null,
  );
}

function cleanerRow(id: string, status: "ACTIVE" | "INACTIVE" = "ACTIVE") {
  return { id, name: NAMES[id], status };
}

function asAdmin() {
  vi.mocked(hasPermission).mockResolvedValue(true);
  vi.mocked(isGlobalAdmin).mockResolvedValue(true);
}

function mockCreateSucceeds() {
  vi.mocked(tx.task.create).mockResolvedValueOnce({ id: "task-1" } as never);
  vi.mocked(tx.cleaningSchedule.create).mockImplementationOnce(
    async ({ data }: { data: Record<string, unknown> }) =>
      ({ id: SCHEDULE, ...data }) as never,
  );
}

function createdCleanerId() {
  return vi.mocked(tx.cleaningSchedule.create).mock.calls[0]?.[0].data
    .cleanerId;
}

describe("createCleaningSchedule — default cleaner (Cleaner Phase 4)", () => {
  it("stores the property's current PRIMARY as the job's cleaner, without needing admin", async () => {
    primaryIs(ALEX);
    mockCreateSucceeds();

    await createCleaningSchedule(actor, phase4Input);

    expect(createdCleanerId()).toBe(ALEX);
    expect(isGlobalAdmin).not.toHaveBeenCalled();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cleaning_schedule.created",
        metadata: { cleanerSource: "property_primary" },
      }),
    );
  });

  it("looks up only a CURRENT (not ended) PRIMARY whose cleaner is ACTIVE — never a TEAM_MEMBER", async () => {
    primaryIs(ALEX);
    mockCreateSucceeds();

    await createCleaningSchedule(actor, phase4Input);

    expect(tx.propertyCleanerAssignment.findFirst).toHaveBeenCalledWith({
      where: {
        propertyId: PROPERTY,
        endedAt: null,
        role: "PRIMARY",
        cleaner: { status: "ACTIVE" },
      },
      select: { cleanerId: true },
    });
  });

  it("leaves cleanerId NULL when the property has no PRIMARY", async () => {
    primaryIs(null);
    mockCreateSucceeds();

    await createCleaningSchedule(actor, phase4Input);

    expect(createdCleanerId()).toBeNull();
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { cleanerSource: "none" } }),
    );
  });

  it("never selects a TEAM_MEMBER automatically (team-only property → no cleaner)", async () => {
    // A team-only property: the PRIMARY lookup finds nothing, and nothing
    // else is consulted — the team members are never a fallback.
    primaryIs(null);
    mockCreateSucceeds();

    await createCleaningSchedule(actor, phase4Input);

    expect(createdCleanerId()).toBeNull();
    expect(tx.propertyCleanerAssignment.findFirst).toHaveBeenCalledTimes(1);
    expect(tx.cleaner.findUnique).not.toHaveBeenCalled();
  });

  it("ignores an ended PRIMARY assignment (only endedAt: null rows count)", async () => {
    // The previous primary's row has endedAt set, so the lookup — which
    // filters endedAt: null — returns nothing.
    primaryIs(null);
    mockCreateSucceeds();

    await createCleaningSchedule(actor, phase4Input);

    const where = vi.mocked(tx.propertyCleanerAssignment.findFirst).mock
      .calls[0]?.[0].where;
    expect(where.endedAt).toBeNull();
    expect(createdCleanerId()).toBeNull();
  });

  it("accepts an explicit cleaner equal to the default without needing admin", async () => {
    primaryIs(ALEX);
    mockCreateSucceeds();

    await createCleaningSchedule(actor, { ...phase4Input, cleanerId: ALEX });

    expect(createdCleanerId()).toBe(ALEX);
    expect(isGlobalAdmin).not.toHaveBeenCalled();
  });

  it("lets an admin's explicit cleaner selection override the default", async () => {
    primaryIs(ALEX);
    asAdmin();
    vi.mocked(tx.cleaner.findUnique).mockResolvedValueOnce(cleanerRow(SAM));
    mockCreateSucceeds();

    await createCleaningSchedule(actor, { ...phase4Input, cleanerId: SAM });

    expect(createdCleanerId()).toBe(SAM);
    expect(recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { cleanerSource: "selected" } }),
    );
  });

  it('lets an admin explicitly choose no cleaner ("") even when a PRIMARY exists', async () => {
    primaryIs(ALEX);
    asAdmin();
    mockCreateSucceeds();

    await createCleaningSchedule(actor, { ...phase4Input, cleanerId: "" });

    expect(createdCleanerId()).toBeNull();
  });

  it("refuses a non-default cleaner from a non-admin, and writes nothing", async () => {
    primaryIs(ALEX);
    vi.mocked(hasPermission).mockResolvedValue(true);
    vi.mocked(isGlobalAdmin).mockResolvedValue(false);

    await expect(
      createCleaningSchedule(actor, { ...phase4Input, cleanerId: SAM }),
    ).rejects.toThrow(CleaningRuleError);
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.create).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses an INACTIVE explicitly selected cleaner, and writes nothing", async () => {
    primaryIs(ALEX);
    asAdmin();
    vi.mocked(tx.cleaner.findUnique).mockResolvedValueOnce(
      cleanerRow(SAM, "INACTIVE"),
    );

    await expect(
      createCleaningSchedule(actor, { ...phase4Input, cleanerId: SAM }),
    ).rejects.toThrow("Sam is inactive");
    expect(tx.task.create).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.create).not.toHaveBeenCalled();
  });
});

describe("canChangeCleaningCleaner", () => {
  it.each([
    [true, true, true],
    [true, false, false],
    [false, true, false],
  ])(
    "cleaning_schedules:update=%s + global admin=%s → %s",
    async (perm, admin, expected) => {
      vi.mocked(hasPermission).mockResolvedValue(perm);
      vi.mocked(isGlobalAdmin).mockResolvedValue(admin);
      expect(await canChangeCleaningCleaner(actor)).toBe(expected);
    },
  );
});

describe("assignCleaningScheduleCleaner — per-job override (Cleaner Phase 4)", () => {
  function existingJob(overrides: Record<string, unknown> = {}) {
    return {
      id: SCHEDULE,
      propertyId: PROPERTY,
      status: "SCHEDULED",
      cleanerId: ALEX,
      cleaner: { id: ALEX, name: "Alex" },
      property: { id: PROPERTY, name: "Harbor House" },
      ...overrides,
    };
  }

  function arrange({
    job = existingJob(),
    cleaner = cleanerRow(SAM),
    primary = ALEX as string | null,
  } = {}) {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(isGlobalAdmin).mockResolvedValue(true);
    vi.mocked(tx.cleaningSchedule.findUnique).mockResolvedValueOnce(job);
    vi.mocked(tx.cleaner.findUnique).mockResolvedValueOnce(cleaner);
    vi.mocked(tx.cleaningSchedule.updateMany).mockResolvedValueOnce({
      count: 1,
    });
    primaryIs(primary);
  }

  it("accepts an ACTIVE cleaner (even one who isn't the property's PRIMARY) and stores it on the job", async () => {
    arrange();

    const result = await assignCleaningScheduleCleaner(actor, {
      scheduleId: SCHEDULE,
      cleanerId: SAM,
    });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
    );
    expect(tx.cleaningSchedule.updateMany).toHaveBeenCalledWith({
      where: {
        id: SCHEDULE,
        status: { notIn: ["COMPLETED", "CANCELLED", "MISSED"] },
      },
      data: { cleanerId: SAM },
    });
    expect(result).toEqual({ changed: true, cleanerName: "Sam" });
  });

  it("records an audit entry with the before and after cleaner, in the same transaction", async () => {
    arrange();

    await assignCleaningScheduleCleaner(actor, {
      scheduleId: SCHEDULE,
      cleanerId: SAM,
    });

    expect(recordAudit).toHaveBeenCalledWith(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cleaning_schedule.cleaner_changed",
        entityType: "CleaningSchedule",
        entityId: SCHEDULE,
        beforeState: { cleanerId: ALEX, cleanerName: "Alex" },
        afterState: { cleanerId: SAM, cleanerName: "Sam" },
        metadata: {
          propertyId: PROPERTY,
          propertyName: "Harbor House",
          scheduleStatus: "SCHEDULED",
          propertyPrimaryCleanerId: ALEX,
          isPropertyPrimary: false,
        },
      },
      tx,
    );
  });

  it("audits a first assignment (no cleaner before) with a null before-state", async () => {
    arrange({ job: existingJob({ cleanerId: null, cleaner: null }) });

    await assignCleaningScheduleCleaner(actor, {
      scheduleId: SCHEDULE,
      cleanerId: SAM,
    });

    expect(vi.mocked(recordAudit).mock.calls[0]?.[0].beforeState).toEqual({
      cleanerId: null,
      cleanerName: null,
    });
  });

  it("never reads or records a phone number", async () => {
    arrange();

    await assignCleaningScheduleCleaner(actor, {
      scheduleId: SCHEDULE,
      cleanerId: SAM,
    });

    expect(tx.cleaner.findUnique).toHaveBeenCalledWith({
      where: { id: SAM },
      select: { id: true, name: true, status: true },
    });
    const include = vi.mocked(tx.cleaningSchedule.findUnique).mock.calls[0]?.[0]
      .include;
    expect(include.cleaner).toEqual({ select: { id: true, name: true } });
    expect(JSON.stringify(vi.mocked(recordAudit).mock.calls)).not.toMatch(
      /phone/i,
    );
  });

  it("rejects an INACTIVE cleaner and writes nothing", async () => {
    arrange({ cleaner: cleanerRow(SAM, "INACTIVE") });

    await expect(
      assignCleaningScheduleCleaner(actor, {
        scheduleId: SCHEDULE,
        cleanerId: SAM,
      }),
    ).rejects.toThrow("Sam is inactive");
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects an actor without cleaning_schedules:update, before any read or write", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      assignCleaningScheduleCleaner(actor, {
        scheduleId: SCHEDULE,
        cleanerId: SAM,
      }),
    ).rejects.toThrow();
    expect(tx.cleaningSchedule.findUnique).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("rejects a non-admin who holds cleaning_schedules:update (e.g. the cleaner role)", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(isGlobalAdmin).mockResolvedValue(false);

    await expect(
      assignCleaningScheduleCleaner(actor, {
        scheduleId: SCHEDULE,
        cleanerId: SAM,
      }),
    ).rejects.toThrow("Only an admin");
    expect(tx.cleaningSchedule.findUnique).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "CANCELLED", "MISSED"])(
    "rejects assigning a cleaner to a %s job and writes nothing",
    async (status) => {
      arrange({ job: existingJob({ status }) });

      await expect(
        assignCleaningScheduleCleaner(actor, {
          scheduleId: SCHEDULE,
          cleanerId: SAM,
        }),
      ).rejects.toThrow(CleaningRuleError);
      expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );

  it("rejects a MISSED job even when it has no cleaner yet", async () => {
    arrange({
      job: existingJob({ status: "MISSED", cleanerId: null, cleaner: null }),
    });

    await expect(
      assignCleaningScheduleCleaner(actor, {
        scheduleId: SCHEDULE,
        cleanerId: SAM,
      }),
    ).rejects.toThrow(
      "This cleaning is missed, so its cleaner can't be changed.",
    );
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses when the job is closed between the read and the write (guarded UPDATE matches 0 rows)", async () => {
    arrange();
    vi.mocked(tx.cleaningSchedule.updateMany)
      .mockReset()
      .mockResolvedValueOnce({ count: 0 });

    await expect(
      assignCleaningScheduleCleaner(actor, {
        scheduleId: SCHEDULE,
        cleanerId: SAM,
      }),
    ).rejects.toThrow("just completed, cancelled or marked missed");
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("is a no-op (no write, no audit) when the job already has that cleaner", async () => {
    arrange({ cleaner: cleanerRow(ALEX) });

    const result = await assignCleaningScheduleCleaner(actor, {
      scheduleId: SCHEDULE,
      cleanerId: ALEX,
    });

    expect(result).toEqual({ changed: false, cleanerName: "Alex" });
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });
});

describe.each([
  ["Sandy Nudes", "SANDY-NUDES"],
  ["Roseate Madre", "Roseate Madre"],
])("team-only property %s (Kris + Lolis, no PRIMARY)", (propertyName) => {
  it("creates its cleaning with no cleaner — neither team member is designated", async () => {
    primaryIs(null);
    mockCreateSucceeds();

    await createCleaningSchedule(actor, phase4Input);

    expect(createdCleanerId()).toBeNull();
  });

  it.each([
    [KRIS, "Kris"],
    [LOLIS, "Lolis"],
  ])(
    "lets an admin assign %s (%s) to an individual cleaning",
    async (cleanerId, name) => {
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(isGlobalAdmin).mockResolvedValue(true);
      vi.mocked(tx.cleaningSchedule.findUnique).mockResolvedValueOnce({
        id: SCHEDULE,
        propertyId: PROPERTY,
        status: "SCHEDULED",
        cleanerId: null,
        cleaner: null,
        property: { id: PROPERTY, name: propertyName },
      });
      vi.mocked(tx.cleaner.findUnique).mockResolvedValueOnce(
        cleanerRow(cleanerId),
      );
      vi.mocked(tx.cleaningSchedule.updateMany).mockResolvedValueOnce({
        count: 1,
      });
      primaryIs(null);

      const result = await assignCleaningScheduleCleaner(actor, {
        scheduleId: SCHEDULE,
        cleanerId,
      });

      expect(result).toEqual({ changed: true, cleanerName: name });
      expect(vi.mocked(recordAudit).mock.calls[0]?.[0].metadata).toEqual(
        expect.objectContaining({
          propertyName,
          propertyPrimaryCleanerId: null,
          isPropertyPrimary: false,
        }),
      );
    },
  );
});

describe("assignCleaningScheduleCleaner with cleanerId null — clear back to Needs cleaner", () => {
  function job(overrides: Record<string, unknown> = {}) {
    return {
      id: SCHEDULE,
      propertyId: PROPERTY,
      status: "SCHEDULED",
      cleanerId: ALEX,
      cleaner: { id: ALEX, name: "Alex" },
      property: { id: PROPERTY, name: "Harbor House" },
      ...overrides,
    };
  }

  function arrangeClear(j = job()) {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(isGlobalAdmin).mockResolvedValue(true);
    vi.mocked(tx.cleaningSchedule.findUnique).mockResolvedValueOnce(j);
    vi.mocked(tx.cleaningSchedule.updateMany).mockResolvedValueOnce({
      count: 1,
    });
    primaryIs(ALEX);
  }

  const clear = () =>
    assignCleaningScheduleCleaner(actor, {
      scheduleId: SCHEDULE,
      cleanerId: null,
    });

  it("lets an admin clear an assigned cleaner on an open job — only that job, nobody picked instead", async () => {
    arrangeClear();

    const result = await clear();

    expect(result).toEqual({ changed: true, cleanerName: null });
    expect(tx.cleaningSchedule.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.cleaningSchedule.updateMany).toHaveBeenCalledWith({
      where: {
        id: SCHEDULE,
        status: { notIn: ["COMPLETED", "CANCELLED", "MISSED"] },
      },
      data: { cleanerId: null },
    });
    // No cleaner lookup (no TEAM_MEMBER / PRIMARY fallback is chosen).
    expect(tx.cleaner.findUnique).not.toHaveBeenCalled();
  });

  it("writes the expected audit entry: before = previous cleaner, after = null/null, no phone", async () => {
    arrangeClear();

    await clear();

    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      {
        actorUserId: actor.userId,
        actorType: "USER",
        action: "cleaning_schedule.cleaner_changed",
        entityType: "CleaningSchedule",
        entityId: SCHEDULE,
        beforeState: { cleanerId: ALEX, cleanerName: "Alex" },
        afterState: { cleanerId: null, cleanerName: null },
        metadata: {
          propertyId: PROPERTY,
          propertyName: "Harbor House",
          scheduleStatus: "SCHEDULED",
          propertyPrimaryCleanerId: ALEX,
          isPropertyPrimary: false,
        },
      },
      tx,
    );
    expect(JSON.stringify(vi.mocked(recordAudit).mock.calls)).not.toMatch(
      /phone/i,
    );
  });

  it("is a no-op (no write, no audit) when the job already has no cleaner", async () => {
    arrangeClear(job({ cleanerId: null, cleaner: null }));

    const result = await clear();

    expect(result).toEqual({ changed: false, cleanerName: null });
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses a non-admin (even with cleaning_schedules:update), before any read or write", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(isGlobalAdmin).mockResolvedValue(false);

    await expect(clear()).rejects.toThrow("Only an admin");
    expect(tx.cleaningSchedule.findUnique).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it("refuses an actor without cleaning_schedules:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(clear()).rejects.toThrow();
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
    expect(recordAudit).not.toHaveBeenCalled();
  });

  it.each(["COMPLETED", "CANCELLED", "MISSED"])(
    "refuses to clear a %s job and writes nothing",
    async (status) => {
      arrangeClear(job({ status }));

      await expect(clear()).rejects.toThrow(CleaningRuleError);
      expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
      expect(recordAudit).not.toHaveBeenCalled();
    },
  );
});

describe("listCleaningJobsNeedingCleaner (Cleaner Phase 5.3)", () => {
  it("requires cleaning_schedules:read and cleaners:read, and queries open jobs with no cleaner", async () => {
    vi.mocked(assertPermission).mockResolvedValue(undefined);
    const rows = [{ id: "cs1", status: "SCHEDULED", cleanerId: null }];
    vi.mocked(prisma.cleaningSchedule.findMany).mockResolvedValueOnce(
      rows as never,
    );

    const result = await listCleaningJobsNeedingCleaner(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:read",
    );
    expect(assertPermission).toHaveBeenCalledWith(actor, "cleaners:read");
    expect(prisma.cleaningSchedule.findMany).toHaveBeenCalledWith({
      where: {
        cleanerId: null,
        // Same closed set as lib/needs-cleaner.ts and the cleaner-lock rule.
        status: { notIn: ["COMPLETED", "CANCELLED", "MISSED"] },
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
    expect(result).toEqual(rows);
  });

  it("refuses (no query) without cleaners:read, since a job's cleaner would be hidden", async () => {
    vi.mocked(assertPermission)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("ForbiddenError"));

    await expect(listCleaningJobsNeedingCleaner(actor)).rejects.toThrow();
    expect(prisma.cleaningSchedule.findMany).not.toHaveBeenCalled();
  });

  it("refuses (no query) without cleaning_schedules:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listCleaningJobsNeedingCleaner(actor)).rejects.toThrow();
    expect(prisma.cleaningSchedule.findMany).not.toHaveBeenCalled();
  });
});
