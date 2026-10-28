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
  mockReadControl,
} = vi.hoisted(() => ({
  mockReadControl: vi.fn(),
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

// Nest control kill switch (2026-09-27). The existing tests below model the
// switch being ON (so they keep exercising the rest of the command path);
// the dedicated "kill switch OFF" block at the bottom covers the default.
vi.mock("./thermostat-control-settings.service", () => ({
  readThermostatControlSetting: mockReadControl,
  THERMOSTAT_CONTROL_OFF_REASON:
    "Remote Nest thermostat control is OFF. No thermostat command can be sent until an admin turns it on.",
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";
import { HttpRequestError } from "@stayw/integrations/core";
import { NestClient } from "@stayw/integrations/nest";

import { sendNestThermostatCommand } from "./nest-commands.service";

const actor = { userId: "user-1" };
const mockSleep = vi.fn().mockResolvedValue(undefined);

/** Every call skips the real read-back delay. */
function send(input: Parameters<typeof sendNestThermostatCommand>[1]) {
  return sendNestThermostatCommand(actor, input, { sleep: mockSleep });
}
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

/**
 * A fresh Nest read: ONLINE, heat 19 °C (~66 °F), cool 23 °C (~73 °F) —
 * inside the safety limits for the commands below. `overrides` models the
 * state a later read-back reports.
 */
function freshDevice(
  rawTraits: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    externalDeviceId: EXTERNAL_ID,
    resourceName: `enterprises/proj/devices/${EXTERNAL_ID}`,
    deviceType: "sdm.devices.types.THERMOSTAT",
    connectivity: "ONLINE",
    heatCelsius: 19,
    coolCelsius: 23,
    rawTraits,
    ...overrides,
  };
}

function mappedEnabledDevice(
  storedRawTraits: Record<string, unknown>,
  overrides: Record<string, unknown> = {},
) {
  return {
    id: SMART_DEVICE_ID,
    provider: "NEST",
    deviceType: "THERMOSTAT",
    externalDeviceId: EXTERNAL_ID,
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
    mockSleep.mockClear();
    mockReadControl.mockReset().mockResolvedValue({
      enabled: true,
      updatedAt: null,
      updatedByUserId: null,
    });
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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
      send({
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
    mockGetDevice
      .mockResolvedValueOnce(freshDevice(COOL_FAN_ONLY_TRAITS)) // heat attempt
      .mockResolvedValueOnce(freshDevice(COOL_FAN_ONLY_TRAITS)) // cool attempt
      .mockResolvedValueOnce(
        freshDevice(COOL_FAN_ONLY_TRAITS, { coolCelsius: 24 }),
      ); // cool read-back

    allowTransaction();
    const heatResult = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });
    expect(heatResult.status).toBe("rejected");
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();

    allowTransaction();
    const coolResult = await send({
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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

    const result = await send({
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
    mockGetDevice
      .mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS))
      .mockResolvedValueOnce(
        freshDevice(FULLY_CAPABLE_TRAITS, { thermostatMode: "OFF" }),
      );

    const result = await send({
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

    await send({
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

    await send({
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
      new HttpRequestError("/enterprises/x/devices/y:executeCommand", 403),
    );

    const result = await send({
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

  it("read-back that doesn't show the requested value (even after one delayed retry) is UNVERIFIED — and the read value, not a guess, is stored", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice
      .mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS)) // pre-command check
      // both read-backs report a DIFFERENT value than requested (20 C ~68 F)
      .mockResolvedValue(
        freshDevice(FULLY_CAPABLE_TRAITS, { heatCelsius: 19.4 }),
      );

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result).toEqual({
      status: "unverified",
      reason: expect.stringMatching(/doesn't report the new setting/),
    });
    expect(mockSetHeatSetpoint).toHaveBeenCalledTimes(1);
    expect(mockGetDevice).toHaveBeenCalledTimes(3);
    expect(mockSleep).toHaveBeenCalledTimes(1);
    expect(mockSleep).toHaveBeenCalledWith(3_000);

    const metadataUpdateCall = vi
      .mocked(prisma.smartDevice.update)
      .mock.calls.find((call) => "metadata" in (call[0]?.data ?? {}));
    const updatedMetadata = metadataUpdateCall?.[0].data.metadata as
      { targetTemperature?: number; telemetryUpdatedAt?: string } | undefined;
    expect(updatedMetadata?.targetTemperature).toBeCloseTo(67, 0); // 19.4C read back, not the requested 20C (~68F)
    expect(
      Date.now() - new Date(updatedMetadata!.telemetryUpdatedAt!).getTime(),
    ).toBeLessThan(5_000);

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          result: "UNVERIFIED",
          commandSent: true,
          providerAccepted: true,
          verified: false,
        }),
      }),
    );
  });

  it("a read-back that only shows the change after the delayed retry is SUCCEEDED", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice
      .mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS)) // pre-command
      .mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS)) // not yet
      .mockResolvedValueOnce(
        freshDevice(FULLY_CAPABLE_TRAITS, { heatCelsius: 20 }),
      );

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result).toEqual({ status: "success" });
    expect(mockSleep).toHaveBeenCalledTimes(1);
  });

  it("a read-back that fails after Nest accepted the command is UNVERIFIED, never success or failure", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice
      .mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS))
      .mockRejectedValueOnce(new Error("socket hang up"));

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result.status).toBe("unverified");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          result: "UNVERIFIED",
          providerAccepted: true,
          verified: false,
        }),
        metadata: { errorDetail: "socket hang up" },
      }),
    );
  });

  it("successful command audit entry: records actor/property/device/provider/command/result, and the confirmed (not guessed) resulting state", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never,
    );
    allowTransaction();
    mockGetDevice
      .mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS))
      .mockResolvedValueOnce(
        freshDevice(FULLY_CAPABLE_TRAITS, { heatCelsius: 21 }),
      );

    const result = await send({
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
          commandSent: true,
          providerAccepted: true,
          verified: true,
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

    await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    const auditCall = mockRecordAudit.mock.calls[0]![0];
    const serialized = JSON.stringify(auditCall);
    expect(serialized).not.toMatch(/access_token|refresh_token|client_secret/i);
  });
});

describe("sendNestThermostatCommand — command safety (2026-10-28)", () => {
  beforeEach(() => {
    process.env.NEST_CLIENT_ID = "test-client-id";
    process.env.NEST_CLIENT_SECRET = "test-client-secret";
    process.env.NEST_PROJECT_ID = "test-project-id";
    process.env.NEST_REFRESH_TOKEN = "test-refresh-token";
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.smartDevice.findUnique)
      .mockReset()
      .mockResolvedValue(mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never);
    mockTransaction.mockReset();
    mockGetDevice.mockReset();
    mockSetHeatSetpoint.mockReset().mockResolvedValue(undefined);
    mockSetCoolSetpoint.mockReset().mockResolvedValue(undefined);
    mockRecordAudit.mockClear();
    mockSleep.mockClear();
    mockReadControl.mockReset().mockResolvedValue({
      enabled: true,
      updatedAt: null,
      updatedByUserId: null,
    });
  });

  it.each([
    [
      "the mapping points at another property",
      { propertyId: "33333333-3333-3333-3333-333333333333" },
    ],
    [
      "the mapping points at another Nest device",
      { externalDeviceId: "other" },
    ],
  ])(
    "rejects when %s — before RBAC, the lock or any Nest call",
    async (_label, mismatch) => {
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        mappedEnabledDevice(FULLY_CAPABLE_TRAITS, {
          providerDevice: {
            enabled: true,
            propertyId: PROPERTY_ID,
            externalDeviceId: EXTERNAL_ID,
            rawMetadata: { rawTraits: FULLY_CAPABLE_TRAITS },
            ...mismatch,
          },
        }) as never,
      );

      const result = await send({
        smartDeviceId: SMART_DEVICE_ID,
        command: { type: "SET_HEAT", heatCelsius: 20 },
      });

      expect(result).toEqual({
        status: "rejected",
        reason: expect.stringMatching(/mapping doesn't match/),
      });
      expect(assertPermission).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockGetDevice).not.toHaveBeenCalled();
    },
  );

  it("rejects a non-thermostat Nest device", async () => {
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      mappedEnabledDevice(FULLY_CAPABLE_TRAITS, {
        deviceType: "CAMERA",
      }) as never,
    );

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result).toEqual({ status: "rejected", reason: "Device not found." });
    expect(mockGetDevice).not.toHaveBeenCalled();
  });

  it("refuses a thermostat the fresh read reports OFFLINE — nothing sent, audited REJECTED", async () => {
    allowTransaction();
    mockGetDevice.mockResolvedValueOnce(
      freshDevice(FULLY_CAPABLE_TRAITS, { connectivity: "OFFLINE" }),
    );

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result).toEqual({
      status: "rejected",
      reason: expect.stringMatching(/offline/),
    });
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          result: "REJECTED",
          commandSent: false,
        }),
      }),
    );
  });

  it("refuses a setpoint more than 5 °F from the current one, from the fresh read", async () => {
    allowTransaction();
    // current heat 19 C (~66 F); 23 C is ~73 F
    mockGetDevice.mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS));

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 23 },
    });

    expect(result).toEqual({
      status: "rejected",
      reason: expect.stringMatching(/at most 5°F/),
    });
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
  });

  it("refuses a setpoint outside 60–85 °F even when the step is small", async () => {
    allowTransaction();
    mockGetDevice.mockResolvedValueOnce(
      freshDevice(FULLY_CAPABLE_TRAITS, { heatCelsius: 16 }), // ~61 F
    );

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 15 }, // 59 F
    });

    expect(result).toEqual({
      status: "rejected",
      reason: "Choose a temperature between 60°F and 85°F.",
    });
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
  });

  it.each([
    ["a timeout", Object.assign(new Error("aborted"), { name: "AbortError" })],
    ["a network error", new TypeError("fetch failed")],
    [
      "a 503 answer",
      new HttpRequestError("/enterprises/x/devices/y:executeCommand", 503),
    ],
  ])(
    "%s on the command is UNVERIFIED — sent once, never retried, never reported as nothing sent",
    async (_label, error) => {
      allowTransaction();
      mockGetDevice.mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS));
      mockSetHeatSetpoint.mockRejectedValueOnce(error);

      const result = await send({
        smartDeviceId: SMART_DEVICE_ID,
        command: { type: "SET_HEAT", heatCelsius: 20 },
      });

      expect(result).toEqual({
        status: "unverified",
        reason: expect.stringMatching(/may or may not have been applied/),
      });
      expect(mockSetHeatSetpoint).toHaveBeenCalledTimes(1);
      expect(mockGetDevice).toHaveBeenCalledTimes(1); // no read-back after an unanswered command
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({
          afterState: expect.objectContaining({
            result: "UNVERIFIED",
            commandSent: true,
            providerAccepted: null,
          }),
        }),
      );
      expect(prisma.smartDevice.update).toHaveBeenCalledWith({
        where: { id: SMART_DEVICE_ID },
        data: { commandInProgressAt: null },
      });
    },
  );

  it("a 400 answer means Nest refused the command — FAILED, with a safe message", async () => {
    allowTransaction();
    mockGetDevice.mockResolvedValueOnce(freshDevice(FULLY_CAPABLE_TRAITS));
    mockSetHeatSetpoint.mockRejectedValueOnce(
      new HttpRequestError("/enterprises/x/devices/y:executeCommand", 400),
    );

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result.status).toBe("failure");
    if (result.status === "failure") expect(result.reason).not.toMatch(/400/);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          result: "FAILED",
          commandSent: true,
          providerAccepted: false,
        }),
      }),
    );
  });

  it("an error before anything is sent (the pre-command read) is FAILED with commandSent: false", async () => {
    allowTransaction();
    mockGetDevice.mockRejectedValueOnce(
      new HttpRequestError("/enterprises/x/devices/y", 503),
    );

    const result = await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_HEAT", heatCelsius: 20 },
    });

    expect(result.status).toBe("failure");
    expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        afterState: expect.objectContaining({
          result: "FAILED",
          commandSent: false,
        }),
      }),
    );
  });
});

describe("sendNestThermostatCommand — global kill switch OFF (2026-09-27, Nest Phase 1)", () => {
  const ALL_COMMANDS = [
    { type: "SET_HEAT", heatCelsius: 20 },
    { type: "SET_COOL", coolCelsius: 24 },
    { type: "SET_RANGE", heatCelsius: 19, coolCelsius: 25 },
    { type: "SET_MODE", mode: "OFF" },
    { type: "SET_FAN", timerMode: "ON", durationSeconds: 900 },
  ] as const;

  beforeEach(() => {
    process.env.NEST_CLIENT_ID = "test-client-id";
    process.env.NEST_CLIENT_SECRET = "test-client-secret";
    process.env.NEST_PROJECT_ID = "test-project-id";
    process.env.NEST_REFRESH_TOKEN = "test-refresh-token";
    vi.mocked(assertPermission).mockReset().mockResolvedValue(undefined);
    vi.mocked(prisma.smartDevice.findUnique)
      .mockReset()
      .mockResolvedValue(mappedEnabledDevice(FULLY_CAPABLE_TRAITS) as never);
    vi.mocked(NestClient).mockClear();
    mockTransaction.mockReset();
    mockGetDevice.mockReset();
    for (const m of [
      mockSetHeatSetpoint,
      mockSetCoolSetpoint,
      mockSetHeatCoolRange,
      mockSetThermostatMode,
      mockSetFanTimer,
    ]) {
      m.mockReset();
    }
    mockRecordAudit.mockClear();
    mockReadControl.mockReset().mockResolvedValue({
      enabled: false,
      updatedAt: null,
      updatedByUserId: null,
    });
  });

  it.each(ALL_COMMANDS)(
    "refuses $type before the duplicate-command lock, before the Nest client exists and before any Google call",
    async (command) => {
      const result = await send({
        smartDeviceId: SMART_DEVICE_ID,
        command: command as never,
      });

      expect(result).toEqual({
        status: "rejected",
        reason: expect.stringContaining(
          "Remote Nest thermostat control is OFF",
        ),
      });
      expect(NestClient).not.toHaveBeenCalled();
      expect(mockGetDevice).not.toHaveBeenCalled();
      expect(mockSetHeatSetpoint).not.toHaveBeenCalled();
      expect(mockSetCoolSetpoint).not.toHaveBeenCalled();
      expect(mockSetHeatCoolRange).not.toHaveBeenCalled();
      expect(mockSetThermostatMode).not.toHaveBeenCalled();
      expect(mockSetFanTimer).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(prisma.smartDevice.update).not.toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            commandInProgressAt: expect.anything(),
          }),
        }),
      );
    },
  );

  it("audits the refusal as REJECTED (kill switch), with no secret in the entry", async () => {
    await send({
      smartDeviceId: SMART_DEVICE_ID,
      command: { type: "SET_MODE", mode: "OFF" },
    });

    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    const entry = JSON.stringify(mockRecordAudit.mock.calls[0]);
    expect(entry).toContain("REJECTED");
    expect(entry).toContain("kill switch");
    expect(entry).not.toMatch(/test-refresh-token|test-client-secret/);
  });

  it("RBAC still runs first: a user without thermostats:manage is denied, and the switch is never even read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(new Error("Forbidden"));

    await expect(
      send({
        smartDeviceId: SMART_DEVICE_ID,
        command: { type: "SET_MODE", mode: "OFF" },
      }),
    ).rejects.toThrow("Forbidden");
    expect(mockReadControl).not.toHaveBeenCalled();
    expect(NestClient).not.toHaveBeenCalled();
  });
});
