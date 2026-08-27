// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Both mocked to avoid pulling in real service files that start with
// `import "server-only"` (correct in production, unresolvable in this
// jsdom transform). Neither mock is ever invoked here: this file never
// submits the forms that reference these actions, and getProviderDisplayName
// only needs to render a label.
vi.mock("../actions", () => ({
  mapProviderDeviceToPropertyAction: vi.fn(),
  setProviderDeviceEnabledAction: vi.fn(),
  unmapProviderDeviceAction: vi.fn(),
}));
vi.mock("../services/smart-devices.service", () => ({
  getProviderDisplayName: ({ provider }: { provider: string }) =>
    ({ AUGUST: "August", NEST: "Nest" })[provider] ?? provider,
}));

import type { DiscoveredDevice, Property } from "../lib/discovered-device";

import { DiscoveredDevicesList } from "./DiscoveredDevicesList";

afterEach(cleanup);

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

const NO_PROPERTIES: Property[] = [];

describe("DiscoveredDevicesList", () => {
  it("renders External ID and House ID columns in the header", () => {
    render(
      <DiscoveredDevicesList
        devices={[makeDevice()]}
        properties={NO_PROPERTIES}
      />,
    );

    expect(screen.getByText("External ID")).toBeTruthy();
    expect(screen.getByText("House ID")).toBeTruthy();
  });

  it("shows the real houseId for an August device and the externalDeviceId next to it", () => {
    render(
      <DiscoveredDevicesList
        devices={[
          makeDevice({
            externalDeviceId: "lock-abc",
            rawMetadata: { houseId: "house-xyz" },
          }),
        ]}
        properties={NO_PROPERTIES}
      />,
    );

    const row = screen.getByText("Front Door").closest("tr")!;
    expect(within(row).getByText("lock-abc")).toBeTruthy();
    expect(within(row).getByText("house-xyz")).toBeTruthy();
  });

  it("shows — for House ID on a non-August device", () => {
    render(
      <DiscoveredDevicesList
        devices={[
          makeDevice({
            discoveredName: "Living Room",
            integrationConnection: { provider: "NEST" },
            rawMetadata: { houseId: "should-not-render" },
          }),
        ]}
        properties={NO_PROPERTIES}
      />,
    );

    const row = screen.getByText("Living Room").closest("tr")!;
    expect(within(row).getByText("—")).toBeTruthy();
    expect(within(row).queryByText("should-not-render")).toBeNull();
  });

  it("renders 'Property Name (INTERNAL-CODE)' for a mapped device", () => {
    render(
      <DiscoveredDevicesList
        devices={[
          makeDevice({
            propertyId: "prop-1",
            property: {
              id: "prop-1",
              name: "Island Tides",
              internalCode: "ISLAND-TIDES",
            },
          }),
        ]}
        properties={NO_PROPERTIES}
      />,
    );

    expect(screen.getByText("Island Tides (ISLAND-TIDES)")).toBeTruthy();
  });

  it("renders 'Unmapped' for a device with no property", () => {
    render(
      <DiscoveredDevicesList
        devices={[makeDevice()]}
        properties={NO_PROPERTIES}
      />,
    );

    expect(screen.getByText("Unmapped")).toBeTruthy();
  });

  it("renders the Copy inventory as CSV button when there is at least one device", () => {
    render(
      <DiscoveredDevicesList
        devices={[makeDevice()]}
        properties={NO_PROPERTIES}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Copy inventory as CSV" }),
    ).toBeTruthy();
  });

  it("renders the empty state, not the table or the copy button, when there are no devices", () => {
    render(<DiscoveredDevicesList devices={[]} properties={NO_PROPERTIES} />);

    expect(screen.getByText("No discovered devices yet")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Copy inventory as CSV" }),
    ).toBeNull();
  });
});
