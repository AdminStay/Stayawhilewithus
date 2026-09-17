import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransaction,
  mockLock,
  mockUnlock,
  mockUnlatch,
  mockGetLockDetail,
  mockGetLockCapabilities,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockLock: vi.fn(),
  mockUnlock: vi.fn(),
  mockUnlatch: vi.fn(),
  mockGetLockDetail: vi.fn(),
  mockGetLockCapabilities: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
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

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { sendAugustLockCommand } from "./august-commands.service";

const actor = { userId: "user-1" };
const SMART_DEVICE_ID = "11111111-1111-1111-1111-111111111111";
const PROPERTY_ID = "22222222-2222-2222-2222-222222222222";
const EXTERNAL_ID = "august-lock-1";
const SERIAL_NUMBER = "M0123456";

function freshDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: EXTERNAL_ID,
    name: "Front Door",
    houseId: "house-1",
    batteryLevel: 80,
    connectivity: "ONLINE",
    lockState: "locked",
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
      smartDevice: {
        findUniqueOrThrow: vi.fn().mockResolvedValue({ commandInProgressAt }),
        update: vi.fn().mockResolvedValue({}),
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
    mockTransaction.mockReset();
    mockGetLockDetail.mockReset();
    mockGetLockCapabilities.mockReset();
    mockLock.mockReset().mockResolvedValue(undefined);
    mockUnlock.mockReset().mockResolvedValue(undefined);
    mockUnlatch.mockReset().mockResolvedValue(undefined);
    mockRecordAudit.mockClear();
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

  it("PRODUCTION SAFETY GATE: rejects a fully-authorized, fully-capable device when AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS is unset (fail-closed by default)", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result).toEqual({
      status: "rejected",
      reason: "Live control isn't enabled for this lock yet.",
    });
    expect(mockLock).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({ result: "REJECTED" }),
        metadata: expect.objectContaining({
          errorDetail: expect.stringContaining("allowlist"),
        }),
      }),
    );
  });

  it("PRODUCTION SAFETY GATE: rejects when the allowlist contains a DIFFERENT device's id, never a wildcard/partial match", async () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      "some-other-lock",
    ]);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("rejected");
    expect(mockLock).not.toHaveBeenCalled();
  });

  it("authorized LOCK command succeeds when explicitly allowlisted, capable, and authorized", async () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
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
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail
      .mockResolvedValueOnce(freshDetail())
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
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    const staleMarker = new Date(Date.now() - 10 * 60 * 1000);
    allowTransaction(staleMarker);
    mockGetLockDetail.mockResolvedValue(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);

    const result = await sendAugustLockCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      operation: "LOCK",
    });

    expect(result.status).toBe("success");
    expect(mockLock).toHaveBeenCalled();
  });

  it("marker is cleared even when the provider call throws (finally runs on the error path)", async () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
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

  it("provider error handling (timeout): a raw HTTP 408 is translated to a safe message, never returned raw, and audited as FAILED", async () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
    mockGetLockCapabilities.mockResolvedValueOnce(FULLY_CAPABLE);
    mockLock.mockRejectedValueOnce(
      new Error("Request to /remoteoperate/august-lock-1/lock failed with 408"),
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

  it("provider error handling (bridge offline): a raw HTTP 422 is translated to a safe, specific message", async () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValueOnce(freshDetail());
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

    expect(result.status).toBe("failure");
    if (result.status === "failure") {
      expect(result.reason).toMatch(/bridge is currently offline/);
    }
  });

  it("successful command reads confirmed state from August AFTER sending, and stores that — never a guessed value", async () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
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

  it("successful command audit entry: records actor/property/device/provider/operation/result and the confirmed (not guessed) resulting lock state", async () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValue(freshDetail({ lockState: "locked" }));
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
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice() as never,
    );
    allowTransaction();
    mockGetLockDetail.mockResolvedValue(freshDetail());
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
