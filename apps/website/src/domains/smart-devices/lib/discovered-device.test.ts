import { describe, expect, it } from "vitest";

import {
  findSuggestedPropertyForHouseId,
  getAugustHouseId,
  type DiscoveredDevice,
} from "./discovered-device";

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

const PROPERTY_A = { id: "prop-a", name: "Aqua Palm", internalCode: "AP" };
const PROPERTY_B = { id: "prop-b", name: "Bonjour", internalCode: "BJ" };

describe("findSuggestedPropertyForHouseId — F, deterministic mapping assistance", () => {
  it("suggests the property when exactly one OTHER already-mapped AUGUST device shares the exact same houseId", () => {
    const devices = [
      makeDevice({
        id: "unmapped-1",
        rawMetadata: { houseId: "house-1" },
        propertyId: null,
        property: null,
      }),
      makeDevice({
        id: "mapped-1",
        rawMetadata: { houseId: "house-1" },
        propertyId: PROPERTY_A.id,
        property: PROPERTY_A,
      }),
    ];

    expect(findSuggestedPropertyForHouseId(devices, "house-1")).toEqual(
      PROPERTY_A,
    );
  });

  it("FAIL-CLOSED: no suggestion when houseId is null (missing)", () => {
    const devices = [
      makeDevice({
        id: "mapped-1",
        rawMetadata: { houseId: "house-1" },
        propertyId: PROPERTY_A.id,
        property: PROPERTY_A,
      }),
    ];

    expect(findSuggestedPropertyForHouseId(devices, null)).toBeNull();
  });

  it("FAIL-CLOSED: no suggestion when the target's own houseId is malformed — caller is expected to pass getAugustHouseId()'s own null result through unchanged, never a guessed value", () => {
    // A malformed/non-string houseId already normalizes to null via
    // getAugustHouseId() before ever reaching this function — this test
    // proves the function's own null-input contract, matching that.
    const devices = [
      makeDevice({
        id: "mapped-1",
        rawMetadata: { houseId: "house-1" },
        propertyId: PROPERTY_A.id,
        property: PROPERTY_A,
      }),
    ];

    expect(findSuggestedPropertyForHouseId(devices, null)).toBeNull();
  });

  it("FAIL-CLOSED: no suggestion when no other device shares the exact same houseId", () => {
    const devices = [
      makeDevice({
        id: "mapped-1",
        rawMetadata: { houseId: "house-999" },
        propertyId: PROPERTY_A.id,
        property: PROPERTY_A,
      }),
    ];

    expect(findSuggestedPropertyForHouseId(devices, "house-1")).toBeNull();
  });

  it("FAIL-CLOSED / AMBIGUOUS: no suggestion when the same houseId is mapped to two different properties — never guesses which one is right", () => {
    const devices = [
      makeDevice({
        id: "mapped-1",
        rawMetadata: { houseId: "house-1" },
        propertyId: PROPERTY_A.id,
        property: PROPERTY_A,
      }),
      makeDevice({
        id: "mapped-2",
        rawMetadata: { houseId: "house-1" },
        propertyId: PROPERTY_B.id,
        property: PROPERTY_B,
      }),
    ];

    expect(findSuggestedPropertyForHouseId(devices, "house-1")).toBeNull();
  });

  it("a device from a DIFFERENT provider sharing the same raw houseId value never influences the suggestion — only real AUGUST rows are ever considered", () => {
    const devices = [
      makeDevice({
        id: "nest-device",
        integrationConnection: { provider: "NEST" },
        rawMetadata: { houseId: "house-1" },
        propertyId: PROPERTY_A.id,
        property: PROPERTY_A,
      }),
    ];

    expect(findSuggestedPropertyForHouseId(devices, "house-1")).toBeNull();
  });

  it("ignores a same-houseId device that is itself still unmapped — only an already-explicitly-mapped device counts as real evidence", () => {
    const devices = [
      makeDevice({
        id: "also-unmapped",
        rawMetadata: { houseId: "house-1" },
        propertyId: null,
        property: null,
      }),
    ];

    expect(findSuggestedPropertyForHouseId(devices, "house-1")).toBeNull();
  });

  it("never mutates or writes anything — purely a computation over the array it's given", () => {
    const devices = [
      makeDevice({
        id: "mapped-1",
        rawMetadata: { houseId: "house-1" },
        propertyId: PROPERTY_A.id,
        property: PROPERTY_A,
      }),
    ];
    const snapshot = JSON.parse(JSON.stringify(devices));

    findSuggestedPropertyForHouseId(devices, "house-1");

    expect(JSON.parse(JSON.stringify(devices))).toEqual(snapshot);
  });
});
