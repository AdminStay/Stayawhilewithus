import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: {
      findMany: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

const mockListLocks = vi.fn();
const mockGetLockDetail = vi.fn();
vi.mock("@stayw/integrations/august", () => ({
  AugustClient: vi.fn().mockImplementation(() => ({
    listLocks: mockListLocks,
    getLockDetail: mockGetLockDetail,
  })),
}));

const mockListDevices = vi.fn();
vi.mock("@stayw/integrations/cielo", () => ({
  CieloClient: vi.fn().mockImplementation(() => ({
    listDevices: mockListDevices,
  })),
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  getBatteryLevel,
  isDemoSmartDevice,
  isLowBattery,
  listSmartDevices,
  syncAugustDevices,
  syncCieloDevices,
} from "./smart-devices.service";

const actor = { userId: "user-1" };

describe("listSmartDevices", () => {
  it("returns devices with their property, ordered offline/error first, when granted", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findMany).mockResolvedValueOnce([
      { id: "d1" },
    ] as never);

    const result = await listSmartDevices(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
    expect(prisma.smartDevice.findMany).toHaveBeenCalledWith({
      orderBy: [{ status: "desc" }, { name: "asc" }],
      include: { property: true },
    });
    expect(result).toEqual([{ id: "d1" }]);
  });

  it("propagates denial when the actor lacks smart_devices:read", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(listSmartDevices(actor)).rejects.toThrow();
    expect(prisma.smartDevice.findMany).not.toHaveBeenCalled();
  });
});

describe("getBatteryLevel / isLowBattery", () => {
  it("reads a numeric batteryLevel out of metadata", () => {
    expect(getBatteryLevel({ metadata: { batteryLevel: 15 } })).toBe(15);
  });

  it("returns null when metadata has no batteryLevel", () => {
    expect(getBatteryLevel({ metadata: {} })).toBeNull();
    expect(getBatteryLevel({ metadata: null })).toBeNull();
  });

  it("flags below-threshold battery as low, at-or-above threshold as not low", () => {
    expect(isLowBattery({ metadata: { batteryLevel: 19 } })).toBe(true);
    expect(isLowBattery({ metadata: { batteryLevel: 20 } })).toBe(false);
  });

  it("does not flag a device with no reported battery as low", () => {
    expect(isLowBattery({ metadata: {} })).toBe(false);
  });
});

describe("isDemoSmartDevice", () => {
  it("flags a demo-prefixed externalDeviceId", () => {
    expect(
      isDemoSmartDevice({ externalDeviceId: "demo-august-ridge-front" }),
    ).toBe(true);
  });

  it("does not flag a real-looking externalDeviceId", () => {
    expect(isDemoSmartDevice({ externalDeviceId: "a1b2c3d4-e5f6" })).toBe(
      false,
    );
  });
});

describe("syncAugustDevices", () => {
  const ENV_KEYS = [
    "AUGUST_IDENTIFIER",
    "AUGUST_INSTALL_ID",
    "AUGUST_ACCESS_TOKEN",
    "AUGUST_PROPERTY_MAP",
  ] as const;
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    vi.clearAllMocks();
  });

  function setConfigured() {
    process.env.AUGUST_IDENTIFIER = "email:test@example.com";
    process.env.AUGUST_INSTALL_ID = "install-1";
    process.env.AUGUST_ACCESS_TOKEN = "token-1";
  }

  it("throws with a clear message when August credentials aren't configured", async () => {
    delete process.env.AUGUST_IDENTIFIER;
    delete process.env.AUGUST_INSTALL_ID;
    delete process.env.AUGUST_ACCESS_TOKEN;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(syncAugustDevices(actor)).rejects.toThrow(/isn't configured/);
    expect(mockListLocks).not.toHaveBeenCalled();
  });

  it("skips a lock whose houseId isn't in AUGUST_PROPERTY_MAP, and reports it back", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({
      "house-known": "property-1",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListLocks.mockResolvedValueOnce([
      { id: "lock-1", name: "Front Door", houseId: "house-unknown" },
    ]);

    const result = await syncAugustDevices(actor);

    expect(result).toEqual({ synced: 0, skippedExternalIds: ["lock-1"] });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(prisma.smartDevice.upsert).not.toHaveBeenCalled();
  });

  it("upserts a mapped lock with battery/online status converted from the raw API shape", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({
      "house-1": "property-1",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListLocks.mockResolvedValueOnce([
      { id: "lock-1", name: "Front Door", houseId: "house-1" },
    ]);
    mockGetLockDetail.mockResolvedValueOnce({
      id: "lock-1",
      name: "Front Door",
      houseId: "house-1",
      batteryLevel: 72,
      online: true,
    });

    const result = await syncAugustDevices(actor);

    expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalDeviceId: {
            provider: "AUGUST",
            externalDeviceId: "lock-1",
          },
        },
        create: expect.objectContaining({
          provider: "AUGUST",
          deviceType: "LOCK",
          externalDeviceId: "lock-1",
          propertyId: "property-1",
          status: "ONLINE",
          metadata: { batteryLevel: 72 },
        }),
      }),
    );
  });

  it("prunes stale rows (demo or previously-synced) not present in this sync, but never wipes everything on an empty fetch", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({});
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListLocks.mockResolvedValueOnce([]);

    await syncAugustDevices(actor);

    expect(prisma.smartDevice.deleteMany).not.toHaveBeenCalled();
  });
});

describe("syncCieloDevices", () => {
  const ENV_KEYS = [
    "CIELO_USERNAME",
    "CIELO_PASSWORD",
    "CIELO_PROPERTY_MAP",
  ] as const;
  const original: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) original[key] = process.env[key];

  afterEach(() => {
    for (const key of ENV_KEYS) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
    vi.clearAllMocks();
  });

  it("throws with a clear message when Cielo credentials aren't configured", async () => {
    delete process.env.CIELO_USERNAME;
    delete process.env.CIELO_PASSWORD;
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(syncCieloDevices(actor)).rejects.toThrow(/isn't configured/);
    expect(mockListDevices).not.toHaveBeenCalled();
  });

  it("upserts a mapped thermostat with no battery field (Cielo devices are hardwired)", async () => {
    process.env.CIELO_USERNAME = "user@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-2",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDevices.mockResolvedValueOnce([
      { id: "aa:bb:cc", name: "Living Room", online: false },
    ]);

    const result = await syncCieloDevices(actor);

    expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          provider: "CIELO",
          deviceType: "THERMOSTAT",
          externalDeviceId: "aa:bb:cc",
          propertyId: "property-2",
          status: "OFFLINE",
          metadata: {},
        }),
      }),
    );
  });
});
