import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordAudit } = vi.hoisted(() => ({
  mockRecordAudit: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: { findUnique: vi.fn() },
    auditLog: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  clearLockOperationalHold,
  getActiveOperationalHolds,
  LOCK_OPERATIONAL_HOLD_ACTION,
  readActiveOperationalHold,
  setLockOperationalHold,
} from "./lock-operational-hold.service";

const actor = { userId: "admin-1" };
const LOCK = "11111111-1111-1111-1111-111111111111";
const HOLD = {
  kind: "OUT_OF_SERVICE",
  note: "Replacement ordered.",
  setAt: "2026-09-26T00:00:00.000Z",
  setByUserId: "admin-1",
};

beforeEach(() => {
  vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  vi.mocked(prisma.smartDevice.findUnique)
    .mockReset()
    .mockResolvedValue({
      id: LOCK,
      deviceType: "LOCK",
      propertyId: "p",
    } as never);
  vi.mocked(prisma.auditLog.findFirst).mockReset().mockResolvedValue(null);
  vi.mocked(prisma.auditLog.findMany).mockReset().mockResolvedValue([]);
  mockRecordAudit.mockClear();
});

describe("lock operational holds (2026-09-26)", () => {
  it("setting a hold requires GLOBAL locks:manage and writes ONE audit row — nothing else", async () => {
    const result = await setLockOperationalHold(actor, {
      smartDeviceId: LOCK,
      kind: "OUT_OF_SERVICE",
      note: "Replacement ordered.",
    });

    expect(result).toEqual({ status: "success" });
    expect(assertPermission).toHaveBeenCalledWith(actor, "locks:manage");
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit.mock.calls[0]![0]).toMatchObject({
      action: LOCK_OPERATIONAL_HOLD_ACTION,
      entityType: "SmartDevice",
      entityId: LOCK,
      afterState: {
        hold: {
          kind: "OUT_OF_SERVICE",
          note: "Replacement ordered.",
          setByUserId: "admin-1",
        },
      },
    });
  });

  it("denied RBAC writes nothing", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );
    await expect(
      setLockOperationalHold(actor, {
        smartDeviceId: LOCK,
        kind: "OUT_OF_SERVICE",
        note: "x x x",
      }),
    ).rejects.toThrow();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("the newest hold row wins; a later 'cleared' row means no hold", async () => {
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce({
      afterState: { hold: HOLD },
    } as never);
    expect(await readActiveOperationalHold(LOCK)).toEqual(HOLD);
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce({
      afterState: { hold: null, clearedAt: "2026-09-27T00:00:00.000Z" },
    } as never);
    expect(await readActiveOperationalHold(LOCK)).toBeNull();
  });

  it("clearing adds a new row (history kept) and refuses when there is nothing to clear", async () => {
    expect(
      await clearLockOperationalHold(actor, {
        smartDeviceId: LOCK,
        note: "Replaced.",
      }),
    ).toEqual({
      status: "rejected",
      reason: "This lock has no active hold.",
    });
    vi.mocked(prisma.auditLog.findFirst).mockResolvedValueOnce({
      afterState: { hold: HOLD },
    } as never);
    expect(
      await clearLockOperationalHold(actor, {
        smartDeviceId: LOCK,
        note: "Replaced and checked on site.",
      }),
    ).toEqual({ status: "success" });
    expect(mockRecordAudit.mock.calls.at(-1)![0]).toMatchObject({
      beforeState: { hold: HOLD },
      afterState: { hold: null, note: "Replaced and checked on site." },
    });
  });

  it("dashboard read returns only locks whose NEWEST row is an active hold", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { entityId: "a", afterState: { hold: HOLD } },
      { entityId: "b", afterState: { hold: null } },
      { entityId: "b", afterState: { hold: HOLD } },
    ] as never);
    const holds = await getActiveOperationalHolds(actor, ["a", "b"]);
    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
    expect([...holds.keys()]).toEqual(["a"]);
  });

  it("refuses a non-lock device", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
      id: LOCK,
      deviceType: "THERMOSTAT",
      propertyId: "p",
    } as never);
    expect(
      await setLockOperationalHold(actor, {
        smartDeviceId: LOCK,
        kind: "OUT_OF_SERVICE",
        note: "x x x",
      }),
    ).toEqual({ status: "rejected", reason: "Lock not found." });
  });
});
