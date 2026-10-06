import { beforeEach, describe, expect, it, vi } from "vitest";

const { tx, mockPrisma } = vi.hoisted(() => {
  const tx = {
    cleaningSchedule: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  };
  const mockPrisma = {
    auditLog: { findMany: vi.fn() },
    $transaction: vi.fn(),
  };
  return { tx, mockPrisma };
});

vi.mock("@stayw/database", () => ({ prisma: mockPrisma }));
vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));
vi.mock("@/platform/audit/record-audit", () => ({ recordAudit: vi.fn() }));
vi.mock("@/platform/auth/is-global-admin", () => ({ isGlobalAdmin: vi.fn() }));
// Only CLEANER_LOCKED_STATUSES is used from the cleaning service.
vi.mock("./cleaning.service", () => ({
  CLEANER_LOCKED_STATUSES: ["COMPLETED", "CANCELLED", "MISSED"],
}));

import { assertPermission } from "@stayw/auth";

import {
  CLEANER_NOTIFIED_ACTION,
  parseNotifiedCleaner,
} from "../lib/cleaner-notification";
import { CleaningRuleError } from "../lib/errors";

import {
  listLatestCleanerNotifications,
  markCleanerNotified,
} from "./cleaner-notifications.service";

import { recordAudit } from "@/platform/audit/record-audit";
import { isGlobalAdmin } from "@/platform/auth/is-global-admin";

const actor = { userId: "admin-1" };
const SCHEDULE = "55555555-5555-5555-5555-555555555555";
const ALEX = "33333333-3333-3333-3333-333333333333";
const SAM = "44444444-4444-4444-4444-444444444444";
const NOW = new Date("2026-10-06T15:05:00Z");

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: SCHEDULE,
    status: "SCHEDULED",
    scheduledDate: new Date("2026-10-10T00:00:00Z"),
    cleaner: { id: ALEX, name: "Alex", status: "ACTIVE" },
    property: { id: "p-harbor", name: "Harbor House" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.$transaction.mockImplementation(
    async (fn: (t: typeof tx) => unknown) => fn(tx),
  );
  vi.mocked(assertPermission).mockResolvedValue(undefined);
  vi.mocked(isGlobalAdmin).mockResolvedValue(true);
  vi.mocked(recordAudit).mockResolvedValue({ occurredAt: NOW } as never);
});

function expectNoWrites() {
  expect(recordAudit).not.toHaveBeenCalled();
  expect(tx.cleaningSchedule.update).not.toHaveBeenCalled();
  expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
}

describe("markCleanerNotified (Cleaner Phase 5.2)", () => {
  it("records job, the cleaner assigned at that moment, the admin and the time, in one audit entry", async () => {
    tx.cleaningSchedule.findUnique.mockResolvedValueOnce(job());

    const result = await markCleanerNotified(actor, {
      scheduleId: SCHEDULE,
      cleanerId: ALEX,
    });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "cleaning_schedules:update",
    );
    expect(recordAudit).toHaveBeenCalledTimes(1);
    expect(recordAudit).toHaveBeenCalledWith(
      {
        actorUserId: "admin-1",
        actorType: "USER",
        action: CLEANER_NOTIFIED_ACTION,
        entityType: "CleaningSchedule",
        entityId: SCHEDULE,
        afterState: { cleanerId: ALEX, cleanerName: "Alex" },
        metadata: {
          propertyId: "p-harbor",
          propertyName: "Harbor House",
          scheduleStatus: "SCHEDULED",
          scheduledDate: "2026-10-10",
          method: "manual",
        },
      },
      tx,
    );
    expect(result).toEqual({ cleanerName: "Alex", notifiedAt: NOW });
  });

  it("never changes the cleaning job or its cleaner", async () => {
    tx.cleaningSchedule.findUnique.mockResolvedValueOnce(job());

    await markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX });

    expect(tx.cleaningSchedule.update).not.toHaveBeenCalled();
    expect(tx.cleaningSchedule.updateMany).not.toHaveBeenCalled();
  });

  it("records no phone or contact detail (the job read selects none)", async () => {
    tx.cleaningSchedule.findUnique.mockResolvedValueOnce(job());

    await markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX });

    const select = tx.cleaningSchedule.findUnique.mock.calls[0]![0].select;
    expect(select.cleaner).toEqual({
      select: { id: true, name: true, status: true },
    });
    expect(JSON.stringify(vi.mocked(recordAudit).mock.calls)).not.toMatch(
      /phone/i,
    );
  });

  it("refuses a non-admin who holds cleaning_schedules:update, before any read or write", async () => {
    vi.mocked(isGlobalAdmin).mockResolvedValue(false);

    await expect(
      markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX }),
    ).rejects.toThrow("Only an admin");
    expect(tx.cleaningSchedule.findUnique).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("refuses an actor without cleaning_schedules:update", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX }),
    ).rejects.toThrow();
    expect(isGlobalAdmin).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it.each(["COMPLETED", "CANCELLED", "MISSED"])(
    "refuses a %s job",
    async (status) => {
      tx.cleaningSchedule.findUnique.mockResolvedValueOnce(job({ status }));

      await expect(
        markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX }),
      ).rejects.toThrow(CleaningRuleError);
      expectNoWrites();
    },
  );

  it("refuses a job with no cleaner", async () => {
    tx.cleaningSchedule.findUnique.mockResolvedValueOnce(
      job({ cleaner: null }),
    );

    await expect(
      markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX }),
    ).rejects.toThrow("no cleaner yet");
    expectNoWrites();
  });

  it("refuses when the job's cleaner changed since the page was loaded", async () => {
    tx.cleaningSchedule.findUnique.mockResolvedValueOnce(
      job({ cleaner: { id: SAM, name: "Sam", status: "ACTIVE" } }),
    );

    await expect(
      markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX }),
    ).rejects.toThrow("cleaner was just changed");
    expectNoWrites();
  });

  it("refuses an inactive cleaner — the job needs a new cleaner, not a notification (2026-10-07)", async () => {
    tx.cleaningSchedule.findUnique.mockResolvedValueOnce(
      job({ cleaner: { id: ALEX, name: "Alex", status: "INACTIVE" } }),
    );

    const err = await markCleanerNotified(actor, {
      scheduleId: SCHEDULE,
      cleanerId: ALEX,
    }).catch((e: unknown) => e);

    expect(err).toBeInstanceOf(CleaningRuleError);
    expect((err as Error).message).toMatch(/Alex is inactive/);
    expectNoWrites();
  });

  it("refuses a missing job", async () => {
    tx.cleaningSchedule.findUnique.mockResolvedValueOnce(null);

    await expect(
      markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX }),
    ).rejects.toThrow("no longer exists");
    expectNoWrites();
  });

  it("records a new entry each time (history, not a flag)", async () => {
    tx.cleaningSchedule.findUnique
      .mockResolvedValueOnce(job())
      .mockResolvedValueOnce(job());

    await markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX });
    await markCleanerNotified(actor, { scheduleId: SCHEDULE, cleanerId: ALEX });

    expect(recordAudit).toHaveBeenCalledTimes(2);
  });
});

describe("listLatestCleanerNotifications (Cleaner Phase 5.2)", () => {
  it("returns the latest notification per job from the audit trail (newest first)", async () => {
    const newer = new Date("2026-10-06T15:00:00Z");
    const older = new Date("2026-10-05T15:00:00Z");
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([
      {
        entityId: "job-1",
        afterState: { cleanerId: SAM, cleanerName: "Sam" },
        occurredAt: newer,
        actorUser: { firstName: "Michelle", lastName: null },
      },
      {
        entityId: "job-1",
        afterState: { cleanerId: ALEX, cleanerName: "Alex" },
        occurredAt: older,
        actorUser: { firstName: "Kenny", lastName: "B" },
      },
      {
        entityId: "job-2",
        afterState: { cleanerId: ALEX, cleanerName: "Alex" },
        occurredAt: older,
        actorUser: null,
      },
    ]);

    const latest = await listLatestCleanerNotifications(actor, [
      "job-1",
      "job-2",
    ]);

    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          entityType: "CleaningSchedule",
          entityId: { in: ["job-1", "job-2"] },
          action: CLEANER_NOTIFIED_ACTION,
        },
        orderBy: { occurredAt: "desc" },
      }),
    );
    expect(Object.fromEntries(latest)).toEqual({
      "job-1": {
        cleanerId: SAM,
        cleanerName: "Sam",
        notifiedAt: newer,
        notifiedByName: "Michelle",
      },
      "job-2": {
        cleanerId: ALEX,
        cleanerName: "Alex",
        notifiedAt: older,
        notifiedByName: null,
      },
    });
  });

  it("skips a malformed stored entry instead of failing", async () => {
    mockPrisma.auditLog.findMany.mockResolvedValueOnce([
      {
        entityId: "job-1",
        afterState: { unexpected: true },
        occurredAt: NOW,
        actorUser: null,
      },
    ]);

    expect((await listLatestCleanerNotifications(actor, ["job-1"])).size).toBe(
      0,
    );
  });

  it("makes no query for an empty list", async () => {
    await listLatestCleanerNotifications(actor, []);
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("is admin only", async () => {
    vi.mocked(isGlobalAdmin).mockResolvedValue(false);

    await expect(
      listLatestCleanerNotifications(actor, ["job-1"]),
    ).rejects.toThrow("Only an admin");
    expect(mockPrisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe("parseNotifiedCleaner", () => {
  it.each([
    [
      { cleanerId: "c", cleanerName: "n" },
      { cleanerId: "c", cleanerName: "n" },
    ],
    [null, null],
    ["text", null],
    [{ cleanerId: 1, cleanerName: "n" }, null],
    [{ cleanerId: "c" }, null],
  ])("%j → %j", (input, expected) => {
    expect(parseNotifiedCleaner(input)).toEqual(expected);
  });
});
