// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DiscoveredDevice } from "../lib/discovered-device";

import { CopyInventoryButton } from "./CopyInventoryButton";

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

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});

async function clickCopy() {
  fireEvent.click(
    screen.getByRole("button", { name: "Copy inventory as CSV" }),
  );
  // navigator.clipboard.writeText is awaited inside the click handler.
  await Promise.resolve();
  await Promise.resolve();
}

describe("CopyInventoryButton", () => {
  it("copies a CSV with the exact 8 required columns, in order, as the header row", async () => {
    render(<CopyInventoryButton devices={[makeDevice()]} />);

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    const [header] = csv.split("\n");
    expect(header).toBe(
      "Provider,Device/Lock Name,External Device ID,House ID,Connectivity,Mapped Property,Property Internal Code,Enabled/Disabled",
    );
  });

  it("renders a data row with provider display name, name, external ID, connectivity, Unmapped, and Disabled for an unmapped device", async () => {
    render(
      <CopyInventoryButton
        devices={[
          makeDevice({
            discoveredName: "Island Tides - Front Door",
            externalDeviceId: "lock-abc",
            connectivityStatus: "OFFLINE",
          }),
        ]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    const [, row] = csv.split("\n");
    expect(row).toBe(
      "August,Island Tides - Front Door,lock-abc,—,OFFLINE,Unmapped,,Disabled",
    );
  });

  it("includes the mapped property name, internal code, and Enabled for a mapped+enabled device", async () => {
    render(
      <CopyInventoryButton
        devices={[
          makeDevice({
            enabled: true,
            propertyId: "prop-1",
            property: {
              id: "prop-1",
              name: "Island Tides",
              internalCode: "ISLAND-TIDES",
            },
          }),
        ]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    const [, row] = csv.split("\n");
    expect(row).toBe(
      "August,Front Door,ext-1,—,ONLINE,Island Tides,ISLAND-TIDES,Enabled",
    );
  });

  it("extracts rawMetadata.houseId only for AUGUST devices", async () => {
    render(
      <CopyInventoryButton
        devices={[
          makeDevice({ rawMetadata: { houseId: "house-123" } }),
          makeDevice({
            integrationConnection: { provider: "NEST" },
            rawMetadata: { houseId: "should-not-appear" },
          }),
        ]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    const [, augustRow, nestRow] = csv.split("\n");
    expect(augustRow).toContain("house-123");
    expect(nestRow).not.toContain("should-not-appear");
    expect(nestRow!.split(",")[3]).toBe("—");
  });

  it("never includes any rawMetadata field other than houseId", async () => {
    render(
      <CopyInventoryButton
        devices={[
          makeDevice({
            rawMetadata: {
              houseId: "house-123",
              accessToken: "SECRET-TOKEN-SHOULD-NEVER-APPEAR",
              pin: "1234",
            },
          }),
        ]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv).not.toContain("SECRET-TOKEN-SHOULD-NEVER-APPEAR");
    expect(csv).not.toContain("1234");
  });

  it("wraps a value containing a comma in quotes", async () => {
    render(
      <CopyInventoryButton
        devices={[makeDevice({ discoveredName: "Front Door, Garage" })]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv).toContain('"Front Door, Garage"');
  });

  it("wraps and doubles internal quotes for a value containing a double quote", async () => {
    render(
      <CopyInventoryButton
        devices={[makeDevice({ discoveredName: 'Lock "Alpha"' })]}
      />,
    );

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv).toContain('"Lock ""Alpha"""');
  });

  it("shows a Copied confirmation after a successful copy", async () => {
    render(<CopyInventoryButton devices={[makeDevice()]} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy inventory as CSV" }),
    );

    expect(await screen.findByText("Copied.")).toBeTruthy();
  });

  it("shows a failure message when the clipboard write rejects, without throwing", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    render(<CopyInventoryButton devices={[makeDevice()]} />);

    fireEvent.click(
      screen.getByRole("button", { name: "Copy inventory as CSV" }),
    );

    expect(
      await screen.findByText(
        "Couldn't copy — try selecting the table instead.",
      ),
    ).toBeTruthy();
  });

  it("produces a header-only CSV for an empty device list, without erroring", async () => {
    render(<CopyInventoryButton devices={[]} />);

    await clickCopy();

    const csv = writeText.mock.calls[0]![0] as string;
    expect(csv.split("\n")).toHaveLength(1);
  });
});
