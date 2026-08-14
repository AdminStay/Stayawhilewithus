import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Same reasoning as august-sync.e2e.test.ts: nothing above the HTTP layer
 * is mocked — the real CieloClient and the real syncCieloDevices both run
 * unmodified, proving the raw Cielo API response shape (verified against
 * bodyscape/cielo_home's source — see packages/integrations/src/cielo/README.md)
 * actually flows correctly into a SmartDevice upsert, not just that each
 * layer passes its own isolated unit tests.
 */

const mockRequest = vi.fn();

vi.mock("@stayw/integrations/core", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@stayw/integrations/core")>();
  return {
    ...actual,
    HttpClient: class MockHttpClient {
      request = mockRequest;
    },
  };
});

vi.mock("@stayw/database", () => ({
  prisma: {
    smartDevice: {
      upsert: vi.fn().mockResolvedValue({}),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  },
}));

vi.mock("@stayw/auth", () => ({
  assertPermission: vi.fn().mockResolvedValue(undefined),
}));

import { prisma } from "@stayw/database";

import { syncCieloDevices } from "./smart-devices.service";

const actor = { userId: "user-1" };

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

const LOGIN_SUCCESS = {
  status: 200,
  message: "SUCCESS",
  data: { user: { accessToken: "access-1", userId: "user-1" } },
};

describe("Cielo end-to-end: raw API response -> CieloClient -> syncCieloDevices -> SmartDevice upsert", () => {
  it("normalizes an online thermostat correctly through every layer", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "aa:bb:cc": "property-ridge",
    });

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS); // login
    mockRequest.mockResolvedValueOnce({
      status: 200,
      message: "SUCCESS",
      data: {
        listDevices: [
          {
            deviceName: "Living Room",
            macAddress: "aa:bb:cc",
            deviceStatus: 1,
          },
        ],
      },
    });

    const result = await syncCieloDevices(actor);

    expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalDeviceId: {
            provider: "CIELO",
            externalDeviceId: "aa:bb:cc",
          },
        },
        create: expect.objectContaining({
          provider: "CIELO",
          deviceType: "THERMOSTAT",
          externalDeviceId: "aa:bb:cc",
          propertyId: "property-ridge",
          name: "Living Room",
          status: "ONLINE",
          metadata: {},
        }),
      }),
    );
  });

  it("normalizes an offline thermostat (deviceStatus 0) correctly through every layer", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "dd:ee:ff": "property-loft",
    });

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce({
      status: 200,
      message: "SUCCESS",
      data: {
        listDevices: [
          { deviceName: "Main", macAddress: "dd:ee:ff", deviceStatus: 0 },
        ],
      },
    });

    await syncCieloDevices(actor);

    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          externalDeviceId: "dd:ee:ff",
          status: "OFFLINE",
          lastSeenAt: null,
        }),
      }),
    );
  });

  it("skips a device whose MAC address isn't in CIELO_PROPERTY_MAP", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "hunter2";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({
      "known:mac": "property-ridge",
    });

    mockRequest.mockResolvedValueOnce(LOGIN_SUCCESS);
    mockRequest.mockResolvedValueOnce({
      status: 200,
      message: "SUCCESS",
      data: {
        listDevices: [
          { deviceName: "Unknown", macAddress: "unknown:mac", deviceStatus: 1 },
        ],
      },
    });

    const result = await syncCieloDevices(actor);

    expect(result).toEqual({ synced: 0, skippedExternalIds: ["unknown:mac"] });
    expect(prisma.smartDevice.upsert).not.toHaveBeenCalled();
  });

  it("propagates a login failure (e.g. bad credentials) as a real error, not a silent empty sync", async () => {
    process.env.CIELO_USERNAME = "owner@example.com";
    process.env.CIELO_PASSWORD = "wrong-password";
    process.env.CIELO_PROPERTY_MAP = JSON.stringify({});

    mockRequest.mockResolvedValueOnce({
      status: 401,
      message: "Invalid credentials",
    });

    await expect(syncCieloDevices(actor)).rejects.toThrow(
      /Invalid credentials/,
    );
    expect(prisma.smartDevice.upsert).not.toHaveBeenCalled();
  });
});
