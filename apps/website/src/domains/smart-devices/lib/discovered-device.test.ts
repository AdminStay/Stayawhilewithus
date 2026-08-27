import { describe, expect, it } from "vitest";

import { getAugustHouseId, type DiscoveredDevice } from "./discovered-device";

function makeDevice(
  overrides: Partial<DiscoveredDevice> = {},
): DiscoveredDevice {
  return {
    id: "device-1",
    integrationConnectionId: "conn-1",
    externalDeviceId: "ext-1",
    deviceType: "LOCK",
    discoveredName: "Front Door",
    connectivityStatus: "ONLINE",
    rawMetadata: {},
    firstDiscoveredAt: new Date("2026-01-01"),
    lastSeenAt: new Date("2026-01-01"),
    propertyId: null,
    enabled: false,
    mappedAt: null,
    mappedByUserId: null,
    smartDeviceId: null,
    property: null,
    integrationConnection: { provider: "AUGUST" },
    ...overrides,
  } as unknown as DiscoveredDevice;
}

describe("getAugustHouseId", () => {
  it("returns the houseId string for an AUGUST device", () => {
    expect(
      getAugustHouseId(makeDevice({ rawMetadata: { houseId: "house-1" } })),
    ).toBe("house-1");
  });

  it("returns null for a non-AUGUST device even if rawMetadata has a houseId-shaped field", () => {
    expect(
      getAugustHouseId(
        makeDevice({
          integrationConnection: { provider: "NEST" },
          rawMetadata: { houseId: "house-1" },
        }),
      ),
    ).toBeNull();
  });

  it("returns null when rawMetadata has no houseId at all", () => {
    expect(getAugustHouseId(makeDevice({ rawMetadata: {} }))).toBeNull();
  });

  it("returns null rather than a non-string value", () => {
    expect(
      getAugustHouseId(makeDevice({ rawMetadata: { houseId: 12345 } })),
    ).toBeNull();
  });

  it("returns null when rawMetadata itself is null", () => {
    expect(getAugustHouseId(makeDevice({ rawMetadata: null }))).toBeNull();
  });
});
