import { afterEach, describe, expect, it, vi } from "vitest";

// retireSmartDevice()'s own transaction callback receives a `tx` client and
// calls `tx.smartDevice.update(...)` — routed to this SAME spy instance
// (not a second, separate one) so every existing assertion against
// `prisma.smartDevice.update` still observes calls made through the
// transaction, exactly as if it were the top-level client. This is the
// established pattern this file already uses for other Prisma mocks; the
// only new piece is `$transaction`'s callback-form support. vi.hoisted()
// is required — vi.mock() factories are hoisted above every top-level
// statement, same discipline as lock-refresh.service.test.ts.
const { smartDeviceUpdateMock } = vi.hoisted(() => ({
  smartDeviceUpdateMock: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: smartDeviceUpdateMock,
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    // Defaults to "nothing already mapped via ProviderDevice" so every
    // existing test's skip behavior is unchanged unless a test explicitly
    // overrides this with mockResolvedValueOnce.
    providerDevice: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    // Only the callback form is real-exercised in this file today
    // (retireSmartDevice()) — mirrors real Prisma behavior for that form:
    // runs the callback with a `tx` client, propagates whatever it
    // throws/resolves. The array form isn't used anywhere in this
    // particular service file, so it's deliberately unimplemented here
    // rather than guessed at.
    $transaction: vi.fn(async (arg: unknown) => {
      if (typeof arg !== "function") {
        throw new Error(
          "This mock only supports the $transaction callback form.",
        );
      }
      return (
        arg as (tx: {
          smartDevice: { update: typeof smartDeviceUpdateMock };
        }) => unknown
      )({ smartDevice: { update: smartDeviceUpdateMock } });
    }),
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

const { mockSetProviderDeviceEnabled, mockRecordAudit } = vi.hoisted(() => ({
  mockSetProviderDeviceEnabled: vi.fn(),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
}));
vi.mock("./provider-devices.service", () => ({
  setProviderDeviceEnabled: mockSetProviderDeviceEnabled,
}));
vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
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
import { AugustClient } from "@stayw/integrations/august";

import {
  getBatteryLevel,
  getLockState,
  canRenderNestControls,
  getTelemetryUpdatedAt,
  isDemoSmartDevice,
  isLockVisible,
  isLowBattery,
  isTelemetryStale,
  isThermostatVisible,
  listSmartDevices,
  retireSmartDevice,
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
      include: { property: true, providerDevice: true },
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

describe("getLockState / getTelemetryUpdatedAt / isTelemetryStale", () => {
  it("reads lockState from metadata, null when absent", () => {
    expect(getLockState({ metadata: { lockState: "locked" } })).toBe("locked");
    expect(getLockState({ metadata: {} })).toBeNull();
  });

  it("parses telemetryUpdatedAt from metadata into a Date, null when absent or invalid", () => {
    const result = getTelemetryUpdatedAt({
      metadata: { telemetryUpdatedAt: "2026-08-19T18:00:00.000Z" },
    });
    expect(result).toEqual(new Date("2026-08-19T18:00:00.000Z"));
    expect(getTelemetryUpdatedAt({ metadata: {} })).toBeNull();
    expect(
      getTelemetryUpdatedAt({ metadata: { telemetryUpdatedAt: "not-a-date" } }),
    ).toBeNull();
  });

  it("flags telemetry stale only past the 24-hour threshold, chosen from real observed data (see the doc comment on TELEMETRY_STALE_THRESHOLD_MS)", () => {
    const threeHoursAgo = new Date(
      Date.now() - 3 * 60 * 60 * 1000,
    ).toISOString();
    const fortySixHoursAgo = new Date(
      Date.now() - 46 * 60 * 60 * 1000,
    ).toISOString();

    expect(
      isTelemetryStale({ metadata: { telemetryUpdatedAt: threeHoursAgo } }),
    ).toBe(false);
    expect(
      isTelemetryStale({
        metadata: { telemetryUpdatedAt: fortySixHoursAgo },
      }),
    ).toBe(true);
  });

  it("does not flag a device with no telemetry timestamp at all as stale", () => {
    expect(isTelemetryStale({ metadata: {} })).toBe(false);
  });
});

describe("isThermostatVisible", () => {
  // Properly typed against isThermostatVisible's own parameter type (no
  // `as never`) — a wrong `provider` string or a `providerDevice` shape
  // that doesn't match `{ enabled: boolean } | null` would fail to
  // compile, not just fail at runtime.
  type ThermostatVisibilityInput = Parameters<typeof isThermostatVisible>[0];

  function device(
    provider: ThermostatVisibilityInput["provider"],
    providerDevice: ThermostatVisibilityInput["providerDevice"],
  ): ThermostatVisibilityInput {
    return { provider, providerDevice };
  }

  it("shows an enabled, mapped Nest thermostat", () => {
    expect(isThermostatVisible(device("NEST", { enabled: true }))).toBe(true);
  });

  it("hides a Nest thermostat after Disable (ProviderDevice exists but enabled=false)", () => {
    expect(isThermostatVisible(device("NEST", { enabled: false }))).toBe(false);
  });

  it("hides an orphaned Nest thermostat after Unmap (SmartDevice preserved, providerDevice relation null)", () => {
    expect(isThermostatVisible(device("NEST", null))).toBe(false);
  });

  it("never hides a non-Nest thermostat — Cielo has no providerDevice relation at all, unaffected by this rule", () => {
    expect(isThermostatVisible(device("CIELO", null))).toBe(true);
  });
});

describe("canRenderNestControls", () => {
  it("renders when the device has real trait data AND the actor has thermostats:manage for its property", () => {
    expect(canRenderNestControls({ hasRawTraits: true, canManage: true })).toBe(
      true,
    );
  });

  it("does not render when the actor lacks thermostats:manage, even if the device has trait data", () => {
    expect(
      canRenderNestControls({ hasRawTraits: true, canManage: false }),
    ).toBe(false);
  });

  it("does not render when there's no trait data, even if the actor has thermostats:manage", () => {
    expect(
      canRenderNestControls({ hasRawTraits: false, canManage: true }),
    ).toBe(false);
  });

  it("does not render when neither condition holds", () => {
    expect(
      canRenderNestControls({ hasRawTraits: false, canManage: false }),
    ).toBe(false);
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

  it("reports a lock already mapped via ProviderDevice separately from genuinely unmapped ones — never calls it 'no property mapping'", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({
      "house-known": "property-1",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListLocks.mockResolvedValueOnce([
      {
        id: "lock-mapped-elsewhere",
        name: "Camingo - Front Door",
        houseId: "house-camingo",
      },
      {
        id: "lock-truly-unmapped",
        name: "Some New Lock",
        houseId: "house-new",
      },
    ]);
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce([
      { externalDeviceId: "lock-mapped-elsewhere" },
    ] as never);

    const result = await syncAugustDevices(actor);

    expect(prisma.providerDevice.findMany).toHaveBeenCalledWith({
      where: {
        integrationConnection: { provider: "AUGUST" },
        externalDeviceId: {
          in: ["lock-mapped-elsewhere", "lock-truly-unmapped"],
        },
        propertyId: { not: null },
      },
      select: { externalDeviceId: true },
    });
    expect(result).toEqual({
      synced: 0,
      skippedExternalIds: ["lock-truly-unmapped"],
      alreadyMappedExternalIds: ["lock-mapped-elsewhere"],
    });
    // Still read-only for both — this legacy sync writes to neither.
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(prisma.smartDevice.upsert).not.toHaveBeenCalled();
  });

  it("never queries ProviderDevice when every lock is already covered by AUGUST_PROPERTY_MAP (nothing to check)", async () => {
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
      connectivity: "ONLINE",
      lockState: "locked",
      telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
      seenAt: "2026-08-19T19:00:00.000Z",
    });

    const result = await syncAugustDevices(actor);

    expect(prisma.providerDevice.findMany).not.toHaveBeenCalled();
    expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
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
      connectivity: "ONLINE",
      lockState: "locked",
      telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
      seenAt: "2026-08-19T19:00:00.000Z",
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
          metadata: {
            batteryLevel: 72,
            lockState: "locked",
            telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
          },
          lastSeenAt: new Date("2026-08-19T19:00:00.000Z"),
        }),
      }),
    );
  });

  it("classifies UNKNOWN connectivity correctly at the sync layer, never falling back to OFFLINE (regression: this was the real production bug)", async () => {
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
      batteryLevel: 93,
      connectivity: "UNKNOWN",
      lockState: null,
      telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
      seenAt: null,
    });

    await syncAugustDevices(actor);

    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: "UNKNOWN",
          lastSeenAt: null,
          metadata: {
            batteryLevel: 93,
            telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
          },
        }),
      }),
    );
  });

  it("stores explicit OFFLINE (provider-confirmed), never conflated with UNKNOWN", async () => {
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
      batteryLevel: 40,
      connectivity: "OFFLINE",
      lockState: "locked",
      telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
      seenAt: "2026-08-19T17:00:00.000Z",
    });

    await syncAugustDevices(actor);

    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ status: "OFFLINE" }),
      }),
    );
  });

  it("never puts PIN values, guest names, or any raw account/auth data into SmartDevice.metadata — only the whitelisted safe fields", async () => {
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
      batteryLevel: 93,
      connectivity: "ONLINE",
      lockState: "locked",
      telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
      seenAt: "2026-08-19T19:00:00.000Z",
    });

    await syncAugustDevices(actor);

    const call = vi.mocked(prisma.smartDevice.upsert).mock.calls[0]?.[0];
    const metadataKeys = Object.keys(
      (call as { create: { metadata: object } }).create.metadata,
    );
    expect(metadataKeys.sort()).toEqual(
      ["batteryLevel", "lockState", "telemetryUpdatedAt"].sort(),
    );
  });

  it("never deletes anything, even on a completely empty fetch (regression: pruneStaleDevices used to hard-delete on this exact path)", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({});
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListLocks.mockResolvedValueOnce([]);

    await syncAugustDevices(actor);

    expect(prisma.smartDevice.deleteMany).not.toHaveBeenCalled();
  });

  it("never deletes anything when the provider returns fewer devices than a prior sync would have known about (the exact scenario that caused real Cielo data loss)", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({
      "house-1": "property-1",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    // Only one lock returned this run — simulates a provider account that
    // used to have more locks visible to it.
    mockListLocks.mockResolvedValueOnce([
      { id: "lock-1", name: "Front Door", houseId: "house-1" },
    ]);
    mockGetLockDetail.mockResolvedValueOnce({
      id: "lock-1",
      name: "Front Door",
      houseId: "house-1",
      batteryLevel: 90,
      connectivity: "ONLINE",
      lockState: null,
      telemetryUpdatedAt: null,
      seenAt: null,
    });

    const result = await syncAugustDevices(actor);

    expect(result.synced).toBe(1);
    expect(prisma.smartDevice.deleteMany).not.toHaveBeenCalled();
  });

  it("excludes a lock ID listed in AUGUST_EXCLUDED_LOCK_IDS — it never reaches the upsert call and never becomes a SmartDevice", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({
      "house-1": "property-1",
    });
    process.env.AUGUST_EXCLUDED_LOCK_IDS = JSON.stringify(["lock-bridge"]);
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListLocks.mockResolvedValueOnce([
      { id: "lock-bridge", name: "Bridge", houseId: "house-1" },
    ]);

    const result = await syncAugustDevices(actor);

    expect(result).toEqual({ synced: 0, skippedExternalIds: [] });
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(prisma.smartDevice.upsert).not.toHaveBeenCalled();
    delete process.env.AUGUST_EXCLUDED_LOCK_IDS;
  });

  it("a failure partway through the loop does not erase or delete devices already synced earlier in the same run", async () => {
    setConfigured();
    process.env.AUGUST_PROPERTY_MAP = JSON.stringify({
      "house-1": "property-1",
      "house-2": "property-2",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListLocks.mockResolvedValueOnce([
      { id: "lock-1", name: "Front Door", houseId: "house-1" },
      { id: "lock-2", name: "Back Door", houseId: "house-2" },
    ]);
    mockGetLockDetail
      .mockResolvedValueOnce({
        id: "lock-1",
        name: "Front Door",
        houseId: "house-1",
        batteryLevel: 90,
        connectivity: "ONLINE",
        lockState: null,
        telemetryUpdatedAt: null,
        seenAt: null,
      })
      .mockRejectedValueOnce(new Error("August API request failed"));

    await expect(syncAugustDevices(actor)).rejects.toThrow(
      "August API request failed",
    );

    // lock-1 was already upserted before lock-2's failure — that write
    // isn't undone, and nothing was ever deleted as a result of the
    // failure.
    expect(prisma.smartDevice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.smartDevice.deleteMany).not.toHaveBeenCalled();
  });

  describe("RETIREMENT-SAFETY (2026-09-23 release-review Fix 3): merges fresh telemetry onto existing metadata instead of replacing it", () => {
    it("preserves a legacy mapped device's existing retiredAt while fresh telemetry still updates", async () => {
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
        connectivity: "ONLINE",
        lockState: "locked",
        telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
        seenAt: "2026-08-19T19:00:00.000Z",
      });
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
        metadata: {
          retiredAt: "2026-09-20T00:00:00.000Z",
          batteryLevel: 10,
        },
      } as never);

      const result = await syncAugustDevices(actor);

      expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
      expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            metadata: expect.objectContaining({
              // The retirement marker survives, unchanged.
              retiredAt: "2026-09-20T00:00:00.000Z",
              // Fresh telemetry still updates correctly.
              batteryLevel: 72,
              lockState: "locked",
              telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
            }),
          }),
        }),
      );
    });

    it("preserves an unrelated, unrecognized existing metadata key — a general merge, not a retiredAt special case", async () => {
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
        batteryLevel: 50,
        connectivity: "ONLINE",
        lockState: null,
        telemetryUpdatedAt: null,
        seenAt: null,
      });
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
        metadata: { someFutureField: "keep-me" },
      } as never);

      await syncAugustDevices(actor);

      expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({
            metadata: expect.objectContaining({
              someFutureField: "keep-me",
              batteryLevel: 50,
            }),
          }),
        }),
      );
    });

    it("a brand-new legacy-mapped SmartDevice (no existing row) still creates correctly, with no retiredAt fabricated", async () => {
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
        connectivity: "ONLINE",
        lockState: "locked",
        telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
        seenAt: "2026-08-19T19:00:00.000Z",
      });
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(null);

      const result = await syncAugustDevices(actor);

      expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
      expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({
            metadata: {
              batteryLevel: 72,
              lockState: "locked",
              telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
            },
          }),
        }),
      );
      const upsertArgs = vi.mocked(prisma.smartDevice.upsert).mock.calls[0]![0];
      expect(Object.keys(upsertArgs.create.metadata as object)).not.toContain(
        "retiredAt",
      );
    });

    it("performs a pure metadata read-then-upsert for a retired device — no retirement/unretirement side effect, and structurally cannot reach a lock/unlock/unlatch call (this file's own AugustClient mock exposes only listLocks/getLockDetail)", async () => {
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
        connectivity: "ONLINE",
        lockState: "locked",
        telemetryUpdatedAt: "2026-08-19T18:00:00.000Z",
        seenAt: "2026-08-19T19:00:00.000Z",
      });
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce({
        metadata: { retiredAt: "2026-09-20T00:00:00.000Z" },
      } as never);

      const result = await syncAugustDevices(actor);

      // The retirement marker is preserved (not touched in either
      // direction) — this sync neither erases nor intentionally clears it.
      const upsertArgs = vi.mocked(prisma.smartDevice.upsert).mock.calls[0]![0];
      expect(
        (upsertArgs.update as { metadata: Record<string, unknown> }).metadata
          .retiredAt,
      ).toBe("2026-09-20T00:00:00.000Z");
      expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
    });
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

  it("REGRESSION (2026-09-18/19): update never includes `metadata` — sync must never erase telemetry refreshCieloTelemetry() already wrote, regardless of what this run's own provider response contains", async () => {
    process.env.CIELO_USERNAME = "user@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-2",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    // This run's own response reports no rich telemetry at all — exactly
    // what would previously have wiped any existing metadata to `{}`.
    mockListDevices.mockResolvedValueOnce([
      { id: "aa:bb:cc", name: "Living Room", online: true },
    ]);

    await syncCieloDevices(actor);

    const call = vi.mocked(prisma.smartDevice.upsert).mock.calls[0]?.[0];
    expect(call?.update).toBeDefined();
    expect(call?.update).not.toHaveProperty("metadata");
    // Sync still owns and updates its own fields.
    expect(call?.update).toMatchObject({
      propertyId: "property-2",
      name: "Living Room",
      status: "ONLINE",
    });
  });

  it("never deletes a mapped device that the provider stops returning (regression: this exact case deleted the real Ocean Pearl/Miramar Bliss SmartDevice rows in production)", async () => {
    process.env.CIELO_USERNAME = "user@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-2",
      "dd:ee:ff": "property-3",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    // Only one of the two mapped devices comes back this run.
    mockListDevices.mockResolvedValueOnce([
      { id: "aa:bb:cc", name: "Living Room", online: true },
    ]);

    const result = await syncCieloDevices(actor);

    expect(result.synced).toBe(1);
    expect(prisma.smartDevice.deleteMany).not.toHaveBeenCalled();
  });

  it("an intentionally unmapped device (no entry in CIELO_PROPERTY_MAP) never becomes a SmartDevice, even though the provider still returns it", async () => {
    process.env.CIELO_USERNAME = "user@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-2",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDevices.mockResolvedValueOnce([
      { id: "aa:bb:cc", name: "Living Room", online: true },
      { id: "ff:ff:ff", name: "Personal Residence", online: true },
    ]);

    const result = await syncCieloDevices(actor);

    expect(result).toEqual({ synced: 1, skippedExternalIds: ["ff:ff:ff"] });
    expect(prisma.smartDevice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.smartDevice.upsert).not.toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({ externalDeviceId: "ff:ff:ff" }),
      }),
    );
  });

  it("a Prisma failure partway through the loop does not delete or erase devices already synced earlier in the same run", async () => {
    process.env.CIELO_USERNAME = "user@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-2",
      "dd:ee:ff": "property-3",
    });
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    mockListDevices.mockResolvedValueOnce([
      { id: "aa:bb:cc", name: "Living Room", online: true },
      { id: "dd:ee:ff", name: "Bedroom", online: true },
    ]);
    vi.mocked(prisma.smartDevice.upsert)
      .mockResolvedValueOnce({} as never)
      .mockRejectedValueOnce(new Error("Database connection lost"));

    await expect(syncCieloDevices(actor)).rejects.toThrow(
      "Database connection lost",
    );

    expect(prisma.smartDevice.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.smartDevice.deleteMany).not.toHaveBeenCalled();
  });
});

describe("isLockVisible — C, centralized /locks visibility rule", () => {
  it("shows a non-retired August lock (no retiredAt in metadata at all)", () => {
    expect(isLockVisible({ provider: "AUGUST", metadata: {} })).toBe(true);
  });

  it("shows an August lock when metadata itself is null", () => {
    expect(isLockVisible({ provider: "AUGUST", metadata: null })).toBe(true);
  });

  it("hides an August lock with a real, valid retiredAt", () => {
    expect(
      isLockVisible({
        provider: "AUGUST",
        metadata: { retiredAt: new Date().toISOString() },
      }),
    ).toBe(false);
  });

  it("FAIL-SAFE: a malformed (unparseable) retiredAt string does NOT hide the lock — never silently treated as retired", () => {
    expect(
      isLockVisible({
        provider: "AUGUST",
        metadata: { retiredAt: "not-a-real-date" },
      }),
    ).toBe(true);
  });

  it("FAIL-SAFE: a wrong-typed retiredAt (not a string) does NOT hide the lock", () => {
    expect(
      isLockVisible({ provider: "AUGUST", metadata: { retiredAt: 12345 } }),
    ).toBe(true);
  });

  it("never hides a non-August device, even with a real retiredAt-shaped value in its metadata — scoped strictly to August", () => {
    expect(
      isLockVisible({
        provider: "CIELO",
        metadata: { retiredAt: new Date().toISOString() },
      }),
    ).toBe(true);
    expect(
      isLockVisible({
        provider: "NEST",
        metadata: { retiredAt: new Date().toISOString() },
      }),
    ).toBe(true);
  });
});

describe("retireSmartDevice — C, explicit human-controlled retirement", () => {
  const SMART_DEVICE_ID = "11111111-1111-1111-1111-111111111111";
  const PROVIDER_DEVICE_ID = "22222222-2222-2222-2222-222222222222";

  afterEach(() => {
    vi.mocked(assertPermission).mockReset();
    vi.mocked(prisma.smartDevice.findUnique).mockReset();
    vi.mocked(prisma.smartDevice.update)
      .mockReset()
      .mockResolvedValue({} as never);
    mockSetProviderDeviceEnabled.mockReset().mockResolvedValue({});
    mockRecordAudit.mockReset().mockResolvedValue({});
    vi.mocked(AugustClient).mockClear();
    mockListLocks.mockReset();
    mockGetLockDetail.mockReset();
  });

  function augustDevice(overrides: Record<string, unknown> = {}) {
    return {
      id: SMART_DEVICE_ID,
      provider: "AUGUST",
      metadata: { batteryLevel: 50, lockState: "locked" },
      providerDevice: null,
      ...overrides,
    };
  }

  it("retires an August SmartDevice for an authorized actor", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice() as never,
    );

    await retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID });

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "smart_devices:update",
    );
    expect(prisma.smartDevice.update).toHaveBeenCalledWith({
      where: { id: SMART_DEVICE_ID },
      data: {
        metadata: expect.objectContaining({
          batteryLevel: 50,
          lockState: "locked",
          retiredAt: expect.any(String),
        }),
      },
    });
  });

  it("propagates denial when the actor lacks smart_devices:update, without ever reading the device", async () => {
    vi.mocked(assertPermission).mockRejectedValueOnce(
      new Error("ForbiddenError"),
    );

    await expect(
      retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID }),
    ).rejects.toThrow();
    expect(prisma.smartDevice.findUnique).not.toHaveBeenCalled();
  });

  it("preserves every existing metadata key while adding a valid, parseable retiredAt", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice({
        metadata: {
          batteryLevel: 33,
          lockState: "unlocked",
          telemetryUpdatedAt: "2026-09-01T00:00:00.000Z",
        },
      }) as never,
    );

    await retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID });

    const call = vi.mocked(prisma.smartDevice.update).mock.calls[0]?.[0] as {
      data: { metadata: Record<string, unknown> };
    };
    expect(call.data.metadata.batteryLevel).toBe(33);
    expect(call.data.metadata.lockState).toBe("unlocked");
    expect(call.data.metadata.telemetryUpdatedAt).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    const retiredAt = call.data.metadata.retiredAt as string;
    expect(typeof retiredAt).toBe("string");
    expect(Number.isNaN(new Date(retiredAt).getTime())).toBe(false);
  });

  it("creates the dedicated smart_device.retired AuditLog entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice() as never,
    );

    await retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID });

    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "smart_device.retired",
        entityType: "SmartDevice",
        entityId: SMART_DEVICE_ID,
        actorUserId: actor.userId,
        actorType: "USER",
      }),
      expect.objectContaining({ smartDevice: expect.anything() }),
    );
  });

  it("throws a clear error for a missing device, without writing anything", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(null);

    await expect(
      retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID }),
    ).rejects.toThrow(/not found/i);
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("rejects a non-August device — this scope is August-only, per explicit instruction", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice({ provider: "CIELO" }) as never,
    );

    await expect(
      retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID }),
    ).rejects.toThrow(/August/);
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
  });

  it("rejects re-retiring a device that's already retired — never a silent double-write or a second audit entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice({
        metadata: { retiredAt: new Date().toISOString() },
      }) as never,
    );

    await expect(
      retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID }),
    ).rejects.toThrow(/already retired/i);
    expect(prisma.smartDevice.update).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("LEGACY DEVICE: retires an August SmartDevice with no ProviderDevice link at all — must not fail because that link doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice({ providerDevice: null }) as never,
    );

    const result = await retireSmartDevice(actor, {
      smartDeviceId: SMART_DEVICE_ID,
    });

    expect(result).toBeDefined();
    expect(mockSetProviderDeviceEnabled).not.toHaveBeenCalled();
    expect(prisma.smartDevice.update).toHaveBeenCalled();
  });

  it("PROVIDERDEVICE-BACKED: reuses the existing, already-tested setProviderDeviceEnabled(enabled:false) when a real, currently-enabled ProviderDevice link exists — never a competing/duplicated disable implementation", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice({
        providerDevice: { id: PROVIDER_DEVICE_ID, enabled: true },
      }) as never,
    );

    await retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID });

    expect(mockSetProviderDeviceEnabled).toHaveBeenCalledWith(actor, {
      providerDeviceId: PROVIDER_DEVICE_ID,
      enabled: false,
    });
  });

  it("does not call setProviderDeviceEnabled again when the ProviderDevice is already disabled — avoids a redundant provider_device.disabled audit entry", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice({
        providerDevice: { id: PROVIDER_DEVICE_ID, enabled: false },
      }) as never,
    );

    await retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID });

    expect(mockSetProviderDeviceEnabled).not.toHaveBeenCalled();
  });

  it("never calls August's real API and never deletes anything — a pure database write, no provider/physical command reachable", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
      augustDevice({
        providerDevice: { id: PROVIDER_DEVICE_ID, enabled: true },
      }) as never,
    );

    await retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID });

    expect(AugustClient).not.toHaveBeenCalled();
    expect(mockListLocks).not.toHaveBeenCalled();
    expect(mockGetLockDetail).not.toHaveBeenCalled();
    expect(
      (prisma.smartDevice as unknown as Record<string, unknown>).delete,
    ).toBeUndefined();
  });

  describe("ATOMICITY — the metadata write and its own smart_device.retired audit commit or fail together", () => {
    it("rejects, and never resolves with a device, if the transaction's SmartDevice.metadata write fails — proves a DB failure never surfaces as a false success", async () => {
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        augustDevice({ providerDevice: null }) as never,
      );
      smartDeviceUpdateMock.mockRejectedValueOnce(
        new Error("simulated DB failure during retirement"),
      );

      await expect(
        retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID }),
      ).rejects.toThrow(/simulated DB failure/i);

      // The update failed before the audit step ever ran inside the same
      // transaction callback — no misleading "retired, but no audit record"
      // state was ever observable outside this function.
      expect(mockRecordAudit).not.toHaveBeenCalled();
    });

    it("rejects, and never resolves with a device, if the transaction's own smart_device.retired audit write fails — proves the metadata write can never be reported as committed without its audit entry", async () => {
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        augustDevice({ providerDevice: null }) as never,
      );
      mockRecordAudit.mockRejectedValueOnce(
        new Error("simulated audit write failure during retirement"),
      );

      await expect(
        retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID }),
      ).rejects.toThrow(/simulated audit write failure/i);
    });
  });

  describe("SELF-HEALING RETRY — a partial failure after setProviderDeviceEnabled(false) succeeds is recoverable by simply calling retireSmartDevice() again", () => {
    it("first attempt: ProviderDevice gets disabled, then the atomic metadata+audit step fails, so the overall call rejects", async () => {
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        augustDevice({
          providerDevice: { id: PROVIDER_DEVICE_ID, enabled: true },
        }) as never,
      );
      smartDeviceUpdateMock.mockRejectedValueOnce(
        new Error("simulated failure right after ProviderDevice was disabled"),
      );

      await expect(
        retireSmartDevice(actor, { smartDeviceId: SMART_DEVICE_ID }),
      ).rejects.toThrow(/simulated failure right after/i);

      expect(mockSetProviderDeviceEnabled).toHaveBeenCalledWith(actor, {
        providerDeviceId: PROVIDER_DEVICE_ID,
        enabled: false,
      });
    });

    it("retry: with the ProviderDevice now already disabled (the real-world state left behind by the first attempt), the retry skips setProviderDeviceEnabled entirely and completes successfully", async () => {
      vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
      vi.mocked(prisma.smartDevice.findUnique).mockResolvedValueOnce(
        augustDevice({
          providerDevice: { id: PROVIDER_DEVICE_ID, enabled: false },
        }) as never,
      );

      const result = await retireSmartDevice(actor, {
        smartDeviceId: SMART_DEVICE_ID,
      });

      expect(result).toBeDefined();
      expect(mockSetProviderDeviceEnabled).not.toHaveBeenCalled();
      expect(mockRecordAudit).toHaveBeenCalledWith(
        expect.objectContaining({ action: "smart_device.retired" }),
        expect.objectContaining({ smartDevice: expect.anything() }),
      );
    });
  });
});
