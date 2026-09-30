import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFindUnique, mockUpdate, mockAssertPermission, mockRecordAudit } =
  vi.hoisted(() => ({
    mockFindUnique: vi.fn(),
    mockUpdate: vi.fn().mockResolvedValue({}),
    mockAssertPermission: vi.fn().mockResolvedValue(undefined),
    mockRecordAudit: vi.fn().mockResolvedValue({}),
  }));

const tx = {
  integrationConnection: { findUnique: mockFindUnique, update: mockUpdate },
};
vi.mock("@stayw/database", () => ({
  prisma: {
    integrationConnection: { findUnique: mockFindUnique },
    $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
  },
}));
vi.mock("@stayw/auth", () => ({ assertPermission: mockAssertPermission }));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

const {
  readCieloControlSetting,
  setCieloControlEnabled,
  getCieloControlSetting,
} = await import("./cielo-control-settings.service");

beforeEach(() => vi.clearAllMocks());

describe("Cielo control switch — default OFF", () => {
  it.each([
    ["no CIELO row", null],
    ["no setting stored", { metadata: {} }],
    [
      "enabled: 'true' (string)",
      { metadata: { cieloControl: { enabled: "true" } } },
    ],
    [
      "the Nest switch on (separate)",
      { metadata: { thermostatControl: { enabled: true } } },
    ],
  ])("%s → OFF", async (_l, row) => {
    mockFindUnique.mockResolvedValue(row);
    expect((await readCieloControlSetting()).enabled).toBe(false);
  });

  it("ON only for an explicit boolean true on the CIELO row", async () => {
    mockFindUnique.mockResolvedValue({
      metadata: { cieloControl: { enabled: true } },
    });
    expect((await readCieloControlSetting()).enabled).toBe(true);
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { provider: "CIELO" },
      select: { metadata: true },
    });
  });

  it("viewing requires smart_devices:read", async () => {
    mockFindUnique.mockResolvedValue(null);
    await getCieloControlSetting({ userId: "u" });
    expect(mockAssertPermission).toHaveBeenCalledWith(
      { userId: "u" },
      "smart_devices:read",
    );
  });
});

describe("setCieloControlEnabled", () => {
  it("requires GLOBAL thermostats:manage, keeps other metadata, and audits", async () => {
    mockFindUnique.mockResolvedValue({
      id: "conn-cielo",
      metadata: { other: 1 },
    });
    const result = await setCieloControlEnabled({ userId: "admin-1" }, true);
    expect(mockAssertPermission).toHaveBeenCalledWith(
      { userId: "admin-1" },
      "thermostats:manage",
    );
    expect(result).toEqual({ status: "success", enabled: true });
    const data = mockUpdate.mock.calls[0]![0].data.metadata;
    expect(data.other).toBe(1);
    expect(data.cieloControl).toMatchObject({
      enabled: true,
      updatedByUserId: "admin-1",
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "cielo.thermostat_control.set_enabled",
        beforeState: { enabled: false },
        afterState: { enabled: true },
      }),
      tx,
    );
  });

  it("an RBAC failure throws before any write", async () => {
    mockAssertPermission.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      setCieloControlEnabled({ userId: "x" }, true),
    ).rejects.toThrow();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("no CIELO connection → rejected, nothing written", async () => {
    mockFindUnique.mockResolvedValue(null);
    expect(await setCieloControlEnabled({ userId: "a" }, true)).toMatchObject({
      status: "rejected",
    });
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
