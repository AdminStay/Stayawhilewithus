import { describe, expect, it } from "vitest";

import {
  buildUnmappedAugustDevices,
  type AugustProviderDeviceInput,
} from "./unmapped-august-devices";

const device = (
  overrides: Partial<AugustProviderDeviceInput> = {},
): AugustProviderDeviceInput => ({
  id: "pd-1",
  discoveredName: "Side Door",
  connectivityStatus: "ONLINE",
  rawMetadata: {
    batteryLevel: 8,
    telemetryUpdatedAt: "2026-09-29T10:00:00.000Z",
    health: { lockStatusAt: "2026-09-29T11:00:00.000Z" },
  },
  lastSeenAt: new Date("2026-09-29T12:00:00.000Z"),
  propertyId: null,
  enabled: false,
  smartDeviceId: null,
  smartDeviceMetadata: null,
  ...overrides,
});

describe("buildUnmappedAugustDevices — read-only visibility", () => {
  it("surfaces an unmapped device with its readings (e.g. an 8% side door)", () => {
    const { devices, retiredCount } = buildUnmappedAugustDevices([device()]);
    expect(retiredCount).toBe(0);
    expect(devices).toEqual([
      {
        providerDeviceId: "pd-1",
        name: "Side Door",
        connectivity: "ONLINE",
        batteryLevel: 8,
        batteryReadingAt: "2026-09-29T10:00:00.000Z",
        statusReportedAt: "2026-09-29T11:00:00.000Z",
        lastSeenAt: "2026-09-29T12:00:00.000Z",
        mappingStatus: "NOT_MAPPED",
      },
    ]);
  });

  it("excludes mapped+enabled devices (they're on Fleet Status) and counts retired ones separately", () => {
    const { devices, retiredCount } = buildUnmappedAugustDevices([
      device({
        id: "mapped",
        smartDeviceId: "sd",
        propertyId: "p",
        enabled: true,
      }),
      device({
        id: "retired",
        smartDeviceId: "sd2",
        propertyId: "p",
        enabled: false,
        smartDeviceMetadata: { retiredAt: "2026-09-23T00:00:00.000Z" },
      }),
      device({
        id: "disabled",
        discoveredName: "B",
        smartDeviceId: "sd3",
        propertyId: "p",
        enabled: false,
      }),
      device({
        id: "noprop",
        discoveredName: "A",
        smartDeviceId: "sd4",
        propertyId: null,
        enabled: true,
      }),
    ]);
    expect(retiredCount).toBe(1);
    expect(devices.map((d) => [d.providerDeviceId, d.mappingStatus])).toEqual([
      ["noprop", "NO_PROPERTY"],
      ["disabled", "MAPPING_DISABLED"],
    ]);
  });

  it("never fabricates a missing reading", () => {
    const { devices } = buildUnmappedAugustDevices([
      device({ rawMetadata: {} }),
    ]);
    expect(devices[0]).toMatchObject({
      batteryLevel: null,
      batteryReadingAt: null,
      statusReportedAt: null,
    });
  });
});
