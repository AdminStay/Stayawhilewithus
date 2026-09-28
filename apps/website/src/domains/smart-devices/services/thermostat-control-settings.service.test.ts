import { assertPermission } from "@stayw/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockRecordAudit } = vi.hoisted(() => ({
  mockFindUnique: vi.fn(),
  mockUpdate: vi.fn().mockResolvedValue({}),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stayw/database", () => {
  const client = {
    integrationConnection: { findUnique: mockFindUnique, update: mockUpdate },
  };
  return {
    prisma: {
      ...client,
      $transaction: (fn: (tx: typeof client) => unknown) => fn(client),
    },
  };
});

vi.mock("@stayw/auth", () => ({ assertPermission: vi.fn() }));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import {
  getThermostatControlSetting,
  readThermostatControlSetting,
  setThermostatControlEnabled,
} from "./thermostat-control-settings.service";

const actor = { userId: "admin-1" };

describe("Nest thermostat-control kill switch (2026-09-27, Nest Phase 1)", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockUpdate.mockClear();
    mockRecordAudit.mockClear();
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
  });

  it("defaults to OFF when the setting has never been stored (existing admins get no live controls on release)", async () => {
    mockFindUnique.mockResolvedValue({ metadata: {} });
    expect(await readThermostatControlSetting()).toEqual({
      enabled: false,
      updatedAt: null,
      updatedByUserId: null,
    });
  });

  it("is OFF when there is no Nest connection at all", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect((await readThermostatControlSetting()).enabled).toBe(false);
  });

  it("only an explicit stored `true` turns it ON; anything else stays OFF", async () => {
    for (const value of [undefined, null, "true", 1, "yes", {}]) {
      mockFindUnique.mockResolvedValue({
        metadata: { thermostatControl: { enabled: value } },
      });
      expect((await readThermostatControlSetting()).enabled).toBe(false);
    }
    mockFindUnique.mockResolvedValue({
      metadata: {
        thermostatControl: {
          enabled: true,
          updatedAt: "2026-09-27T20:00:00.000Z",
          updatedByUserId: "admin-1",
        },
      },
    });
    expect(await readThermostatControlSetting()).toEqual({
      enabled: true,
      updatedAt: "2026-09-27T20:00:00.000Z",
      updatedByUserId: "admin-1",
    });
  });

  it("is independent of the August lock kill switch stored on a different connection", async () => {
    mockFindUnique.mockResolvedValue({
      metadata: { lockControl: { enabled: true } },
    });
    expect((await readThermostatControlSetting()).enabled).toBe(false);
    expect(mockFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { provider: "NEST" } }),
    );
  });

  it("the dashboard read requires smart_devices:read", async () => {
    mockFindUnique.mockResolvedValue({ metadata: {} });
    await getThermostatControlSetting(actor as never);
    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
  });

  it("toggling requires a GLOBAL thermostats:manage grant (no propertyId) and a denial writes nothing", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      setThermostatControlEnabled(actor as never, true),
    ).rejects.toThrow("Forbidden");
    expect(assertPermission).toHaveBeenCalledWith(actor, "thermostats:manage");
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("an admin toggle merges into existing metadata (keeps other keys) and is audit-logged with before/after", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-nest",
      metadata: { other: "keep" },
    });

    const result = await setThermostatControlEnabled(actor as never, true);

    expect(result).toEqual({ status: "success", enabled: true });
    const data = mockUpdate.mock.calls[0]![0].data.metadata;
    expect(data.other).toBe("keep");
    expect(data.thermostatControl).toMatchObject({
      enabled: true,
      updatedByUserId: "admin-1",
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "nest.thermostat_control.set_enabled",
        beforeState: { enabled: false },
        afterState: { enabled: true },
      }),
      expect.anything(),
    );
  });

  it("refuses to toggle when Nest isn't connected", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await setThermostatControlEnabled(actor as never, true)).toEqual({
      status: "rejected",
      reason: expect.stringContaining("Nest isn't connected"),
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
