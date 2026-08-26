import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above every top-level statement (including
// plain `const`), so any value a factory dereferences directly (not inside
// a not-yet-invoked closure) must go through vi.hoisted() to exist in time.
const {
  mockTransaction,
  mockListDevices,
  mockListLocks,
  mockGetLockDetail,
  mockEnsureConnectionRows,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockListDevices: vi.fn(),
  mockListLocks: vi.fn(),
  mockGetLockDetail: vi.fn(),
  mockEnsureConnectionRows: vi.fn().mockResolvedValue(undefined),
  mockRecordAudit: vi.fn().mockResolvedValue({}),
}));

vi.mock("@stayw/database", () => ({
  prisma: {
    providerDevice: {
      findMany: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn().mockResolvedValue({}),
      update: vi.fn(),
    },
    property: {
      findUnique: vi.fn(),
    },
    integrationConnection: {
      findUniqueOrThrow: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
    },
    smartDevice: {
      upsert: vi.fn(),
    },
    $transaction: mockTransaction,
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn(),
}));

vi.mock("@stayw/integrations/nest", () => ({
  NestClient: vi.fn().mockImplementation(() => ({
    listDevices: mockListDevices,
  })),
}));

vi.mock("@stayw/integrations/august", () => ({
  AugustClient: vi.fn().mockImplementation(() => ({
    listLocks: mockListLocks,
    getLockDetail: mockGetLockDetail,
  })),
  isAugustBrand: vi.fn().mockReturnValue(true),
}));

vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: mockEnsureConnectionRows,
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  discoverAugustDevices,
  discoverNestDevices,
  listDiscoveredDevices,
  mapProviderDeviceToProperty,
  setProviderDeviceEnabled,
  toAugustSmartDeviceMetadata,
  unmapProviderDevice,
} from "./provider-devices.service";

const actor = { userId: "user-1" };
const ORIGINAL_ENV = { ...process.env };

function withNestEnv() {
  process.env.NEST_CLIENT_ID = "client-id";
  process.env.NEST_CLIENT_SECRET = "client-secret";
  process.env.NEST_PROJECT_ID = "project-id";
  process.env.NEST_REFRESH_TOKEN = "refresh-token";
}

function withAugustEnv() {
  process.env.AUGUST_IDENTIFIER = "email:test@example.com";
  process.env.AUGUST_INSTALL_ID = "install-1";
  process.env.AUGUST_ACCESS_TOKEN = "token-1";
}

function restoreEnv() {
  process.env = { ...ORIGINAL_ENV };
}

describe("discoverNestDevices", () => {
  it("throws a clear error when Nest credentials aren't configured, without calling the provider", async () => {
    restoreEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(discoverNestDevices(actor)).rejects.toThrow(
      /isn't configured/,
    );
    expect(mockListDevices).not.toHaveBeenCalled();
  });

  it("upserts every discovered device into ProviderDevice, keyed on [connection, externalDeviceId], and never sets propertyId/enabled/mappedAt", async () => {
    withNestEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "NEST",
    } as never);
    mockListDevices.mockResolvedValueOnce([
      {
        externalDeviceId: "d1",
        customName: "Living Room",
        connectivity: "ONLINE",
      },
      { externalDeviceId: "d2", connectivity: "OFFLINE" },
    ]);

    const result = await discoverNestDevices(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "smart_devices:update",
    );
    expect(mockEnsureConnectionRows).toHaveBeenCalled();
    expect(prisma.providerDevice.upsert).toHaveBeenCalledTimes(2);

    const firstCall = vi.mocked(prisma.providerDevice.upsert).mock.calls[0]![0];
    expect(firstCall.where).toEqual({
      integrationConnectionId_externalDeviceId: {
        integrationConnectionId: "connection-1",
        externalDeviceId: "d1",
      },
    });
    expect(firstCall.create).not.toHaveProperty("propertyId");
    expect(firstCall.create).not.toHaveProperty("enabled");
    expect(firstCall.create).not.toHaveProperty("mappedAt");
    expect(firstCall.create).not.toHaveProperty("mappedByUserId");
    expect(firstCall.update).not.toHaveProperty("propertyId");
    expect(firstCall.update).not.toHaveProperty("enabled");

    expect(result).toEqual({ discovered: 2 });
  });

  it("falls back to UNKNOWN connectivity when the device doesn't report Connectivity at all", async () => {
    withNestEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "NEST",
    } as never);
    mockListDevices.mockResolvedValueOnce([{ externalDeviceId: "d3" }]);

    await discoverNestDevices(actor);

    const call = vi.mocked(prisma.providerDevice.upsert).mock.calls[0]![0];
    expect(call.create.connectivityStatus).toBe("UNKNOWN");
  });
});

describe("discoverAugustDevices", () => {
  beforeEach(() => {
    // Real Prisma's $transaction (both the batched-array form this function
    // uses, and the interactive-callback form other functions in this file
    // use) actually runs what it's given — mirror that here so assertions
    // can rely on results/rejections propagating, instead of the bare
    // vi.fn() default of returning undefined. describe blocks below that
    // need the interactive-callback form override this per-test via
    // mockImplementationOnce, which takes precedence over this default.
    mockTransaction.mockImplementation(async (arg) =>
      Array.isArray(arg) ? Promise.all(arg) : arg,
    );
  });

  afterEach(() => {
    restoreEnv();
  });

  function baseLock(id: string, name = "Front Door", houseId = "house-1") {
    return { id, name, houseId };
  }

  function detailFor(
    lock: { id: string; name: string; houseId: string },
    overrides: Partial<{
      batteryLevel: number | null;
      connectivity: string;
      lockState: string | null;
    }> = {},
  ) {
    return {
      id: lock.id,
      name: lock.name,
      houseId: lock.houseId,
      batteryLevel: 92,
      connectivity: "ONLINE",
      lockState: "locked",
      telemetryUpdatedAt: "2026-08-26T00:00:00.000Z",
      seenAt: "2026-08-26T00:00:00.000Z",
      ...overrides,
    };
  }

  it("throws a clear error when August credentials aren't configured, without calling the provider", async () => {
    restoreEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);

    await expect(discoverAugustDevices(actor)).rejects.toThrow(
      /isn't configured/,
    );
    expect(mockListLocks).not.toHaveBeenCalled();
  });

  it("Phase 1: persists the complete base inventory (id/name/houseId) from a single listLocks() call via one batched upsert, before any detail call resolves", async () => {
    withAugustEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "AUGUST",
    } as never);
    const lock = baseLock("lock-1", "Front Door", "house-1");
    mockListLocks.mockResolvedValueOnce([lock]);
    mockGetLockDetail.mockResolvedValueOnce(detailFor(lock));

    const result = await discoverAugustDevices(actor);

    expect(assertPermission).toHaveBeenCalledWith(
      actor,
      "smart_devices:update",
    );
    expect(mockEnsureConnectionRows).toHaveBeenCalled();
    expect(mockListLocks).toHaveBeenCalledTimes(1);
    expect(prisma.providerDevice.upsert).toHaveBeenCalledTimes(1);

    const call = vi.mocked(prisma.providerDevice.upsert).mock.calls[0]![0];
    expect(call.where).toEqual({
      integrationConnectionId_externalDeviceId: {
        integrationConnectionId: "connection-1",
        externalDeviceId: "lock-1",
      },
    });
    expect(call.create.deviceType).toBe("LOCK");
    expect(call.create.discoveredName).toBe("Front Door");
    // Phase 1 never has detail data yet — it must not fabricate a
    // connectivity value, and it must never depend on getLockDetail()
    // having already resolved.
    expect(call.create.connectivityStatus).toBe("UNKNOWN");
    expect(call.create).not.toHaveProperty("propertyId");
    expect(call.create).not.toHaveProperty("enabled");
    expect(call.create).not.toHaveProperty("mappedAt");
    expect(call.create).not.toHaveProperty("mappedByUserId");
    expect(call.update).not.toHaveProperty("propertyId");
    expect(call.update).not.toHaveProperty("enabled");

    // Phase 2 enrichment succeeded here, so the final result reports it —
    // but via prisma.providerDevice.update, never a second upsert call.
    expect(prisma.providerDevice.update).toHaveBeenCalledTimes(1);
    const updateCall = vi.mocked(prisma.providerDevice.update).mock
      .calls[0]![0];
    expect(updateCall.data.connectivityStatus).toBe("ONLINE");
    expect(updateCall.data).not.toHaveProperty("propertyId");
    expect(updateCall.data).not.toHaveProperty("enabled");

    expect(result).toEqual({ discovered: 1, enriched: 1, detailFailures: 0 });
  });

  it("persists the base inventory even when every detail request fails — discovery itself never fails because enrichment failed", async () => {
    withAugustEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "AUGUST",
    } as never);
    const lock = baseLock("lock-1");
    mockListLocks.mockResolvedValueOnce([lock]);
    mockGetLockDetail.mockRejectedValueOnce(new Error("August API 500"));

    const result = await discoverAugustDevices(actor);

    expect(prisma.providerDevice.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.providerDevice.update).not.toHaveBeenCalled();
    expect(result).toEqual({ discovered: 1, enriched: 0, detailFailures: 1 });
  });

  it("one failed detail request doesn't fail discovery of the other locks in the same batch", async () => {
    withAugustEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "AUGUST",
    } as never);
    const locks = [
      baseLock("lock-1", "Front Door"),
      baseLock("lock-2", "Back Door"),
      baseLock("lock-3", "Garage"),
    ];
    mockListLocks.mockResolvedValueOnce(locks);
    mockGetLockDetail
      .mockResolvedValueOnce(detailFor(locks[0]!))
      .mockRejectedValueOnce(new Error("timed out"))
      .mockResolvedValueOnce(detailFor(locks[2]!));

    const result = await discoverAugustDevices(actor);

    expect(prisma.providerDevice.upsert).toHaveBeenCalledTimes(3);
    expect(prisma.providerDevice.update).toHaveBeenCalledTimes(2);
    const updatedIds = vi
      .mocked(prisma.providerDevice.update)
      .mock.calls.map(
        (call) =>
          call[0].where.integrationConnectionId_externalDeviceId!
            .externalDeviceId,
      );
    expect(updatedIds.sort()).toEqual(["lock-1", "lock-3"]);
    expect(result).toEqual({ discovered: 3, enriched: 2, detailFailures: 1 });
  });

  it("bounds detail-request concurrency instead of running all of them at once", async () => {
    withAugustEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "AUGUST",
    } as never);
    const locks = Array.from({ length: 12 }, (_, i) =>
      baseLock(`lock-${i}`, `Lock ${i}`),
    );
    mockListLocks.mockResolvedValueOnce(locks);

    let inFlight = 0;
    let maxInFlight = 0;
    mockGetLockDetail.mockImplementation(async (id: string) => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      return detailFor(baseLock(id));
    });

    const result = await discoverAugustDevices(actor);

    expect(mockGetLockDetail).toHaveBeenCalledTimes(12);
    // The implementation's own concurrency cap (AUGUST_DETAIL_CONCURRENCY)
    // is 5 — this asserts real bounding happened, not just "less than 12".
    expect(maxInFlight).toBeLessThanOrEqual(5);
    expect(maxInFlight).toBeGreaterThan(1);
    expect(result).toEqual({
      discovered: 12,
      enriched: 12,
      detailFailures: 0,
    });
  });

  it("persists two locks that share the same houseId as two independent ProviderDevice rows, each separately identified by its own lock id", async () => {
    withAugustEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "AUGUST",
    } as never);
    const locks = [
      baseLock("lock-front", "Island Tides - Front Door", "house-shared"),
      baseLock("lock-man-cave", "Island Tides - Man Cave", "house-shared"),
    ];
    mockListLocks.mockResolvedValueOnce(locks);
    mockGetLockDetail
      .mockResolvedValueOnce(
        detailFor(locks[0]!, { batteryLevel: 92, connectivity: "UNKNOWN" }),
      )
      .mockResolvedValueOnce(
        detailFor(locks[1]!, { batteryLevel: 59, connectivity: "UNKNOWN" }),
      );

    const result = await discoverAugustDevices(actor);

    expect(prisma.providerDevice.upsert).toHaveBeenCalledTimes(2);
    const firstKey = vi.mocked(prisma.providerDevice.upsert).mock.calls[0]![0]
      .where.integrationConnectionId_externalDeviceId!;
    const secondKey = vi.mocked(prisma.providerDevice.upsert).mock.calls[1]![0]
      .where.integrationConnectionId_externalDeviceId!;
    expect(firstKey.externalDeviceId).toBe("lock-front");
    expect(secondKey.externalDeviceId).toBe("lock-man-cave");
    expect(firstKey.externalDeviceId).not.toBe(secondKey.externalDeviceId);
    expect(result).toEqual({ discovered: 2, enriched: 2, detailFailures: 0 });
  });

  it("calling upsert/update again for an already-discovered lock stays idempotent — same key, no duplicate rows implied", async () => {
    withAugustEnv();
    vi.mocked(assertPermission)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    vi.mocked(prisma.integrationConnection.findUniqueOrThrow).mockResolvedValue(
      {
        id: "connection-1",
        provider: "AUGUST",
      } as never,
    );
    const lock = baseLock("lock-1");
    mockListLocks.mockResolvedValueOnce([lock]).mockResolvedValueOnce([lock]);
    mockGetLockDetail
      .mockResolvedValueOnce(detailFor(lock))
      .mockResolvedValueOnce(detailFor(lock));

    await discoverAugustDevices(actor);
    await discoverAugustDevices(actor);

    expect(prisma.providerDevice.upsert).toHaveBeenCalledTimes(2);
    const [firstCallArgs, secondCallArgs] = vi.mocked(
      prisma.providerDevice.upsert,
    ).mock.calls;
    expect(firstCallArgs![0].where).toEqual(secondCallArgs![0].where);
  });

  it("never sets propertyId/enabled on the discovered lock regardless of enrichment outcome — no automatic mapping", async () => {
    withAugustEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "AUGUST",
    } as never);
    const locks = [baseLock("lock-ok"), baseLock("lock-fail")];
    mockListLocks.mockResolvedValueOnce(locks);
    mockGetLockDetail
      .mockResolvedValueOnce(detailFor(locks[0]!))
      .mockRejectedValueOnce(new Error("nope"));

    await discoverAugustDevices(actor);

    for (const call of vi.mocked(prisma.providerDevice.upsert).mock.calls) {
      expect(call[0].create).not.toHaveProperty("propertyId");
      expect(call[0].create).not.toHaveProperty("enabled");
    }
    for (const call of vi.mocked(prisma.providerDevice.update).mock.calls) {
      expect(call[0].data).not.toHaveProperty("propertyId");
      expect(call[0].data).not.toHaveProperty("enabled");
    }
  });

  it("does not create any SmartDevice row — discovery only ever writes ProviderDevice", async () => {
    withAugustEnv();
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(
      prisma.integrationConnection.findUniqueOrThrow,
    ).mockResolvedValueOnce({
      id: "connection-1",
      provider: "AUGUST",
    } as never);
    const lock = baseLock("lock-1");
    mockListLocks.mockResolvedValueOnce([lock]);
    mockGetLockDetail.mockResolvedValueOnce(
      detailFor(lock, { connectivity: "UNKNOWN", lockState: null }),
    );

    await discoverAugustDevices(actor);

    expect(prisma.smartDevice.upsert).not.toHaveBeenCalled();
  });
});

describe("toAugustSmartDeviceMetadata", () => {
  it("includes only the fields the provider actually reported", () => {
    const observedAt = new Date("2026-08-26T12:00:00.000Z");
    const metadata = toAugustSmartDeviceMetadata(
      {
        id: "lock-1",
        name: "Front Door",
        houseId: "house-1",
        batteryLevel: 92,
        connectivity: "ONLINE",
        lockState: "locked",
        telemetryUpdatedAt: "2026-08-20T00:00:00.000Z",
        seenAt: "2026-08-20T00:00:00.000Z",
      },
      observedAt,
    );

    expect(metadata).toEqual({
      batteryLevel: 92,
      lockState: "locked",
      telemetryUpdatedAt: "2026-08-26T12:00:00.000Z",
    });
  });

  it("never fabricates batteryLevel/lockState when the provider didn't report them (already null-normalized upstream by AugustClient)", () => {
    const observedAt = new Date("2026-08-26T12:00:00.000Z");
    const metadata = toAugustSmartDeviceMetadata(
      {
        id: "lock-1",
        name: "Front Door",
        houseId: "house-1",
        batteryLevel: null,
        connectivity: "UNKNOWN",
        lockState: null,
        telemetryUpdatedAt: null,
        seenAt: null,
      },
      observedAt,
    );

    expect(metadata).toEqual({
      telemetryUpdatedAt: "2026-08-26T12:00:00.000Z",
    });
  });
});

describe("listDiscoveredDevices", () => {
  it("requires smart_devices:read and includes property/connection/mappedByUser", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.providerDevice.findMany).mockResolvedValueOnce(
      [] as never,
    );

    await listDiscoveredDevices(actor);

    expect(assertPermission).toHaveBeenCalledWith(actor, "smart_devices:read");
    expect(prisma.providerDevice.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        include: {
          property: true,
          integrationConnection: true,
          mappedByUser: true,
        },
      }),
    );
  });
});

describe("mapProviderDeviceToProperty", () => {
  it("rejects mapping to a property that doesn't exist", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce(null);

    await expect(
      mapProviderDeviceToProperty(actor, {
        providerDeviceId: "11111111-1111-1111-1111-111111111111",
        propertyId: "33333333-3333-3333-3333-333333333333",
      }),
    ).rejects.toThrow(/Property not found/);
  });

  it("rejects mapping to a soft-deleted property", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce({
      id: "22222222-2222-2222-2222-222222222222",
      deletedAt: new Date(),
    } as never);

    await expect(
      mapProviderDeviceToProperty(actor, {
        providerDeviceId: "11111111-1111-1111-1111-111111111111",
        propertyId: "22222222-2222-2222-2222-222222222222",
      }),
    ).rejects.toThrow(/Property not found/);
  });

  it("sets propertyId/mappedAt/mappedByUserId explicitly and records an audit entry — never auto-enables", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.property.findUnique).mockResolvedValueOnce({
      id: "22222222-2222-2222-2222-222222222222",
      deletedAt: null,
    } as never);
    vi.mocked(prisma.providerDevice.update).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      propertyId: "22222222-2222-2222-2222-222222222222",
    } as never);

    await mapProviderDeviceToProperty(actor, {
      providerDeviceId: "11111111-1111-1111-1111-111111111111",
      propertyId: "22222222-2222-2222-2222-222222222222",
    });

    const call = vi.mocked(prisma.providerDevice.update).mock.calls[0]![0];
    expect(call.data.propertyId).toBe("22222222-2222-2222-2222-222222222222");
    expect(call.data.mappedByUserId).toBe("user-1");
    expect(call.data).not.toHaveProperty("enabled");
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "provider_device.mapped" }),
    );
  });
});

describe("unmapProviderDevice", () => {
  it("clears mapping/enabled/smartDeviceId but never deletes the underlying SmartDevice row", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.providerDevice.update).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
    } as never);

    await unmapProviderDevice(actor, {
      providerDeviceId: "11111111-1111-1111-1111-111111111111",
    });

    const call = vi.mocked(prisma.providerDevice.update).mock.calls[0]![0];
    expect(call.data).toEqual({
      propertyId: null,
      enabled: false,
      mappedAt: null,
      mappedByUserId: null,
      smartDeviceId: null,
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "provider_device.unmapped" }),
    );
  });
});

describe("setProviderDeviceEnabled", () => {
  it("rejects enabling a device that isn't mapped to a property yet", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.providerDevice.findUniqueOrThrow).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      propertyId: null,
      integrationConnection: { provider: "NEST" },
    } as never);

    await expect(
      setProviderDeviceEnabled(actor, {
        providerDeviceId: "11111111-1111-1111-1111-111111111111",
        enabled: true,
      }),
    ).rejects.toThrow(/Map this device to a property/);
    expect(mockTransaction).not.toHaveBeenCalled();
  });

  it("upserts a real SmartDevice row keyed on [provider, externalDeviceId] when enabling a mapped device", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.providerDevice.findUniqueOrThrow).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      propertyId: "22222222-2222-2222-2222-222222222222",
      externalDeviceId: "d1",
      discoveredName: "Living Room",
      connectivityStatus: "ONLINE",
      deviceType: "THERMOSTAT",
      rawMetadata: { ambientTemperatureCelsius: 21 },
      // Deliberately far in the past relative to "now" at test-run time —
      // this is what proves the regression test below is real: if Enable
      // ever regresses to stamping Date.now() again, this old value would
      // be silently ignored and the assertion would fail.
      lastSeenAt: new Date("2026-08-20T12:00:00.000Z"),
      integrationConnection: { provider: "NEST" },
    } as never);

    const mockUpsert = vi.fn().mockResolvedValue({ id: "sd-1" });
    const mockUpdate = vi.fn().mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      enabled: true,
    });
    mockTransaction.mockImplementationOnce(async (fn) =>
      fn({
        smartDevice: { upsert: mockUpsert },
        providerDevice: { update: mockUpdate },
      }),
    );

    await setProviderDeviceEnabled(actor, {
      providerDeviceId: "11111111-1111-1111-1111-111111111111",
      enabled: true,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalDeviceId: {
            provider: "NEST",
            externalDeviceId: "d1",
          },
        },
      }),
    );
    const upsertArgs = mockUpsert.mock.calls[0]![0];
    expect(upsertArgs.create.metadata.currentTemperature).toBeCloseTo(70, 0); // 21C -> ~70F
    // Regression test: enabling copies an existing discovery snapshot, it
    // never makes a fresh Nest read — telemetryUpdatedAt must reflect the
    // snapshot's own lastSeenAt, not the moment Enable happened to be
    // clicked. See toSmartDeviceMetadata()'s doc comment.
    expect(upsertArgs.create.metadata.telemetryUpdatedAt).toBe(
      "2026-08-20T12:00:00.000Z",
    );
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "11111111-1111-1111-1111-111111111111" },
      data: { enabled: true, smartDeviceId: "sd-1" },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "provider_device.enabled" }),
    );
  });

  it("upserts a real SmartDevice row for an AUGUST-provider device using the August (not Nest) metadata mapper", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.providerDevice.findUniqueOrThrow).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      propertyId: "22222222-2222-2222-2222-222222222222",
      externalDeviceId: "lock-1",
      discoveredName: "Front Door",
      connectivityStatus: "ONLINE",
      deviceType: "LOCK",
      rawMetadata: {
        id: "lock-1",
        name: "Front Door",
        houseId: "house-1",
        batteryLevel: 92,
        connectivity: "ONLINE",
        lockState: "locked",
        telemetryUpdatedAt: "2026-08-20T00:00:00.000Z",
        seenAt: "2026-08-20T00:00:00.000Z",
      },
      lastSeenAt: new Date("2026-08-20T12:00:00.000Z"),
      integrationConnection: { provider: "AUGUST" },
    } as never);

    const mockUpsert = vi.fn().mockResolvedValue({ id: "sd-lock-1" });
    const mockUpdate = vi.fn().mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      enabled: true,
    });
    mockTransaction.mockImplementationOnce(async (fn) =>
      fn({
        smartDevice: { upsert: mockUpsert },
        providerDevice: { update: mockUpdate },
      }),
    );

    await setProviderDeviceEnabled(actor, {
      providerDeviceId: "11111111-1111-1111-1111-111111111111",
      enabled: true,
    });

    expect(mockUpsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalDeviceId: {
            provider: "AUGUST",
            externalDeviceId: "lock-1",
          },
        },
      }),
    );
    const upsertArgs = mockUpsert.mock.calls[0]![0];
    // Proves the AUGUST branch, not the Nest one: lockState/batteryLevel
    // are August-only fields toSmartDeviceMetadata() (Nest) doesn't read at
    // all — this would be undefined/absent if the wrong mapper ran.
    expect(upsertArgs.create.metadata.batteryLevel).toBe(92);
    expect(upsertArgs.create.metadata.lockState).toBe("locked");
    expect(upsertArgs.create.metadata.telemetryUpdatedAt).toBe(
      "2026-08-20T12:00:00.000Z",
    );
    expect(upsertArgs.create.deviceType).toBe("LOCK");
  });

  it("disabling only flips the flag — never touches the SmartDevice row", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.providerDevice.findUniqueOrThrow).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      propertyId: "22222222-2222-2222-2222-222222222222",
      integrationConnection: { provider: "NEST" },
    } as never);

    const mockUpdate = vi.fn().mockResolvedValue({
      id: "11111111-1111-1111-1111-111111111111",
      enabled: false,
    });
    mockTransaction.mockImplementationOnce(async (fn) =>
      fn({
        smartDevice: { upsert: vi.fn() },
        providerDevice: { update: mockUpdate },
      }),
    );

    await setProviderDeviceEnabled(actor, {
      providerDeviceId: "11111111-1111-1111-1111-111111111111",
      enabled: false,
    });

    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "11111111-1111-1111-1111-111111111111" },
      data: { enabled: false },
    });
  });
});
