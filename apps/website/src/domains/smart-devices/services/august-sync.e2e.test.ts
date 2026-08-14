import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Unlike smart-devices.service.test.ts (which mocks AugustClient entirely,
 * to unit-test syncAugustDevices' own upsert/skip/prune logic in
 * isolation), this file mocks nothing above the HTTP layer: the real
 * AugustClient (packages/integrations/src/august/client.ts) and the real
 * syncAugustDevices (./smart-devices.service.ts) both run unmodified. Only
 * @stayw/integrations/core's HttpClient — the actual network boundary — is
 * replaced, with a raw August API response shape exactly as documented in
 * packages/integrations/src/august/README.md. This is the test that proves
 * "August API response -> integration client -> database service" is
 * actually wired together correctly, not just that each layer passes its
 * own isolated unit tests.
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

import { syncAugustDevices } from "./smart-devices.service";

const actor = { userId: "user-1" };

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

function setConfigured(propertyMap: Record<string, string>) {
  process.env.AUGUST_IDENTIFIER = "email:test@example.com";
  process.env.AUGUST_INSTALL_ID = "install-1";
  process.env.AUGUST_ACCESS_TOKEN = "token-1";
  process.env.AUGUST_PROPERTY_MAP = JSON.stringify(propertyMap);
}

describe("August end-to-end: raw API response -> AugustClient -> syncAugustDevices -> SmartDevice upsert", () => {
  it("normalizes an online, healthy-battery lock correctly through every layer", async () => {
    setConfigured({ "house-1": "property-ridge" });
    // GET /users/locks/mine
    mockRequest.mockResolvedValueOnce({
      "lock-front": { LockName: "Front Door", HouseID: "house-1" },
    });
    // GET /locks/lock-front — raw shape verified against py-august's LockDetail.
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-front",
      LockName: "Front Door",
      HouseID: "house-1",
      battery: 0.85,
      Bridge: { operative: true, status: { current: "online" } },
    });

    const result = await syncAugustDevices(actor);

    expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider_externalDeviceId: {
            provider: "AUGUST",
            externalDeviceId: "lock-front",
          },
        },
        create: expect.objectContaining({
          provider: "AUGUST",
          deviceType: "LOCK",
          externalDeviceId: "lock-front",
          propertyId: "property-ridge",
          name: "Front Door",
          status: "ONLINE",
          metadata: { batteryLevel: 85 },
        }),
      }),
    );
  });

  it("normalizes an offline, low-battery lock — the combined 'Offline + low battery' dashboard case — correctly through every layer", async () => {
    setConfigured({ "house-1": "property-loft" });
    mockRequest.mockResolvedValueOnce({
      "lock-side": { LockName: "Side Door", HouseID: "house-1" },
    });
    mockRequest.mockResolvedValueOnce({
      LockID: "lock-side",
      LockName: "Side Door",
      HouseID: "house-1",
      battery: 0.08,
      Bridge: { operative: false },
    });

    const result = await syncAugustDevices(actor);

    expect(result).toEqual({ synced: 1, skippedExternalIds: [] });
    expect(prisma.smartDevice.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          externalDeviceId: "lock-side",
          propertyId: "property-loft",
          status: "OFFLINE",
          metadata: { batteryLevel: 8 },
          lastSeenAt: null,
        }),
      }),
    );
  });

  it("skips a lock whose house isn't in AUGUST_PROPERTY_MAP without ever calling the per-lock detail endpoint", async () => {
    setConfigured({ "house-known": "property-ridge" });
    mockRequest.mockResolvedValueOnce({
      "lock-unmapped": { LockName: "Garage", HouseID: "house-other" },
    });

    const result = await syncAugustDevices(actor);

    expect(result).toEqual({
      synced: 0,
      skippedExternalIds: ["lock-unmapped"],
    });
    // Only the /users/locks/mine call happened — no /locks/{id} call for a
    // lock we can't map to a property.
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(prisma.smartDevice.upsert).not.toHaveBeenCalled();
  });
});
