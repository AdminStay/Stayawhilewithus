import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransaction,
  mockSetHeatSetpoint,
  mockSetCoolSetpoint,
  mockSetHeatCoolRange,
  mockSetThermostatMode,
  mockSetFanTimer,
  mockGetDevice,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSetHeatSetpoint: vi.fn(),
  mockSetCoolSetpoint: vi.fn(),
  mockSetHeatCoolRange: vi.fn(),
  mockSetThermostatMode: vi.fn(),
  mockSetFanTimer: vi.fn(),
  mockGetDevice: vi.fn(),
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

vi.mock("@stayw/integrations/nest", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/nest")>();
  return {
    ...actual,
    NestClient: vi.fn().mockImplementation(() => ({
      setHeatSetpoint: mockSetHeatSetpoint,
      setCoolSetpoint: mockSetCoolSetpoint,
      setHeatCoolRange: mockSetHeatCoolRange,
      setThermostatMode: mockSetThermostatMode,
      setFanTimer: mockSetFanTimer,
      getDevice: mockGetDevice,
    })),
  };
});

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import { sendNestThermostatCommand } from "./nest-commands.service";

const actor = { userId: "user-1" };
const SMART_DEVICE_ID = "11111111-1111-1111-1111-111111111111";
const PROPERTY_ID = "22222222-2222-2222-2222-222222222222";
const EXTERNAL_ID = "nest-device-1";

const COOL_FAN_ONLY_TRAITS = {
  "sdm.devices.traits.ThermostatMode": {
    mode: "COOL",
    availableModes: ["COOL", "OFF"],
  },
  "sdm.devices.traits.Fan": { timerMode: "OFF" },
};

const FULLY_CAPABLE_TRAITS = {
  "sdm.devices.traits.ThermostatMode": {
    mode: "HEAT",
    availableModes: ["HEAT", "COOL", "HEATCOOL", "OFF"],
  },
  "sdm.devices.traits.Fan": { timerMode: "OFF" },
};

const ECO_ACTIVE_TRAITS = {
  "sdm.devices.traits.ThermostatMode": {
    mode: "HEAT",
    availableModes: ["HEAT", "COOL", "HEATCOOL", "OFF"],
  },
  "sdm.devices.traits.ThermostatEco": { mode: "MANUAL_ECO" },
};

function freshDevice(rawTraits: Record<string, unknown>) {
  return {
    externalDeviceId: EXTERNAL_ID,
    resourceName: `enterprises/proj/devices/${EXTERNAL_ID}`,
    deviceType: "sdm.devices.types.THERMOSTAT",
    rawTraits,
  };
}

function mappedEnabledDevice(
  storedRawTraits: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: SMART_DEVICE_ID,
    provider: "NEST",
    propertyId: PROPERTY_ID,
    metadata: { targetTemperature: 68 },
    commandInProgressAt: null,
    property: { id: PROPERTY_ID, deletedAt: null },
    providerDevice: {
      enabled: true,
      propertyId: PROPERTY_ID,
      externalDeviceId: EXTERNAL_ID,
      rawMetadata: { rawTraits: storedRawTraits },
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

describe("sendNestThermostatCommand", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.NEST_CLIENT_ID = "test-client-id";
    process.env.NEST_CLIENT_SECRET = "test-client-secret";
    process.env.NEST_PROJECT_ID = "test-project-id";
    process.env.NEST_REFRESH_TOKEN = "test-refresh-token";
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockReset();
    mockTransaction.mockReset();
    mockGetDevice.mockReset();
    mockSetHeatSetpoint.mockReset().mockResolvedValue(undefined);
    mockSetCoolSetpoint.mockReset().mockResolvedValue(undefined);
    mockSetHeatCoolRange.mockReset().mockResolvedValue(undefined);
    mockSetThermostatMode.mockReset().mockResolvedValue(undefined);
    mockSetFanTimer.mockReset().mockResolvedValue(undefined);
    mockRecordAudit.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("rejects a device that is unmapped, before RBAC and before any lock/Nest call", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS, {
        providerDevice: {
          enabled: false,
          propertyId: null,
          externalDeviceId: EXTERNAL_ID,
          rawMetadata: { rawTraits: FULLY_CAPABLE_TRAITS },
        },
      }) as never,
    );

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(result.status).toBe("rejected");
    expect(assertPermission).not.toHaveBeenCalled();
    expect(mockGetDevice).not.toHaveBeenCalled();
    expect(mockSetThermostatMode).not.toHaveBeenCalled();
  });

  it("rejects a disabled device even if it has a propertyId", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS, {
        providerDevice: {
          enabled: false,
          propertyId: PROPERTY_ID,
          externalDeviceId: EXTERNAL_ID,
          rawMetadata: { rawTraits: FULLY_CAPABLE_TRAITS },
        },
      }) as never,
    );

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(result.status).toBe("rejected");
    expect(mockSetThermostatMode).not.toHaveBeenCalled();
  });

  it("rejects when the device's property has been soft-deleted", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS, {
        property: { id: PROPERTY_ID, deletedAt: new Date() },
      }) as never,
    );

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(result).toEqual({
      status: "rejected",
      reason: "This device's property no longer exists.",
    });
    expect(assertPermission).not.toHaveBeenCalled();
  });

  it("rejects when the actor lacks thermostats:manage, scoped to the device's property", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      sendNestThermostatCommand(actor, {
        smartDeviceId: SMART_DEVICE_ID,
        command: { type: "SET_MODE", mode: "OFF" },
      }),
    ).rejects.toThrow("ForbiddenError");

    expect(assertPermission).toHaveBeenCalledWith(actor, "thermostats:manage", {
      propertyId: PROPERTY_ID,
    });
    expect(mockGetDevice).not.toHaveBeenCalled();
  });

  it("cool-ability gating (fresh data): the real Cool/Fan-only device rejects SET_HEAT but allows SET_COOL", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValue(
      // Stored snapshot deliberately says fully capable — the fresh
      // getDevice() read below is what should actually govern the result.
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    mockGetDevice.mockResolvedValue(freshDevice(COOL_FAN_ONLY_TRAITS));

    allowTransaction();
    const heatResult = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });
    expect(heatResult.status).toBe("rejected");
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();

    allowTransaction();
    const coolResult = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_COOL", coolCelsius: 24 },
    });
    expect(coolResult).toEqual({ status: "success" });
    expect(mockSetCoolSetpoint).toHaveBeenCalledWith(EXTERNAL_ID, 24);
  });

  it("stale capability snapshot is refreshed before write: stored data says supported, fresh read says unsupported -> rejected", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never, // stale: says HEAT is fine
    );
    mockGetDevice.mockResolvedValueOnce(freshDevice(COOL_FAN_ONLY_TRAITS)); // fresh: no HEAT
    allowTransaction();

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result.status).toBe("rejected");
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
    expect(mockGetDevice).toHaveBeenCalledWith(EXTERNAL_ID);
    // Rejection after a real fresh check is still audited.
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({ result: "REJECTED" }),
      }),
    );
  });

  it("stale capability snapshot is refreshed before write: stored data says Eco off, fresh read says Eco active -> setpoint rejected", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never, // stale: no Eco
    );
    mockGetDevice.mockResolvedValueOnce(freshDevice(ECO_ACTIVE_TRAITS)); // fresh: Eco active
    allowTransaction();

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result.status).toBe("rejected");
    if (result.status === "rejected") {
      expect(result.reason).toMatch(/Eco mode/);
    }
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
  });

  it("heat/cool range ordering: rejected when heat is not strictly below cool, even if the device supports range", async () => {
    const rangeCapable = {
      "sdm.devices.traits.ThermostatMode": {
        mode: "HEATCOOL",
        availableModes: ["HEAT", "COOL", "HEATCOOL", "OFF"],
      },
    };
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(rangeCapable) as never,
    );
    mockGetDevice.mockResolvedValueOnce(freshDevice(rangeCapable));
    allowTransaction();

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_RANGE", heatCelsius: 24, coolCelsius: 20 },
    });

    expect(result.status).toBe("rejected");
    expect(mockSetHeatCoolRange).not.toHaveBeenCalled();
  });

  it("invalid numeric temperature (NaN) is rejected before any command is sent", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    mockGetDevice.mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS));
    allowTransaction();

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: Number.NaN },
    });

    expect(result.status).toBe("rejected");
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
  });

  it("invalid numeric temperature (Infinity) is rejected before any command is sent", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    mockGetDevice.mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS));
    allowTransaction();

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_COOL", coolCelsius: Number.POSITIVE_INFINITY },
    });

    expect(result.status).toBe("rejected");
    expect(mockSetCoolSetpoint).not.toHaveBeenCalled();
  });

  it("unsupported mode rejected using the fresh read", async () => {
    const heatCoolAndCoolOnly = {
      "sdm.devices.traits.ThermostatMode": {
        mode: "HEAT",
        availableModes: ["HEAT", "COOL", "OFF"],
      },
    };
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(heatCoolAndCoolOnly) as never,
    );
    mockGetDevice.mockResolvedValueOnce(freshDevice(heatCoolAndCoolOnly));
    allowTransaction();

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "HEATCOOL" },
    });

    expect(result.status).toBe("rejected");
    expect(mockSetThermostatMode).not.toHaveBeenCalled();
  });

  it("fan unavailable rejected using the fresh read", async () => {
    const noFanTraits = {
      "sdm.devices.traits.ThermostatMode": {
        mode: "COOL",
        availableModes: ["COOL", "OFF"],
      },
    };
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(noFanTraits) as never,
    );
    mockGetDevice.mockResolvedValueOnce(freshDevice(noFanTraits));
    allowTransaction();

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_FAN", timerMode: "ON" },
    });

    expect(result.status).toBe("rejected");
    expect(mockSetFanTimer).not.toHaveBeenCalled();
  });

  it("duplicate-command prevention (concurrent): a second command is rejected while the advisory lock is held by the first", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    mockTransaction.mockImplementationOnce(async (fn) =>
      fn({
        $queryRaw: vi.fn().mockResolvedValue([{ locked: false }]),
        smartDevice: { findUniqueOrThrow: vi.fn(), update: vi.fn() },
      }),
    );

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(result).toEqual({ status: "already_running" });
    expect(mockGetDevice).not.toHaveBeenCalled();
    expect(mockSetThermostatMode).not.toHaveBeenCalled();
  });

  it("duplicate-command prevention: a fresh (non-stale) in-progress marker read INSIDE the lock blocks the command", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    // Lock itself is acquired, but the in-transaction re-read finds a
    // very recent marker — must still block, proving the check is done
    // with a fresh read rather than trusting the pre-fetched smartDevice.
    allowTransaction(new Date());

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(result).toEqual({ status: "already_running" });
    expect(mockGetDevice).not.toHaveBeenCalled();
  });

  it("stale command marker recovery: an old in-progress marker (past the threshold) does not block a new command", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    const staleMarker = new Date(Date.now() - 10 * 60 * 1000); // 10 min old
    allowTransaction(staleMarker);
    mockGetDevice.mockResolvedValue(freshDevice(FULLY_CAPABLE_TRAITS));

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(result).toEqual({ status: "success" });
    expect(mockSetThermostatMode).toHaveBeenCalled();
  });

  it("marker is cleared even when the provider call throws (finally runs on the error path)", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice.mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS));
    mockSetThermostatMode.mockRejectedValueOnce(new Error("network error"));

    await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(prisma.smartDevice.update).toHaveBeenCalledWith({
      where: { id: SMART_DEVICE_ID },
      data: { commandInProgressAt: null },
    });
  });

  it("marker is cleared after a successful command too", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice.mockResolvedValue(freshDevice(FULLY_CAPABLE_TRAITS));

    await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(prisma.smartDevice.update).toHaveBeenCalledWith({
      where: { id: SMART_DEVICE_ID },
      data: { commandInProgressAt: null },
    });
  });

  it("provider error handling: a raw Google/HTTP error is translated to a safe message, never returned raw, and audited as FAILED", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice.mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS));
    mockSetThermostatMode.mockRejectedValueOnce(
      new Error(
        "Request to /enterprises/x/devices/y:executeCommand failed with 403",
      ),
    );

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") {
      expect(result.reason).not.toMatch(/403/);
      expect(result.reason).toMatch(/re-authorized/);
    }
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "smart_device.nest_command",
        afterState: expect.objectContaining({ result: "FAILED" }),
        metadata: expect.objectContaining({
          errorDetail: expect.stringContaining("403"),
        }),
      }),
    );
  });

  it("successful command reads confirmed state from Nest AFTER sending, and stores that — never a guessed value", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice
      .mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS)) // pre-command capability refresh
      .mockResolvedValueOnce({
        // post-command confirmation — deliberately a DIFFERENT value than
        // what was requested, to prove this (not a guess) is what's stored
        ...freshDevice(FULLY_CAPABLE_TRAITS),
        heatCelsius: 19.4, // Nest's own rounding/actual applied value
      });

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result).toEqual({ status: "success" });
    expect(mockGetDevice).toHaveBeenCalledTimes(2);
    expect(mockSetHeatSetpoint).toHaveBeenCalledWith(EXTERNAL_ID, 20);

    const metadataUpdateCall = vi
      .mocked(prisma.smartDevice.update)
      .mock.calls.find((call) => "metadata" in (call[0]?.data ?? {}));
    const updatedMetadata = metadataUpdateCall?.[0].data.metadata as
      { targetTemperature?: number; telemetryUpdatedAt?: string } | undefined;
    expect(updatedMetadata?.targetTemperature).toBeCloseTo(67, 0); // 19.4C confirmed, not the requested 20C (~68F)

    // Unlike setProviderDeviceEnabled() copying an old discovery snapshot,
    // this metadata comes from a client.getDevice() call that just
    // happened — a genuinely fresh timestamp here is honest, not
    // fabricated. See toSmartDeviceMetadata()'s doc comment.
    expect(updatedMetadata?.telemetryUpdatedAt).toBeDefined();
    expect(
      Date.now() - new Date(updatedMetadata!.telemetryUpdatedAt!).getTime(),
    ).toBeLessThan(5_000);
  });

  it("successful command audit entry: records actor/property/device/provider/command/result, and the confirmed (not guessed) resulting state", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice.mockResolvedValue(freshDevice(FULLY_CAPABLE_TRAITS));

    const result = await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 21 },
    });

    expect(result).toEqual({ status: "success" });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "user-1",
        actorType: "USER",
        action: "smart_device.nest_command",
        entityType: "SmartDevice",
        entityId: SMART_DEVICE_ID,
        beforeState: expect.objectContaining({
          provider: "NEST",
          propertyId: PROPERTY_ID,
        }),
        afterState: expect.objectContaining({
          command: { type: "SET_HEAT", heatCelsius: 21 },
          result: "SUCCEEDED",
        }),
      }),
    );
  });

  it("never logs an OAuth token or secret in the audit entry", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice.mockResolvedValue(freshDevice(FULLY_CAPABLE_TRAITS));

    await sendNestThermostatCommand(actor, {
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    const auditCall = mockRecordAudit.mock.calls[0]![0];
    const serialized = JSON.stringify(auditCall);
    expect(serialized).not.toMatch(/access_token|refresh_token|client_secret/i);
  });
});
