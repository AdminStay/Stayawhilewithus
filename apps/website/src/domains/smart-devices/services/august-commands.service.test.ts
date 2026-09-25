import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransaction,
  mockLock,
  mockUnlock,
  mockUnlatch,
  mockGetLockDetail,
  mockGetLockCapabilities,
  mockRecordAudit,
  mockReadLockControlSetting,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockLock: vi.fn(),
  mockUnlock: vi.fn(),
  mockUnlatch: vi.fn(),
  mockGetLockDetail: vi.fn(),
  mockGetLockCapabilities: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
  mockReadLockControlSetting: vi.fn(),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    providerDevice: {
      update: vi.fn().mockResolvedValue({}),
    },
    auditLog: {
      findMany: vi.fn(),
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/integrations/august", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/august")>();
  return {
    ...actual,
    AugustClient: vi.fn().mockImplementation(() => ({
      getLockDetail: mockGetLockDetail,
      getLockCapabilities: mockGetLockCapabilities,
      lock: mockLock,
      unlock: mockUnlock,
      unlatch: mockUnlatch,
    })),
  };
});

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

vi.mock("./lock-control-settings.service", () => ({
  readLockControlSetting: mockReadLockControlSetting,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";

import {
  computeFirstTestEligibility,
  computeLockControlEligibility,
  getLatestAugustLockCommandOutcomes,
  isAdminResetAvailable,
  resetAugustLockAfterPhysicalCheck,
  sendAugustLockCommand,
} from "./august-commands.service";

const actor = { userId: "user-1" };
const SMART_DEVICE_ID = "11111111-1111-1111-1111-111111111111";
const PROPERTY_ID = "22222222-2222-2222-2222-222222222222";
const EXTERNAL_ID = "august-lock-1";
const SERIAL_NUMBER = "M0123456";

// Default lockState is deliberately "unlocked" (2026-09-25, the
// already-in-requested-state correction) — most tests below request LOCK,
// so this default represents a genuine, meaningful pre-command state
// (opposite of the target) rather than accidentally colliding with the
// new already-in-requested-state gate. Tests that specifically exercise
// that gate, or that request UNLOCK/UNLATCH, override this explicitly.
function freshDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: EXTERNAL_ID,
    name: "Front Door",
    houseId: "house-1",
    batteryLevel: 80,
    connectivity: "ONLINE",
    lockState: "unlocked",
    telemetryUpdatedAt: "2026-09-18T00:00:00.000Z",
    seenAt: "2026-09-18T00:00:00.000Z",
    serialNumber: SERIAL_NUMBER,
    ...overrides,
  };
}

const FULLY_CAPABLE = { lock: true, unlock: true, unlatch: true };
const NO_UNLATCH = { lock: true, unlock: true, unlatch: false };
const NOT_A_LOCK_MODEL = { lock: false, unlock: false, unlatch: false };

function mappedEnabledDevice(overrides: Record<string, unknown> = {}) {
  return {
    id: SMART_DEVICE_ID,
    provider: "AUGUST",
    propertyId: PROPERTY_ID,
    metadata: { lockState: "unlocked" },
    commandInProgressAt: null,
    property: { id: PROPERTY_ID, deletedAt: null },
    providerDevice: {
      enabled: true,
      propertyId: PROPERTY_ID,
      externalDeviceId: EXTERNAL_ID,
      rawMetadata: {},
    },
    ...overrides,
  };
}

function allowTransaction(commandInProgressAt: Date | null = null) {
  mockTransaction.mockImplementationOnce(async (fn) =>
    fn({
      $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
      $executeRaw: vi.fn().mockResolvedValue(0),
      smartDevice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ commandInProgressAt }),
        update: vi.fn().mockResolvedValue({}),
        count: vi.fn().mockResolvedValue(0),
      },
    }),
  );
}

describe("sendAugustLockCommand", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.AUGUST_IDENTIFIER = "test-identifier";
    process.env.AUGUST_INSTALL_ID = "test-install-id";
    process.env.AUGUST_ACCESS_TOKEN = "test-access-token";
    // Every test below that expects a real command to actually reach
    // August explicitly allowlists EXTERNAL_ID — tests that don't set this
    // (the default, empty allowlist) are exactly how the fail-closed-by-
    // default gate itself gets proven.
    delete process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS;
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockReset();
    // Default: no prior recorded outcome for this device (a genuinely
    // first-verification scenario) — tests that need a different history
    // (e.g. "already SUCCEEDED, so this is routine control") override this
    // explicitly.
    vi.mocked(prisma.auditLog.findMany).mockReset().mockResolvedValue([]);
    mockTransaction.mockReset();
    mockGetLockDetail.mockReset();
    mockGetLockCapabilities.mockReset();
    mockLock.mockReset().mockResolvedValue(undefined);
    mockUnlock.mockReset().mockResolvedValue(undefined);
    mockUnlatch.mockReset().mockResolvedValue(undefined);
    mockRecordAudit.mockClear();
    mockReadLockControlSetting.mockReset().mockResolvedValue({
      enabled: true,
      updatedAt: null,
      updatedByUserId: null,
    });
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects a device that is unmapped, before RBAC and before any August call", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice({
        providerDevice: {
          enabled: false,
          propertyId: null,
          externalDeviceId: EXTERNAL_ID,
          rawMetadata: {},
        },
      }) as never,
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("rejected");
    expect(assertPermission).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("rejects a disabled device even if it has a propertyId", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice({
        providerDevice: {
          enabled: false,
          propertyId: PROPERTY_ID,
          externalDeviceId: EXTERNAL_ID,
          rawMetadata: {},
        },
      }) as never,
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("rejected");
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("rejects when the device's property has been soft-deleted", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice({
        property: { id: PROPERTY_ID, deletedAt: new Date() },
      }) as never,
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({
      status: "rejected",
      reason: "This device's property no longer exists.",
    });
    expect(assertPermission).not.toHaveBeenCalled();
  });

  it("rejects when the SmartDevice does not exist", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(null);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({ status: "rejected", reason: "Device not found." });
  });

  it("rejects a device belonging to a different provider (wrong device/relationship)", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice({ provider: "NEST" }) as never,
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({ status: "rejected", reason: "Device not found." });
  });

  it("rejects when the actor lacks locks:manage, scoped to the device's property", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      }),
    ).rejects.toThrow("ForbiddenError");

    expect(assertPermission).toHaveBeenCalledWith(actor, "locks:manage", {
      propertyId: PROPERTY_ID,
    });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("rejects when the fresh capability read reports no serialNumber — capability cannot be verified", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(
      freshDetail({ serialNumber: null }),
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("rejected");
    expect(mockGetLockCapabilities).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("rejects UNLATCH when the fresh capability check says this lock model doesn't support it", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(NO_UNLATCH);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "UNLATCH",
    });

    expect(result.status).toBe("rejected");
    expect(mockUnlatch).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({ result: "REJECTED" }),
      }),
    );
  });

  it("rejects LOCK/UNLOCK when the fresh capability check reports this serial number isn't a remotely-operable lock model at all", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(NOT_A_LOCK_MODEL);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "UNLOCK",
    });

    expect(result.status).toBe("rejected");
    expect(mockUnlock).not.toHaveBeenCalled();
  });

  describe("dynamic eligibility gates (2026-09-25, replaces the env allowlist)", () => {
    function history(...results: string[]) {
      return results.map((result) => ({ afterState: { result } }));
    }

    it("kill switch OFF: rejects before any August call, audited as REJECTED", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      mockReadLockControlSetting.mockResolvedValueOnce({
        enabled: false,
        updatedAt: null,
        updatedByUserId: null,
      });

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({
        status: "rejected",
        reason:
          "Remote lock control is turned off by an admin. No commands can be sent to any lock.",
      });
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockGetLockDetail).not.toHaveBeenCalled();
      expect(mockLock).not.toHaveBeenCalled();
      expect(mockRecordAudit.mock.calls[0]![0].metadata.errorDetail).toContain(
        "kill switch",
      );
    });

    it("kill switch turned OFF mid-request: re-read right before sending stops the command", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockReadLockControlSetting
        .mockResolvedValueOnce({
          enabled: true,
          updatedAt: null,
          updatedByUserId: null,
        })
        .mockResolvedValueOnce({
          enabled: false,
          updatedAt: null,
          updatedByUserId: null,
        });
      mockGetLockDetail.mockResolvedValueOnce(freshDetail());
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("rejected");
      expect(mockLock).not.toHaveBeenCalled();
    });

    it.each(["FAILED", "AMBIGUOUS"])(
      "last real outcome %s: rejected server-side before any August call (blocked until admin reset)",
      async (blocking) => {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(
          history(blocking) as never,
        );

        const result = await sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "UNLOCK",
        });

        expect(result.status).toBe("rejected");
        expect(result).toMatchObject({
          reason: expect.stringContaining("admin"),
        });
        expect(mockTransaction).not.toHaveBeenCalled();
        expect(mockGetLockDetail).not.toHaveBeenCalled();
        expect(mockUnlock).not.toHaveBeenCalled();
      },
    );

    it("a newer REJECTED row never masks an older FAILED block", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(
        history("REJECTED", "NO_ACTION_ALREADY_IN_STATE", "FAILED") as never,
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("rejected");
      expect(mockLock).not.toHaveBeenCalled();
    });

    it("after an ADMIN_RESET the lock is no longer blocked (treated as not-yet-verified)", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(
        history("ADMIN_RESET", "FAILED") as never,
      );
      mockGetLockDetail
        .mockResolvedValueOnce(freshDetail({ lockState: "unlocked" }))
        .mockResolvedValue(freshDetail({ lockState: "locked" }));
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(mockLock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "success", lockState: "locked" });
    });

    it.each(["UNKNOWN", "OFFLINE"])(
      "fresh August connectivity %s: rejected before the capability check, no command sent",
      async (connectivity) => {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        allowTransaction();
        mockGetLockDetail.mockResolvedValueOnce(freshDetail({ connectivity }));

        const result = await sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "LOCK",
        });

        expect(result).toMatchObject({
          status: "rejected",
          reason: expect.stringContaining(
            "isn't reporting this lock as online",
          ),
        });
        expect(mockGetLockCapabilities).not.toHaveBeenCalled();
        expect(mockLock).not.toHaveBeenCalled();
      },
    );

    it("account-wide cap: with 3 other commands in flight, nothing is sent and the lock is not marked in progress", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      const txUpdate = vi.fn();
      mockTransaction.mockImplementationOnce(async (fn) =>
        fn({
          $queryRaw: vi.fn().mockResolvedValue([{ locked: true }]),
          $executeRaw: vi.fn().mockResolvedValue(0),
          smartDevice: {
            findUniqueOrThrow: vi
              .fn()
              .mockResolvedValue({ commandInProgressAt: null }),
            update: txUpdate,
            count: vi.fn().mockResolvedValue(3),
          },
        }),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({
        status: "rejected",
        reason:
          "Other lock commands are in progress right now, so nothing was sent. Try again in a few seconds.",
      });
      expect(txUpdate).not.toHaveBeenCalled();
      expect(mockGetLockDetail).not.toHaveBeenCalled();
    });

    it("no env allowlist is consulted: an ONLINE, mapped, enabled lock proceeds with the variable unset", async () => {
      delete process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS;
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockDetail
        .mockResolvedValueOnce(freshDetail())
        .mockResolvedValue(freshDetail({ lockState: "locked" }));
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(mockLock).toHaveBeenCalledTimes(1);
      expect(result.status).toBe("success");
    });
  });

  it("authorized LOCK command succeeds when explicitly allowlisted, capable, and authorized", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail
      .mockResolvedValueOnce(freshDetail()) // pre-command capability refresh
      .mockResolvedValueOnce(freshDetail({ lockState: "locked" })); // post-command confirmation
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({ status: "success", lockState: "locked" });
    expect(mockLock).toHaveBeenCalledWith(EXTERNAL_ID);
    expect(mockGetLockDetail).toHaveBeenCalledTimes(2);
  });

  it("authorized UNLOCK command succeeds when explicitly allowlisted, capable, and authorized", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail
      .mockResolvedValueOnce(freshDetail({ lockState: "locked" })) // pre-command: genuine pending transition for UNLOCK
      .mockResolvedValueOnce(freshDetail({ lockState: "unlocked" }));
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "UNLOCK",
    });

    expect(result).toEqual({ status: "success", lockState: "unlocked" });
    expect(mockUnlock).toHaveBeenCalledWith(EXTERNAL_ID);
  });

  it("duplicate-command prevention (concurrent): a second command is rejected while the advisory lock is held by the first", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    mockTransaction.mockImplementationOnce(async (fn) =>
      fn({
        $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]),
        $executeRaw: vi.fn().mockResolvedValue(0),
        smartDevice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
      }),
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({ status: "already_running" });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("the account-wide slots lock is taken with $executeRaw (void result), never $queryRaw (2026-09-25 incident)", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    const txQueryRaw = vi.fn().mockResolvedValue([{ locked: false }]);
    const txExecuteRaw = vi.fn().mockResolvedValue(0);
    mockTransaction.mockImplementationOnce(async (fn) =>
      fn({
        $queryRaw: txQueryRaw,
        $executeRaw: txExecuteRaw,
        smartDevice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
      }),
    );

    await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(txExecuteRaw).toHaveBeenCalledTimes(1);
    expect(String(txExecuteRaw.mock.calls[0]![0])).toContain(
      "pg_advisory_xact_lock(hashtext('august_command_slots'))",
    );
    for (const call of txQueryRaw.mock.calls) {
      expect(String(call[0])).not.toContain("pg_advisory_xact_lock(");
    }
  });

  it("duplicate-command prevention: a fresh (non-stale) in-progress marker read INSIDE the lock blocks the command", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction(new Date());

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({ status: "already_running" });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
  });

  it("stale command marker recovery: an old in-progress marker (past the threshold) does not block a new command", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    const staleMarker = new Date(Date.now() - 10 * 60 * 1000);
    allowTransaction(staleMarker);
    mockGetLockDetail
      .mockResolvedValueOnce(freshDetail()) // pre-command: "unlocked" (a genuine pending transition for LOCK)
      .mockResolvedValue(freshDetail({ lockState: "locked" })); // confirmation poll matches immediately, no real delay
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("success");
    expect(mockLock).toHaveBeenCalled();
  });

  it("marker is cleared even when the provider call throws (finally runs on the error path)", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
    mockLock.mockRejectedValueOnce(new Error("network error"));

    await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(prisma.smartDevice.update).toHaveBeenCalledWith({
      where: { id: SMART_DEVICE_ID },
      data: { commandInProgressAt: null },
    });
  });

  it("REAL EVIDENCE — a definitive HTTP 408 response (a genuine HttpRequestError, August's server actually answered) IS classified FAILED, translated to a safe message never returned raw", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
    mockLock.mockRejectedValueOnce(
      new HttpRequestError("/remoteoperate/august-lock-1/lock", 408),
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") {
      expect(result.reason).not.toMatch(/408/);
      expect(result.reason).toMatch(/did not respond in time/);
    }
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "smart_device.august_lock_command",
        afterState: expect.objectContaining({ result: "FAILED" }),
        metadata: expect.objectContaining({
          errorDetail: expect.stringContaining("408"),
        }),
      }),
    );
  });

  it("REAL EVIDENCE — a definitive HTTP 422 response (bridge offline, August's server actually answered) IS classified FAILED, translated to a safe specific message", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(
      freshDetail({ lockState: "locked" }), // pre-command: genuine pending transition for UNLOCK
    );
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
    mockUnlock.mockRejectedValueOnce(
      new HttpRequestError("/remoteoperate/august-lock-1/unlock", 422),
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "UNLOCK",
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") {
      expect(result.reason).toMatch(/bridge is currently offline/);
    }
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({ result: "FAILED" }),
      }),
    );
  });

  describe("AMBIGUOUS outcome (2026-09-25, the Orion incident's root cause correction)", () => {
    it("REAL EVIDENCE — Orion case: a plain Error with NO HttpRequestError instance (no definitive HTTP response ever received — e.g. HttpClient's own AbortController firing on its configured timeout, exactly like the real 'This operation was aborted' Orion hit) is classified AMBIGUOUS, never FAILED", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockDetail.mockResolvedValueOnce(freshDetail());
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
      mockLock.mockRejectedValueOnce(new Error("This operation was aborted"));

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("ambiguous");
      if (result.status === "ambiguous") {
        expect(result.reason).toMatch(/uncertain/i);
        expect(result.reason).toMatch(/do not retry/i);
        expect(result.reason).not.toMatch(/aborted/i); // never the raw error text
      }
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          action: "smart_device.august_lock_command",
          afterState: expect.objectContaining({ result: "AMBIGUOUS" }),
          metadata: expect.objectContaining({
            errorDetail: "This operation was aborted",
          }),
        }),
      );
    });

    it("a plain Error whose message happens to contain a status-shaped substring (e.g. '408') is STILL classified AMBIGUOUS, not FAILED — no real HttpRequestError means no real evidence, regardless of what the message text says", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockDetail.mockResolvedValueOnce(
        freshDetail({ lockState: "locked" }), // pre-command: genuine pending transition for UNLOCK
      );
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
      mockUnlock.mockRejectedValueOnce(
        new Error(
          "Request to /remoteoperate/august-lock-1/unlock failed with 422",
        ),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "UNLOCK",
      });

      expect(result.status).toBe("ambiguous");
    });

    it("a plain Error mentioning '403' (no real HttpRequestError) is classified AMBIGUOUS, not FAILED — distinct from the real HttpRequestError(403) case tested elsewhere", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockDetail.mockResolvedValueOnce(freshDetail());
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
      mockLock.mockRejectedValueOnce(
        new Error(
          "Request to /remoteoperate/august-lock-1/lock failed with 403",
        ),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("ambiguous");
    });

    it("a failure during the PRE-command capability check (before the physical command is ever attempted) remains FAILED, never AMBIGUOUS — commandAttempted is still false at that point", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockDetail.mockRejectedValueOnce(
        new Error("This operation was aborted"),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("failure");
      expect(mockLock).not.toHaveBeenCalled();
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          afterState: expect.objectContaining({ result: "FAILED" }),
        }),
      );
    });

    it("a failure during EVERY POST-command confirmation poll attempt (the command call itself succeeded) is classified AMBIGUOUS when no definitive response ever comes back — we sent it, but can't confirm the result", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        allowTransaction();
        mockGetLockDetail
          .mockResolvedValueOnce(freshDetail()) // pre-command capability refresh succeeds
          .mockRejectedValue(new Error("This operation was aborted")); // every confirmation poll attempt aborts
        mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

        const resultPromise = sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "LOCK",
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(mockLock).toHaveBeenCalledWith(EXTERNAL_ID);
        expect(mockLock).toHaveBeenCalledTimes(1); // still single-attempt for the write itself
        // 1 pre-command read + CONFIRMATION_POLL_ATTEMPTS (4) poll attempts, all rejecting.
        expect(mockGetLockDetail).toHaveBeenCalledTimes(5);
        expect(result.status).toBe("ambiguous");
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            afterState: expect.objectContaining({ result: "AMBIGUOUS" }),
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });

    it("polling recovers on a later attempt: the first confirmation poll is invalid/fails, a later one reports a real state — result is SUCCEEDED, not AMBIGUOUS", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        allowTransaction();
        mockGetLockDetail
          .mockResolvedValueOnce(freshDetail()) // pre-command capability refresh succeeds
          .mockRejectedValueOnce(new Error("This operation was aborted")) // poll attempt 1: no answer
          .mockResolvedValueOnce(freshDetail({ lockState: "locked" })); // poll attempt 2: confirmed
        mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

        const resultPromise = sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "LOCK",
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(mockLock).toHaveBeenCalledTimes(1);
        expect(mockGetLockDetail).toHaveBeenCalledTimes(3); // pre-command + poll 1 (fails) + poll 2 (confirms)
        expect(result).toEqual({ status: "success", lockState: "locked" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("polling stops at the first valid reading — does not keep polling past confirmation", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        allowTransaction();
        mockGetLockDetail
          .mockResolvedValueOnce(freshDetail({ lockState: "locked" })) // pre-command: genuine pending transition for UNLOCK
          .mockResolvedValueOnce(freshDetail({ lockState: "unlocked" })); // poll attempt 1: confirmed immediately
        mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

        const resultPromise = sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "UNLOCK",
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(mockGetLockDetail).toHaveBeenCalledTimes(2); // pre-command + exactly one poll, no more
        expect(result).toEqual({ status: "success", lockState: "unlocked" });
      } finally {
        vi.useRealTimers();
      }
    });

    it("AMBIGUOUS from exhausted polling never sets confirmedLockState — no physical state is ever guessed", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        allowTransaction();
        mockGetLockDetail
          .mockResolvedValueOnce(freshDetail())
          .mockResolvedValue(freshDetail({ lockState: null })); // never a valid reading, any number of times
        mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

        const resultPromise = sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "LOCK",
        });
        await vi.runAllTimersAsync();
        await resultPromise;

        const auditCall = mockRecordAudit.mock.calls[0]![0];
        expect(auditCall.afterState.result).toBe("AMBIGUOUS");
        expect(auditCall.afterState).not.toHaveProperty("confirmedLockState");
      } finally {
        vi.useRealTimers();
      }
    });

    it("OPERATION-MATCH CORRECTION (2026-09-25): an early poll reporting the OLD state (still 'locked' shortly after an UNLOCK was sent) does NOT count as confirmation — polling continues until a matching state arrives", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        allowTransaction();
        mockGetLockDetail
          .mockResolvedValueOnce(freshDetail({ lockState: "locked" })) // pre-command: genuine pending transition for UNLOCK
          .mockResolvedValueOnce(freshDetail({ lockState: "locked" })) // poll 1: STALE — bridge hasn't relayed the UNLOCK yet
          .mockResolvedValueOnce(freshDetail({ lockState: "locked" })) // poll 2: still stale
          .mockResolvedValueOnce(freshDetail({ lockState: "unlocked" })); // poll 3: finally matches
        mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

        const resultPromise = sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "UNLOCK",
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        // Never resolved/succeeded on either of the two stale "locked"
        // readings — only the genuinely matching "unlocked" one counted.
        expect(result).toEqual({ status: "success", lockState: "unlocked" });
        expect(mockGetLockDetail).toHaveBeenCalledTimes(4); // pre-command + 3 polls (2 stale, 1 matching)
      } finally {
        vi.useRealTimers();
      }
    });

    it("OPERATION-MATCH CORRECTION (2026-09-25): a mismatch through the ENTIRE polling window (every reading is the old state, the correct one never arrives) is classified AMBIGUOUS, never SUCCEEDED — a lock that never physically moved must never be marked verified", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
          mappedEnabledDevice() as never,
        );
        allowTransaction();
        mockGetLockDetail
          .mockResolvedValueOnce(freshDetail({ lockState: "locked" })) // pre-command: genuine pending transition for UNLOCK
          .mockResolvedValue(freshDetail({ lockState: "locked" })); // EVERY poll still reports "locked" — an UNLOCK was requested, never confirmed
        mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

        const resultPromise = sendAugustLockCommand(actor, {
          smartDeviceId: SMART_DEVICE_ID,
          operation: "UNLOCK",
        });
        await vi.runAllTimersAsync();
        const result = await resultPromise;

        expect(result.status).toBe("ambiguous");
        expect(result.status).not.toBe("success");
        expect(mockGetLockDetail).toHaveBeenCalledTimes(5); // pre-command + all 4 poll attempts, all mismatched
        expect(mockRecordAudit).toHaveBeenCalledWith(
          expect.objectContaining({
            afterState: expect.objectContaining({ result: "AMBIGUOUS" }),
          }),
        );
        // Never recorded as if the lock had actually unlocked.
        const auditCall = mockRecordAudit.mock.calls[0]![0];
        expect(auditCall.afterState).not.toHaveProperty("confirmedLockState");
      } finally {
        vi.useRealTimers();
      }
    });

    it("AMBIGUOUS never sets confirmedLockState — no physical state is ever guessed", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockDetail.mockResolvedValueOnce(freshDetail());
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
      mockLock.mockRejectedValueOnce(new Error("This operation was aborted"));

      await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      const auditCall = mockRecordAudit.mock.calls[0]![0];
      expect(auditCall.afterState).not.toHaveProperty("confirmedLockState");
    });

    it("AMBIGUOUS is never automatically retried — a second call after an AMBIGUOUS outcome is a wholly separate, independent invocation with its own full safety-check chain (no special-cased bypass exists)", async () => {
      vi.mocked(prisma.smartDevice.findUnique)
        .mockResolvedValueOnce(mappedEnabledDevice() as never)
        .mockResolvedValueOnce(mappedEnabledDevice() as never);
      allowTransaction();
      mockGetLockDetail.mockResolvedValueOnce(freshDetail());
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
      mockLock.mockRejectedValueOnce(new Error("This operation was aborted"));

      const first = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });
      expect(first.status).toBe("ambiguous");
      expect(mockLock).toHaveBeenCalledTimes(1);

      // Nothing in sendAugustLockCommand() itself calls client.lock() again —
      // a second attempt only ever happens via a wholly separate, explicit
      // operator-initiated call (proven here by simply not making one: the
      // mock is only ever invoked the one time above).
    });
  });

  it("provider error handling (account auth): a 401 is always translated to the re-authorize message", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
    mockLock.mockRejectedValueOnce(
      new HttpRequestError("/remoteoperate/august-lock-1/lock", 401),
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") {
      expect(result.reason).toMatch(/re-authorized/);
    }
  });

  it("provider error handling (403, no account-auth signal): reports a device-specific refusal, NOT the account-wide re-authorize message — this is the 2026-09-18 MJ - Front Door incident this fix targets", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
    mockLock.mockRejectedValueOnce(
      new HttpRequestError("/remoteoperate/august-lock-1/lock", 403, {
        providerErrorCode: "device_not_authorized",
        providerMessage: "no bridge registered for this lock",
      }),
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") {
      // The account-wide branch's own instruction ("...may need to be
      // re-authorized.") must not appear — this message may still
      // reference re-authorization in passing (to say it's NOT what's
      // needed), so match on the actual instructive phrase, not the bare
      // word.
      expect(result.reason).not.toMatch(/may need to be re-authorized/);
      expect(result.reason).toMatch(/this specific lock/);
      // This device-specific message must stay strictly neutral about WHY
      // August refused the command — we have never actually confirmed a
      // cause, only that reads keep working while this one write doesn't.
      // Guards against reintroducing an unproven claim (a missing bridge,
      // incomplete setup, insufficient account tier, etc.) into
      // user-facing text.
      expect(result.reason).not.toMatch(/set up|bridge|superuser|activat/i);
    }
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          errorDetail: expect.stringContaining("403"),
        }),
      }),
    );
  });

  it("provider error handling (403, with an account-auth signal in the provider's own message): escalates to the account-wide re-authorize message", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
    mockLock.mockRejectedValueOnce(
      new HttpRequestError("/remoteoperate/august-lock-1/lock", 403, {
        providerMessage: "session token expired, please re-authenticate",
      }),
    );

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") {
      expect(result.reason).toMatch(/re-authorized/);
    }
  });

  // NOTE: the old "403 as a plain Error" scenario here is now covered, with
  // its CORRECTED expectation, by "AMBIGUOUS outcome" > "a plain Error
  // mentioning '403' ... is classified AMBIGUOUS, not FAILED" above — a
  // plain Error (no real HttpRequestError) is no longer treated as a
  // definitive failure just because its message contains a status number
  // (2026-09-25, the Orion incident's root cause correction).

  it("successful command reads confirmed state from August AFTER sending, and stores that — never a guessed value", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail
      .mockResolvedValueOnce(freshDetail({ lockState: "unlocked" })) // pre-command
      .mockResolvedValueOnce(
        freshDetail({
          lockState: "locked",
          batteryLevel: 77,
          telemetryUpdatedAt: "2026-09-18T01:23:45.000Z",
        }),
      ); // post-command confirmation — deliberately different from the pre-read
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({ status: "success", lockState: "locked" });

    const metadataUpdateCall = vi
      .mocked(prisma.smartDevice.update)
      .mock.calls.find((call) => "metadata" in (call[0]?.data ?? {}));
    const updatedMetadata = metadataUpdateCall?.[0].data.metadata as
      { lockState?: string; batteryLevel?: number } | undefined;
    expect(updatedMetadata?.lockState).toBe("locked");
    expect(updatedMetadata?.batteryLevel).toBe(77);
  });

  describe("already-in-requested-state (2026-09-25): verification must prove a real physical transition", () => {
    function historyRows(...results: string[]) {
      return results.map((result) => ({ afterState: { result } }));
    }

    it("UNVERIFIED lock already locked + LOCK test: REJECTED, tells the operator to test Unlock, sends no command", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockDetail.mockResolvedValueOnce(
        freshDetail({ lockState: "locked" }),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({
        status: "rejected",
        reason:
          "This lock is already locked, so a Lock test could not prove the lock physically moves. Test Unlock instead.",
      });
      expect(mockLock).not.toHaveBeenCalled();
      expect(mockUnlock).not.toHaveBeenCalled();
      expect(mockGetLockCapabilities).not.toHaveBeenCalled();
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      expect(mockRecordAudit.mock.calls[0]![0].afterState.result).toBe(
        "REJECTED",
      );
    });

    it("UNVERIFIED lock (only REJECTED history) already unlocked + UNLOCK test: REJECTED, tells the operator to test Lock", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(
        historyRows("REJECTED") as never,
      );
      mockGetLockDetail.mockResolvedValueOnce(
        freshDetail({ lockState: "unlocked" }),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "UNLOCK",
      });

      expect(result.status).toBe("rejected");
      expect(result).toMatchObject({
        reason: expect.stringContaining("Test Lock instead."),
      });
      expect(mockUnlock).not.toHaveBeenCalled();
    });

    it("VERIFIED lock already in the requested state: NO_ACTION_ALREADY_IN_STATE, never SUCCEEDED, no command sent", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(
        historyRows("SUCCEEDED") as never,
      );
      mockGetLockDetail.mockResolvedValueOnce(
        freshDetail({ lockState: "locked" }),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({ status: "no_action", lockState: "locked" });
      expect(mockLock).not.toHaveBeenCalled();
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      const audit = mockRecordAudit.mock.calls[0]![0];
      expect(audit.afterState).toMatchObject({
        operation: "LOCK",
        result: "NO_ACTION_ALREADY_IN_STATE",
        commandSent: false,
      });
      expect(audit.afterState.result).not.toBe("SUCCEEDED");
      expect(audit.metadata.note).toContain("No command was sent");
    });

    it("a newer NO_ACTION row never masks the device's real SUCCEEDED history (still routine control, not a first verification)", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(
        historyRows("NO_ACTION_ALREADY_IN_STATE", "SUCCEEDED") as never,
      );
      mockGetLockDetail.mockResolvedValueOnce(
        freshDetail({ lockState: "locked" }),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("no_action");
    });

    it("a lock with only NO_ACTION history is still UNVERIFIED — a no-op never counts toward verified", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(
        historyRows("NO_ACTION_ALREADY_IN_STATE") as never,
      );
      mockGetLockDetail.mockResolvedValueOnce(
        freshDetail({ lockState: "locked" }),
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("rejected");
      expect(mockLock).not.toHaveBeenCalled();
    });

    it("an unknown/null pre-command state is not treated as already-in-state — the command proceeds normally", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
      mockGetLockDetail
        .mockResolvedValueOnce(freshDetail({ lockState: null }))
        .mockResolvedValue(freshDetail({ lockState: "locked" }));

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(mockLock).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ status: "success", lockState: "locked" });
      // Only the single up-front history lookup — none for already-in-state.
      expect(prisma.auditLog.findMany).toHaveBeenCalledTimes(1);
    });
  });

  describe("time budget (2026-09-25): the command path always finishes inside the /locks maxDuration", () => {
    function advanceBy(ms: number) {
      vi.setSystemTime(Date.now() + ms);
    }

    beforeEach(() => {
      vi.useFakeTimers();
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice() as never,
      );
      allowTransaction();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("a slow pre-command read (past 15s) is REJECTED before any physical command is sent", async () => {
      mockGetLockDetail.mockImplementationOnce(async () => {
        advanceBy(16_000);
        return freshDetail();
      });

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({
        status: "rejected",
        reason:
          "August is responding too slowly right now, so no command was sent. Try again shortly.",
      });
      expect(mockGetLockCapabilities).not.toHaveBeenCalled();
      expect(mockLock).not.toHaveBeenCalled();
      expect(mockRecordAudit.mock.calls[0]![0].afterState.result).toBe(
        "REJECTED",
      );
    });

    it("a slow capabilities read (past 15s total) is REJECTED before any physical command is sent", async () => {
      mockGetLockDetail.mockResolvedValueOnce(freshDetail());
      mockGetLockCapabilities.mockImplementationOnce(async () => {
        advanceBy(16_000);
        return FULLY_CAPABLE;
      });

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result.status).toBe("rejected");
      expect(mockLock).not.toHaveBeenCalled();
    });

    it("confirmation polling stops once another poll could not finish inside the 45s budget, and reports AMBIGUOUS", async () => {
      mockGetLockDetail
        .mockImplementationOnce(async () => {
          advanceBy(14_000); // just under the pre-command deadline
          return freshDetail();
        })
        .mockImplementation(async () => {
          advanceBy(10_000); // every poll read takes its full single-attempt timeout
          return freshDetail({ lockState: "unlocked" }); // never the requested state
        });
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

      const resultPromise = sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });
      await vi.runAllTimersAsync();
      const result = await resultPromise;

      expect(mockLock).toHaveBeenCalledTimes(1);
      // Polls start at 14s (ends 24s) and 27s (ends 37s); a third would need
      // 37 + 3 + 10 = 50s > 45s, so it is never started.
      expect(mockGetLockDetail).toHaveBeenCalledTimes(3);
      expect(result.status).toBe("ambiguous");
    });

    it("confirmation poll reads are single-attempt; the pre-command read keeps default retries", async () => {
      mockGetLockDetail
        .mockResolvedValueOnce(freshDetail())
        .mockResolvedValue(freshDetail({ lockState: "locked" }));
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

      await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(mockGetLockDetail).toHaveBeenNthCalledWith(1, EXTERNAL_ID);
      expect(mockGetLockDetail).toHaveBeenNthCalledWith(2, EXTERNAL_ID, {
        maxRetries: 0,
      });
    });
  });

  describe("RETIREMENT-SAFETY (2026-09-23 release-review Fix 4): post-command confirmation write merges onto existing metadata instead of replacing it", () => {
    it("preserves an existing retiredAt in the confirmation write itself, while fresh battery/lockState/telemetry fields still update — a write-primitive test, not an assertion that Production should permit commands against retired devices (existing guards remain fail-closed and are untouched)", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice({
          metadata: {
            lockState: "unlocked",
            retiredAt: "2026-09-20T00:00:00.000Z",
          },
        }) as never,
      );
      allowTransaction();
      mockGetLockDetail
        .mockResolvedValueOnce(freshDetail({ lockState: "unlocked" }))
        .mockResolvedValueOnce(
          freshDetail({
            lockState: "locked",
            batteryLevel: 77,
            telemetryUpdatedAt: "2026-09-18T01:23:45.000Z",
          }),
        );
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({ status: "success", lockState: "locked" });
      const metadataUpdateCall = vi
        .mocked(prisma.smartDevice.update)
        .mock.calls.find((call) => "metadata" in (call[0]?.data ?? {}));
      const updatedMetadata = metadataUpdateCall?.[0].data.metadata as Record<
        string,
        unknown
      >;
      expect(updatedMetadata.retiredAt).toBe("2026-09-20T00:00:00.000Z");
      expect(updatedMetadata.lockState).toBe("locked");
      expect(updatedMetadata.batteryLevel).toBe(77);
      expect(updatedMetadata.telemetryUpdatedAt).toBe(
        "2026-09-18T01:23:45.000Z",
      );
    });

    it("preserves an unrelated, unrecognized existing metadata key — a general merge, not a retiredAt special case", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice({
          metadata: { lockState: "unlocked", someFutureField: "keep-me" },
        }) as never,
      );
      allowTransaction();
      mockGetLockDetail
        .mockResolvedValueOnce(freshDetail({ lockState: "unlocked" }))
        .mockResolvedValueOnce(freshDetail({ lockState: "locked" }));
      mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

      await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      const metadataUpdateCall = vi
        .mocked(prisma.smartDevice.update)
        .mock.calls.find((call) => "metadata" in (call[0]?.data ?? {}));
      const updatedMetadata = metadataUpdateCall?.[0].data.metadata as Record<
        string,
        unknown
      >;
      expect(updatedMetadata.someFutureField).toBe("keep-me");
      expect(updatedMetadata.lockState).toBe("locked");
    });

    it("existing command guards remain fail-closed and untouched: a disabled ProviderDevice is still rejected before any command or write, even with retiredAt present", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice({
          metadata: { retiredAt: "2026-09-20T00:00:00.000Z" },
          providerDevice: {
            enabled: false,
            propertyId: PROPERTY_ID,
            externalDeviceId: EXTERNAL_ID,
            rawMetadata: {},
          },
        }) as never,
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({
        status: "rejected",
        reason:
          "This device is not enabled for control — map and enable it from Discovered Devices first.",
      });
      expect(mockGetLockDetail).not.toHaveBeenCalled();
      expect(mockLock).not.toHaveBeenCalled();
      expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    });

    it("existing command guards remain fail-closed and untouched: a legacy device with no ProviderDevice link at all is still rejected before any command or write", async () => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice({
          metadata: { retiredAt: "2026-09-20T00:00:00.000Z" },
          providerDevice: null,
        }) as never,
      );

      const result = await sendAugustLockCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        operation: "LOCK",
      });

      expect(result).toEqual({
        status: "rejected",
        reason:
          "This device is not enabled for control — map and enable it from Discovered Devices first.",
      });
      expect(mockGetLockDetail).not.toHaveBeenCalled();
      expect(mockLock).not.toHaveBeenCalled();
      expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    });
  });

  it("successful command audit entry: records actor/property/device/provider/operation/result and the confirmed (not guessed) resulting lock state", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail
      .mockResolvedValueOnce(freshDetail()) // pre-command: "unlocked" — genuine pending transition for LOCK
      .mockResolvedValue(freshDetail({ lockState: "locked" }));
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({ status: "success", lockState: "locked" });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        actorType: "USER",
        action: "smart_device.august_lock_command",
        entityType: "SmartDevice",
        entityId: SMART_DEVICE_ID,
        beforeState: expect.objectContaining({
          provider: "AUGUST",
          propertyId: PROPERTY_ID,
        }),
        afterState: expect.objectContaining({
          operation: "LOCK",
          result: "SUCCEEDED",
          confirmedLockState: "locked",
        }),
      }),
    );
  });

  it("never logs an access token or install id in the audit entry", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail
      .mockResolvedValueOnce(freshDetail()) // pre-command: "unlocked" (a genuine pending transition for LOCK)
      .mockResolvedValue(freshDetail({ lockState: "locked" })); // confirmation poll matches immediately, no real delay
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    const auditCall = mockRecordAudit.mock.calls[0]![0];
    const serialized = JSON.stringify(auditCall);
    expect(serialized).not.toMatch(
      /access_token|install_id|accessToken|installId/i,
    );
  });
});

describe("computeLockControlEligibility / computeFirstTestEligibility — fully dynamic (2026-09-25)", () => {
  const base = {
    externalDeviceId: EXTERNAL_ID as string | null,
    connectivity: "ONLINE",
    lastOutcome: undefined as
      "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "ADMIN_RESET" | undefined,
    lockControlEnabled: true,
  };

  it("VERIFIED + ONLINE + mapped + kill switch ON: routine controls eligible, first test not offered", () => {
    const ctx = { ...base, lastOutcome: "SUCCEEDED" as const };
    expect(computeLockControlEligibility(ctx)).toEqual({
      eligible: true,
      reason: null,
    });
    expect(computeFirstTestEligibility(ctx)).toEqual({ eligible: false });
  });

  it("untested ONLINE mapped lock: first test offered, routine controls not", () => {
    expect(computeFirstTestEligibility(base)).toEqual({ eligible: true });
    expect(computeLockControlEligibility(base)).toEqual({
      eligible: false,
      reason: "Remote control has not been verified for this lock yet.",
    });
  });

  it("ADMIN_RESET puts the lock back to not-yet-verified: first test offered, never routine", () => {
    const ctx = { ...base, lastOutcome: "ADMIN_RESET" as const };
    expect(computeFirstTestEligibility(ctx)).toEqual({ eligible: true });
    expect(computeLockControlEligibility(ctx).eligible).toBe(false);
  });

  it("kill switch OFF blocks everything, even a verified online lock", () => {
    const ctx = {
      ...base,
      lastOutcome: "SUCCEEDED" as const,
      lockControlEnabled: false,
    };
    expect(computeLockControlEligibility(ctx)).toEqual({
      eligible: false,
      reason:
        "Remote lock control is turned off by an admin. No commands can be sent to any lock.",
    });
    expect(
      computeFirstTestEligibility({ ...base, lockControlEnabled: false }),
    ).toEqual({
      eligible: false,
    });
  });

  it.each(["UNKNOWN", "OFFLINE", "ERROR"])(
    "connectivity %s: nothing is offered, with an explanation",
    (connectivity) => {
      const verified = {
        ...base,
        connectivity,
        lastOutcome: "SUCCEEDED" as const,
      };
      expect(computeLockControlEligibility(verified).eligible).toBe(false);
      expect(computeLockControlEligibility(verified).reason).toContain(
        "isn't reporting this lock as online",
      );
      expect(computeFirstTestEligibility({ ...base, connectivity })).toEqual({
        eligible: false,
      });
    },
  );

  it("unmapped/disabled (externalDeviceId null): nothing is offered", () => {
    const ctx = { ...base, externalDeviceId: null };
    expect(computeLockControlEligibility(ctx).reason).toContain(
      "not enabled for control",
    );
    expect(computeFirstTestEligibility(ctx)).toEqual({ eligible: false });
  });

  it.each(["FAILED", "AMBIGUOUS"] as const)(
    "%s blocks both workflows and points to an admin reset, even when online",
    (lastOutcome) => {
      const ctx = { ...base, lastOutcome };
      expect(computeLockControlEligibility(ctx).eligible).toBe(false);
      expect(computeLockControlEligibility(ctx).reason).toContain("admin");
      expect(computeFirstTestEligibility(ctx)).toEqual({ eligible: false });
      expect(isAdminResetAvailable(lastOutcome)).toBe(true);
    },
  );

  it("admin reset is only available for FAILED/AMBIGUOUS", () => {
    expect(isAdminResetAvailable(undefined)).toBe(false);
    expect(isAdminResetAvailable("SUCCEEDED")).toBe(false);
    expect(isAdminResetAvailable("ADMIN_RESET")).toBe(false);
  });
});

describe("getLatestAugustLockCommandOutcomes", () => {
  beforeEach(() => {
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.auditLog.findMany).mockReset();
  });

  it("requires smart_devices:read and makes no query for an empty id list", async () => {
    const result = await getLatestAugustLockCommandOutcomes(actor, []);

    expect(result.size).toBe(0);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("queries only smart_device.august_lock_command AuditLog rows for exactly the requested SmartDevice ids, ordered most-recent-first", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([]);

    await getLatestAugustLockCommandOutcomes(actor, [SMART_DEVICE_ID]);

    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
    expect(prisma.auditLog.findMany).toHaveBeenCalledWith({
      where: {
        entityType: "SmartDevice",
        entityId: { in: [SMART_DEVICE_ID] },
        action: "smart_device.august_lock_command",
      },
      orderBy: { occurredAt: "desc" },
      select: { entityId: true, afterState: true },
    });
  });

  it("takes only the FIRST (most recent) row per device — an older row for the same device is ignored", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { entityId: SMART_DEVICE_ID, afterState: { result: "SUCCEEDED" } },
      { entityId: SMART_DEVICE_ID, afterState: { result: "FAILED" } },
    ] as never);

    const result = await getLatestAugustLockCommandOutcomes(actor, [
      SMART_DEVICE_ID,
    ]);

    expect(result.get(SMART_DEVICE_ID)).toBe("SUCCEEDED");
  });

  it("returns no entry for a device with a malformed/missing afterState.result — never guesses", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { entityId: SMART_DEVICE_ID, afterState: { operation: "LOCK" } },
    ] as never);

    const result = await getLatestAugustLockCommandOutcomes(actor, [
      SMART_DEVICE_ID,
    ]);

    expect(result.has(SMART_DEVICE_ID)).toBe(false);
  });

  it("REAL EVIDENCE — Orion case (2026-09-25): recognizes AMBIGUOUS as a real recorded outcome, not silently dropped like a malformed one", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { entityId: SMART_DEVICE_ID, afterState: { result: "AMBIGUOUS" } },
    ] as never);

    const result = await getLatestAugustLockCommandOutcomes(actor, [
      SMART_DEVICE_ID,
    ]);

    expect(result.get(SMART_DEVICE_ID)).toBe("AMBIGUOUS");
  });

  it("skips a NO_ACTION_ALREADY_IN_STATE row and uses the device's next-older real outcome", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      {
        entityId: SMART_DEVICE_ID,
        afterState: { result: "NO_ACTION_ALREADY_IN_STATE" },
      },
      { entityId: SMART_DEVICE_ID, afterState: { result: "FAILED" } },
    ] as never);

    const result = await getLatestAugustLockCommandOutcomes(actor, [
      SMART_DEVICE_ID,
    ]);

    expect(result.get(SMART_DEVICE_ID)).toBe("FAILED");
  });

  it("a device whose only rows are NO_ACTION_ALREADY_IN_STATE has no recorded outcome — never counted as verified", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      {
        entityId: SMART_DEVICE_ID,
        afterState: { result: "NO_ACTION_ALREADY_IN_STATE" },
      },
    ] as never);

    const result = await getLatestAugustLockCommandOutcomes(actor, [
      SMART_DEVICE_ID,
    ]);

    expect(result.has(SMART_DEVICE_ID)).toBe(false);
  });

  it("propagates denial when the actor lacks smart_devices:read, without querying the database", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      getLatestAugustLockCommandOutcomes(actor, [SMART_DEVICE_ID]),
    ).rejects.toThrow();
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
});

describe("getLatestAugustLockCommandOutcomes — REJECTED / ADMIN_RESET handling (2026-09-25)", () => {
  beforeEach(() => {
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.auditLog.findMany).mockReset();
  });

  it("skips REJECTED rows so they never mask an older FAILED", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { entityId: SMART_DEVICE_ID, afterState: { result: "REJECTED" } },
      { entityId: SMART_DEVICE_ID, afterState: { result: "FAILED" } },
    ] as never);

    const result = await getLatestAugustLockCommandOutcomes(actor, [
      SMART_DEVICE_ID,
    ]);

    expect(result.get(SMART_DEVICE_ID)).toBe("FAILED");
  });

  it("recognizes ADMIN_RESET as the latest outcome (not verified, not blocked)", async () => {
    vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
      { entityId: SMART_DEVICE_ID, afterState: { result: "ADMIN_RESET" } },
      { entityId: SMART_DEVICE_ID, afterState: { result: "AMBIGUOUS" } },
    ] as never);

    const result = await getLatestAugustLockCommandOutcomes(actor, [
      SMART_DEVICE_ID,
    ]);

    expect(result.get(SMART_DEVICE_ID)).toBe("ADMIN_RESET");
  });
});

describe("resetAugustLockAfterPhysicalCheck (2026-09-25)", () => {
  const input = {
    smartDeviceId: SMART_DEVICE_ID,
    observedLockState: "locked" as const,
    note: "Kenny checked on site",
  };

  beforeEach(() => {
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockReset();
    vi.mocked(prisma.auditLog.findMany).mockReset().mockResolvedValue([]);
    mockRecordAudit.mockClear();
    mockLock.mockClear();
    mockUnlock.mockClear();
    mockGetLockDetail.mockClear();
  });

  it("requires a GLOBAL locks:manage grant (no propertyId scope) before reading anything", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      resetAugustLockAfterPhysicalCheck(actor, input),
    ).rejects.toThrow();
    expect(assertPermission).toHaveBeenCalledWith(actor, "locks:manage");
    expect(prisma.smartDevice.findUnique).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it.each(["FAILED", "AMBIGUOUS"])(
    "for a %s-blocked lock: writes one ADMIN_RESET audit row, sends no command, never SUCCEEDED",
    async (blocking) => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
        id: SMART_DEVICE_ID,
        provider: "AUGUST",
        propertyId: PROPERTY_ID,
        metadata: {},
      } as never);
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce([
        { afterState: { result: "REJECTED" } },
        { afterState: { result: blocking } },
      ] as never);

      const result = await resetAugustLockAfterPhysicalCheck(actor, input);

      expect(result).toEqual({ status: "success" });
      expect(mockRecordAudit).toHaveBeenCalledTimes(1);
      const audit = mockRecordAudit.mock.calls[0]![0];
      expect(audit.action).toBe("smart_device.august_lock_command");
      expect(audit.afterState).toEqual({
        result: "ADMIN_RESET",
        commandSent: false,
        observedLockState: "locked",
        resetFrom: blocking,
      });
      expect(audit.metadata.note).toBe("Kenny checked on site");
      expect(mockLock).not.toHaveBeenCalled();
      expect(mockUnlock).not.toHaveBeenCalled();
      expect(mockGetLockDetail).not.toHaveBeenCalled();
    },
  );

  it.each([[[]], [[{ afterState: { result: "SUCCEEDED" } }]]])(
    "refuses when the lock isn't blocked (history %j)",
    async (rows) => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
        id: SMART_DEVICE_ID,
        provider: "AUGUST",
        propertyId: PROPERTY_ID,
        metadata: {},
      } as never);
      vi.mocked(prisma.auditLog.findMany).mockResolvedValueOnce(rows as never);

      const result = await resetAugustLockAfterPhysicalCheck(actor, input);

      expect(result.status).toBe("rejected");
      expect(mockRecordAudit).not.toHaveBeenCalled();
    },
  );

  it("refuses a non-August device", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
      id: SMART_DEVICE_ID,
      provider: "NEST",
      propertyId: PROPERTY_ID,
      metadata: {},
    } as never);

    const result = await resetAugustLockAfterPhysicalCheck(actor, input);

    expect(result).toEqual({ status: "rejected", reason: "Device not found." });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });
});
