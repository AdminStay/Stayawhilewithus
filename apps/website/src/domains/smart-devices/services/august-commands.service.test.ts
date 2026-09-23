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

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";

import {
  computeLockControlEligibility,
  getLatestAugustLockCommandOutcomes,
  isAugustLockCommandTestDevice,
  sendAugustLockCommand,
} from "./august-commands.service";

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

  it("provider error handling (account auth): a 401 is always translated to the re-authorize message", async () => {
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

  it("provider error handling (403 as a plain Error, no HttpRequestError instance): still falls back to the pre-existing generic message rather than throwing", async () => {
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
      new Error("Request to /remoteoperate/august-lock-1/lock failed with 403"),
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

  describe("RETIREMENT-SAFETY (2026-09-23 release-review Fix 4): post-command confirmation write merges onto existing metadata instead of replacing it", () => {
    it("preserves an existing retiredAt in the confirmation write itself, while fresh battery/lockState/telemetry fields still update — a write-primitive test, not an assertion that Production should permit commands against retired devices (existing guards remain fail-closed and are untouched)", async () => {
      process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
        EXTERNAL_ID,
      ]);
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
      process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
        EXTERNAL_ID,
      ]);
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

describe("isAugustLockCommandTestDevice", () => {
  const ORIGINAL_ALLOWLIST = process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS;
  afterEach(() => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = ORIGINAL_ALLOWLIST;
  });

  it("reads the exact same env var sendAugustLockCommand() itself enforces — never a second/separate allowlist", () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);

    expect(isAugustLockCommandTestDevice(EXTERNAL_ID)).toBe(true);
    expect(isAugustLockCommandTestDevice("some-other-lock")).toBe(false);
  });

  it("fails closed (false) when the env var is unset, empty, or malformed — never 'allow everything'", () => {
    delete process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS;
    expect(isAugustLockCommandTestDevice(EXTERNAL_ID)).toBe(false);

    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = "[]";
    expect(isAugustLockCommandTestDevice(EXTERNAL_ID)).toBe(false);

    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = "not valid json";
    expect(isAugustLockCommandTestDevice(EXTERNAL_ID)).toBe(false);
  });
});

describe("computeLockControlEligibility — fail-closed, positive-verification-required (2026-09-23 correction)", () => {
  const ORIGINAL_ALLOWLIST = process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS;
  afterEach(() => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = ORIGINAL_ALLOWLIST;
  });

  it("is disabled when the device has no ProviderDevice mapping at all (externalDeviceId is null) — never inferred as eligible just because a row exists", () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);

    const result = computeLockControlEligibility(null, undefined);

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe(
      "This device is not enabled for control — map and enable it from Discovered Devices first.",
    );
  });

  it("is disabled, with the exact same copy sendAugustLockCommand() itself returns, when the device isn't in the real allowlist — even with a real recorded SUCCEEDED outcome, since the allowlist gate is checked first and independently", () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = "[]";

    const result = computeLockControlEligibility(EXTERNAL_ID, "SUCCEEDED");

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe("Live control isn't enabled for this lock yet.");
  });

  it("REAL EVIDENCE — Aqua Palm case: is eligible ONLY when allowlisted AND the most recent real attempt SUCCEEDED — real, positively-verified operability, not an absence of failure", () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);

    const result = computeLockControlEligibility(EXTERNAL_ID, "SUCCEEDED");

    expect(result).toEqual({ eligible: true, reason: null });
  });

  it("REAL EVIDENCE — MJ case: is disabled with a distinct reason when the most recent real attempt against this exact device FAILED, even though it's allowlist-eligible — this is what stops MJ (real 403, UserType user) from ever being retried through the dashboard", () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);

    const result = computeLockControlEligibility(EXTERNAL_ID, "FAILED");

    expect(result.eligible).toBe(false);
    expect(result.reason).toBe(
      "The last real attempt to control this lock did not succeed. Contact an admin before trying again.",
    );
  });

  it("FAIL-CLOSED CORRECTION: is disabled/unverified — never eligible — when allowlisted but there is no recorded attempt at all. Absence of failure evidence is not proof of operability.", () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);

    const result = computeLockControlEligibility(EXTERNAL_ID, undefined);

    expect(result).toEqual({
      eligible: false,
      reason: "Remote control has not been verified for this lock yet.",
    });
  });

  it("FAIL-CLOSED CORRECTION: is disabled/unverified — never eligible — when the only real record is a REJECTED pre-flight refusal, since that record never reached August at all and is not proof a real command would succeed", () => {
    process.env.AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS = JSON.stringify([
      EXTERNAL_ID,
    ]);

    const result = computeLockControlEligibility(EXTERNAL_ID, "REJECTED");

    expect(result).toEqual({
      eligible: false,
      reason: "Remote control has not been verified for this lock yet.",
    });
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
