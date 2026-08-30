import { describe, expect, it } from "vitest";

import {
  DEFAULT_DEVICE_FILTER_STATE,
  filterDiscoveredDevices,
  type DeviceFilterState,
} from "./device-filter";

import type { DiscoveredDevice } from "./discovered-device";

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

function filters(
  overrides: Partial<DeviceFilterState> = {},
): DeviceFilterState {
  return { ...DEFAULT_DEVICE_FILTER_STATE, ...overrides };
}

describe("filterDiscoveredDevices", () => {
  it("returns every device unchanged for the default (no search, no filters) state", () => {
    const devices = [makeDevice({ id: "a" }), makeDevice({ id: "b" })];

    expect(
      filterDiscoveredDevices(devices, DEFAULT_DEVICE_FILTER_STATE),
    ).toEqual(devices);
  });

  it("matches by device name, case-insensitively", () => {
    const devices = [
      makeDevice({ id: "a", discoveredName: "Camingo - Front Door" }),
      makeDevice({ id: "b", discoveredName: "Bahamas - Front Door" }),
    ];

    const result = filterDiscoveredDevices(
      devices,
      filters({ search: "camingo" }),
    );

    expect(result.map((d) => d.id)).toEqual(["a"]);
  });

  it("matches by external device ID, case-insensitively", () => {
    const devices = [
      makeDevice({
        id: "a",
        externalDeviceId: "5AA08B0442EF407DB7243D4623EE2968",
      }),
      makeDevice({ id: "b", externalDeviceId: "other-id" }),
    ];

    const result = filterDiscoveredDevices(
      devices,
      filters({ search: "5aa08b04" }),
    );

    expect(result.map((d) => d.id)).toEqual(["a"]);
  });

  it("matches by August House ID", () => {
    const devices = [
      makeDevice({ id: "a", rawMetadata: { houseId: "b4960a25-c4bd-4e1e" } }),
      makeDevice({ id: "b", rawMetadata: { houseId: "other-house" } }),
    ];

    const result = filterDiscoveredDevices(
      devices,
      filters({ search: "b4960a25" }),
    );

    expect(result.map((d) => d.id)).toEqual(["a"]);
  });

  it("matches by mapped property name or internal code", () => {
    const devices = [
      makeDevice({
        id: "a",
        propertyId: "prop-1",
        property: {
          id: "prop-1",
          name: "Island Tides",
          internalCode: "ISLAND-TIDES",
        },
      }),
      makeDevice({ id: "b" }),
    ];

    expect(
      filterDiscoveredDevices(devices, filters({ search: "island tides" })).map(
        (d) => d.id,
      ),
    ).toEqual(["a"]);
    expect(
      filterDiscoveredDevices(devices, filters({ search: "ISLAND-TIDES" })).map(
        (d) => d.id,
      ),
    ).toEqual(["a"]);
  });

  it("matches a generically-named August housemate once a sibling sharing its house ID is mapped, without matching an unrelated housemate on a different house ID", () => {
    const devices = [
      makeDevice({
        id: "front-door",
        discoveredName: "Ocean Pearl - Front Door",
        rawMetadata: { houseId: "b4960a25-c4bd-4e1e" },
        propertyId: "prop-op",
        property: {
          id: "prop-op",
          name: "Ocean Pearl",
          internalCode: "OCEAN-PEARL",
        },
      }),
      makeDevice({
        id: "garage",
        discoveredName: "Garage Door",
        rawMetadata: { houseId: "b4960a25-c4bd-4e1e" },
      }),
      makeDevice({
        id: "spa",
        discoveredName: "Spa lock",
        rawMetadata: { houseId: "b4960a25-c4bd-4e1e" },
      }),
      makeDevice({
        id: "unrelated-garage",
        discoveredName: "Garage Door",
        rawMetadata: { houseId: "some-other-house" },
      }),
    ];

    const result = filterDiscoveredDevices(
      devices,
      filters({ search: "Ocean Pearl" }),
    );

    expect(result.map((d) => d.id).sort()).toEqual([
      "front-door",
      "garage",
      "spa",
    ]);
  });

  it("never surfaces a generically-named device by search before any housemate is actually mapped", () => {
    const devices = [
      makeDevice({
        id: "front-door",
        discoveredName: "Ocean Pearl - Front Door",
        rawMetadata: { houseId: "b4960a25-c4bd-4e1e" },
      }),
      makeDevice({
        id: "garage",
        discoveredName: "Garage Door",
        rawMetadata: { houseId: "b4960a25-c4bd-4e1e" },
      }),
    ];

    const result = filterDiscoveredDevices(
      devices,
      filters({ search: "Ocean Pearl" }),
    );

    expect(result.map((d) => d.id)).toEqual(["front-door"]);
  });

  it("filters by provider", () => {
    const devices = [
      makeDevice({ id: "a", integrationConnection: { provider: "AUGUST" } }),
      makeDevice({ id: "b", integrationConnection: { provider: "NEST" } }),
    ];

    expect(
      filterDiscoveredDevices(devices, filters({ provider: "NEST" })).map(
        (d) => d.id,
      ),
    ).toEqual(["b"]);
  });

  it("filters by mapped/unmapped", () => {
    const devices = [
      makeDevice({ id: "mapped", propertyId: "prop-1" }),
      makeDevice({ id: "unmapped", propertyId: null }),
    ];

    expect(
      filterDiscoveredDevices(devices, filters({ mapping: "MAPPED" })).map(
        (d) => d.id,
      ),
    ).toEqual(["mapped"]);
    expect(
      filterDiscoveredDevices(devices, filters({ mapping: "UNMAPPED" })).map(
        (d) => d.id,
      ),
    ).toEqual(["unmapped"]);
  });

  it("filters by enabled/discovered status", () => {
    const devices = [
      makeDevice({ id: "enabled", enabled: true }),
      makeDevice({ id: "discovered", enabled: false }),
    ];

    expect(
      filterDiscoveredDevices(devices, filters({ status: "ENABLED" })).map(
        (d) => d.id,
      ),
    ).toEqual(["enabled"]);
    expect(
      filterDiscoveredDevices(devices, filters({ status: "DISCOVERED" })).map(
        (d) => d.id,
      ),
    ).toEqual(["discovered"]);
  });

  it("combines search and filters (AND, not OR)", () => {
    const devices = [
      makeDevice({
        id: "match",
        discoveredName: "Bahamas - Front Door",
        integrationConnection: { provider: "AUGUST" },
        propertyId: null,
      }),
      makeDevice({
        id: "wrong-provider",
        discoveredName: "Bahamas - Front Door",
        integrationConnection: { provider: "NEST" },
        propertyId: null,
      }),
      makeDevice({
        id: "wrong-mapping",
        discoveredName: "Bahamas - Front Door",
        integrationConnection: { provider: "AUGUST" },
        propertyId: "prop-1",
      }),
    ];

    const result = filterDiscoveredDevices(
      devices,
      filters({ search: "bahamas", provider: "AUGUST", mapping: "UNMAPPED" }),
    );

    expect(result.map((d) => d.id)).toEqual(["match"]);
  });

  it("restores the full inventory when the search term is cleared back to empty", () => {
    const devices = [
      makeDevice({ id: "a", discoveredName: "Alpha Lock" }),
      makeDevice({ id: "b", discoveredName: "Beta Lock" }),
    ];

    const searched = filterDiscoveredDevices(
      devices,
      filters({ search: "alpha" }),
    );
    const cleared = filterDiscoveredDevices(devices, filters({ search: "" }));

    expect(searched.map((d) => d.id)).toEqual(["a"]);
    expect(cleared).toEqual(devices);
  });
});
