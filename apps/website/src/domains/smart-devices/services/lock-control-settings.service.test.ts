import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRecordAudit, mockFindUnique, mockUpdate } = vi.hoisted(() => ({
  mockRecordAudit: vi.fn().mockResolvedValue({}),
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stayw/database", () => {
  const client = {
    integrationConnection: { findUnique: mockFindUnique, update: mockUpdate },
  };
  return {
    prisma: {
      ...client,
      $transaction: vi.fn(async (fn: (tx: typeof client) => unknown) =>
        fn(client),
      ),
    },
  };
});

vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";

import {
  getLockControlSetting,
  readLockControlSetting,
  setLockControlEnabled,
} from "./lock-control-settings.service";

const actor = { userId: "admin-1" };

beforeEach(() => {
  vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  mockFindUnique.mockReset();
  mockUpdate.mockClear();
  mockRecordAudit.mockClear();
});

describe("readLockControlSetting", () => {
  it("defaults to ON when the August connection has never been toggled", async () => {
    mockFindUnique.mockResolvedValueOnce({ metadata: {} });
    expect((await readLockControlSetting()).enabled).toBe(true);
  });

  it("is OFF only when explicitly stored as false", async () => {
    mockFindUnique.mockResolvedValueOnce({
      metadata: {
        lockControl: {
          enabled: false,
          updatedAt: "2026-09-25T00:00:00.000Z",
          updatedByUserId: "admin-1",
        },
      },
    });
    expect(await readLockControlSetting()).toEqual({
      enabled: false,
      updatedAt: "2026-09-25T00:00:00.000Z",
      updatedByUserId: "admin-1",
    });
  });

  it("is OFF when there is no August connection at all", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    expect((await readLockControlSetting()).enabled).toBe(false);
  });
});

describe("getLockControlSetting", () => {
  it("requires smart_devices:read", async () => {
    mockFindUnique.mockResolvedValueOnce({ metadata: {} });
    await getLockControlSetting(actor);
    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
  });
});

describe("setLockControlEnabled", () => {
  it("requires a GLOBAL locks:manage grant and writes nothing when denied", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );
    await expect(setLockControlEnabled(actor, false)).rejects.toThrow();
    expect(assertPermission).toHaveBeenCalledWith(actor, "locks:manage");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("merges into existing metadata (never drops other keys) and audit-logs before/after", async () => {
    mockFindUnique.mockResolvedValueOnce({
      id: "conn-1",
      metadata: { other: 1 },
    });

    const result = await setLockControlEnabled(actor, false);

    expect(result).toEqual({ status: "success", enabled: false });
    const written = mockUpdate.mock.calls[0]![0].data.metadata;
    expect(written.other).toBe(1);
    expect(written.lockControl).toMatchObject({
      enabled: false,
      updatedByUserId: "admin-1",
    });
    const audit = mockRecordAudit.mock.calls[0]![0];
    expect(audit).toMatchObject({
      action: "august.lock_control.set_enabled",
      entityType: "IntegrationConnection",
      entityId: "conn-1",
      beforeState: { enabled: true },
      afterState: { enabled: false },
    });
  });

  it("rejects cleanly when August isn't connected", async () => {
    mockFindUnique.mockResolvedValueOnce(null);
    const result = await setLockControlEnabled(actor, true);
    expect(result.status).toBe("rejected");
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
