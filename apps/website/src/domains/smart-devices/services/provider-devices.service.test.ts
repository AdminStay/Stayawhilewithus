import { describe, expect, it, vi } from "vitest";

// vi.mock factories are hoisted above every top-level statement (including
// plain `const`), so any value a factory dereferences directly (not inside
// a not-yet-invoked closure) must go through vi.hoisted() to exist in time.
const {
  mockTransaction,
  mockListDevices,
  mockEnsureConnectionRows,
  mockRecordAudit,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockListDevices: vi.fn(),
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

vi.mock("@/domains/integrations/services/integrations.service", () => ({
  ensureConnectionRows: mockEnsureConnectionRows,
}));

vi.mock("@/platform/audit/record-audit", () => ({
  recordAudit: mockRecordAudit,
}));

import { assertPermission } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  discoverNestDevices,
  listDiscoveredDevices,
  mapProviderDeviceToProperty,
  setProviderDeviceEnabled,
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
      integrationConnection: { provider: "NEST" },
    } as never);

    const mockUpsert = vi.fn().mockResolvedValue({ id: "sd-1" });
    const mockUpdate = vi
      .fn()
      .mockResolvedValue({
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
    expect(mockUpdate).toHaveBeenCalledWith({
      where: { id: "11111111-1111-1111-1111-111111111111" },
      data: { enabled: true, smartDeviceId: "sd-1" },
    });
    expect(mockRecordAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "provider_device.enabled" }),
    );
  });

  it("disabling only flips the flag — never touches the SmartDevice row", async () => {
    vi.mocked(assertPermission).mockResolvedValueOnce(undefined);
    vi.mocked(prisma.providerDevice.findUniqueOrThrow).mockResolvedValueOnce({
      id: "11111111-1111-1111-1111-111111111111",
      propertyId: "22222222-2222-2222-2222-222222222222",
      integrationConnection: { provider: "NEST" },
    } as never);

    const mockUpdate = vi
      .fn()
      .mockResolvedValue({
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
