// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mocked to avoid pulling in the real actions module, which imports
// service files starting with `import "server-only"` (correct in
// production, unresolvable in this jsdom transform). Never actually
// invoked here: this file never submits the forms that reference these
// actions. getProviderDisplayName itself now comes from the dependency-free
// lib/provider-display-name.ts (the component's real import, same fix
// class as CopyInventoryButton), so it needs no mock — it's exercised for
// real, same as in CopyInventoryButton.test.tsx.
vi.mock("../actions", () => ({
  mapProviderDeviceToPropertyAction: vi.fn(),
  setProviderDeviceEnabledAction: vi.fn(),
  unmapProviderDeviceAction: vi.fn(),
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

    const row = screen.getByText("Front Door").closest("tr")!;
    expect(within(row).getByText("Unmapped")).toBeTruthy();
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

  describe("search and filters", () => {
    const CAMINGO = makeDevice({
      id: "camingo",
      discoveredName: "Camingo - Front Door",
      externalDeviceId: "CAMEXT123",
      rawMetadata: { houseId: "house-camingo" },
    });
    const BAHAMAS = makeDevice({
      id: "bahamas",
      discoveredName: "Bahamas - Front Door",
      externalDeviceId: "5AA08B0442EF407DB7243D4623EE2968",
      rawMetadata: { houseId: "5474d4be-ca3d-4e78-b4a4-79c70e2ecfe7" },
      propertyId: "prop-bahamas",
      property: {
        id: "prop-bahamas",
        name: "Bahamas",
        internalCode: "BAHAMAS",
      },
      enabled: true,
    });
    const NEST_DEVICE = makeDevice({
      id: "nest-1",
      discoveredName: "Living Room",
      integrationConnection: { provider: "NEST" },
    });
    const ALL_DEVICES = [CAMINGO, BAHAMAS, NEST_DEVICE];

    function renderList() {
      render(
        <DiscoveredDevicesList
          devices={ALL_DEVICES}
          properties={NO_PROPERTIES}
        />,
      );
    }

    function searchFor(term: string) {
      fireEvent.change(screen.getByLabelText("Search devices"), {
        target: { value: term },
      });
    }

    it("shows a result count reflecting the loaded inventory before any search", () => {
      renderList();

      expect(screen.getByText("3 of 3 devices")).toBeTruthy();
    });

    it("searches by device name", () => {
      renderList();

      searchFor("Camingo");

      expect(screen.getByText("Camingo - Front Door")).toBeTruthy();
      expect(screen.queryByText("Bahamas - Front Door")).toBeNull();
      expect(screen.queryByText("Living Room")).toBeNull();
      expect(screen.getByText("1 of 3 devices")).toBeTruthy();
    });

    it("searches by external device ID", () => {
      renderList();

      searchFor("5AA08B04");

      expect(screen.getByText("Bahamas - Front Door")).toBeTruthy();
      expect(screen.queryByText("Camingo - Front Door")).toBeNull();
    });

    it("searches by mapped property name", () => {
      renderList();

      searchFor("Bahamas");

      expect(screen.getByText("Bahamas - Front Door")).toBeTruthy();
      expect(screen.queryByText("Camingo - Front Door")).toBeNull();
    });

    it("filters by provider", () => {
      renderList();

      fireEvent.change(screen.getByLabelText("Filter by provider"), {
        target: { value: "NEST" },
      });

      expect(screen.getByText("Living Room")).toBeTruthy();
      expect(screen.queryByText("Camingo - Front Door")).toBeNull();
      expect(screen.queryByText("Bahamas - Front Door")).toBeNull();
    });

    it("filters by mapped/unmapped", () => {
      renderList();

      fireEvent.change(screen.getByLabelText("Filter by mapping"), {
        target: { value: "MAPPED" },
      });

      expect(screen.getByText("Bahamas - Front Door")).toBeTruthy();
      expect(screen.queryByText("Camingo - Front Door")).toBeNull();
      expect(screen.queryByText("Living Room")).toBeNull();
    });

    it("filters by enabled/discovered status", () => {
      renderList();

      fireEvent.change(screen.getByLabelText("Filter by status"), {
        target: { value: "ENABLED" },
      });

      expect(screen.getByText("Bahamas - Front Door")).toBeTruthy();
      expect(screen.queryByText("Camingo - Front Door")).toBeNull();
    });

    it("combines a search term with a filter", () => {
      renderList();

      searchFor("front door");
      fireEvent.change(screen.getByLabelText("Filter by mapping"), {
        target: { value: "UNMAPPED" },
      });

      // Both Camingo and Bahamas match "front door" by name, but only
      // Camingo is unmapped.
      expect(screen.getByText("Camingo - Front Door")).toBeTruthy();
      expect(screen.queryByText("Bahamas - Front Door")).toBeNull();
    });

    it("restores the full inventory when the search is cleared", () => {
      renderList();

      searchFor("Camingo");
      expect(screen.getByText("1 of 3 devices")).toBeTruthy();

      searchFor("");

      expect(screen.getByText("3 of 3 devices")).toBeTruthy();
      expect(screen.getByText("Bahamas - Front Door")).toBeTruthy();
      expect(screen.getByText("Living Room")).toBeTruthy();
    });

    it("shows a no-match empty state, without touching the underlying inventory, for a search with no results", () => {
      renderList();

      searchFor("no such device anywhere");

      expect(
        screen.getByText("No devices match your search/filters"),
      ).toBeTruthy();
      expect(screen.getByText("0 of 3 devices")).toBeTruthy();
    });
  });

  describe("truncated IDs remain fully available", () => {
    it("keeps the complete external ID accessible via its tooltip despite a shortened visible label", () => {
      const fullId = "5AA08B0442EF407DB7243D4623EE2968";
      render(
        <DiscoveredDevicesList
          devices={[makeDevice({ externalDeviceId: fullId })]}
          properties={NO_PROPERTIES}
        />,
      );

      expect(screen.getByText("5AA08B04…E2968")).toBeTruthy();
      expect(screen.getByTitle(fullId)).toBeTruthy();
      // The stored value itself is never altered — only the rendered label.
      expect(screen.queryByText(fullId)).toBeNull();
    });

    it("keeps the complete house ID accessible via its tooltip despite a shortened visible label", () => {
      const fullHouseId = "b4960a25-c4bd-4e1e-a39f-51c383df4d14";
      render(
        <DiscoveredDevicesList
          devices={[makeDevice({ rawMetadata: { houseId: fullHouseId } })]}
          properties={NO_PROPERTIES}
        />,
      );

      expect(screen.getByTitle(fullHouseId)).toBeTruthy();
    });
  });

  describe("Map/Enable/Disable/Unmap behavior is unchanged", () => {
    const PROPERTIES: Property[] = [
      { id: "prop-1", name: "Bahamas", internalCode: "BAHAMAS" },
    ];

    it("shows a property picker and a Map button for an unmapped device, and no Enable/Disable/Unmap controls", () => {
      render(
        <DiscoveredDevicesList
          devices={[makeDevice()]}
          properties={PROPERTIES}
        />,
      );

      expect(screen.getByRole("button", { name: "Map" })).toBeTruthy();
      expect(screen.getByRole("option", { name: "Bahamas" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Unmap" })).toBeNull();
    });

    it("shows Enable and Unmap for a mapped-but-not-enabled device, and no Map/Disable controls", () => {
      render(
        <DiscoveredDevicesList
          devices={[
            makeDevice({
              propertyId: "prop-1",
              property: {
                id: "prop-1",
                name: "Bahamas",
                internalCode: "BAHAMAS",
              },
            }),
          ]}
          properties={PROPERTIES}
        />,
      );

      expect(screen.getByRole("button", { name: "Enable" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Unmap" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Disable" })).toBeNull();
    });

    it("shows Disable and Unmap for a mapped-and-enabled device, and no Map/Enable controls", () => {
      render(
        <DiscoveredDevicesList
          devices={[
            makeDevice({
              propertyId: "prop-1",
              enabled: true,
              property: {
                id: "prop-1",
                name: "Bahamas",
                internalCode: "BAHAMAS",
              },
            }),
          ]}
          properties={PROPERTIES}
        />,
      );

      expect(screen.getByRole("button", { name: "Disable" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Unmap" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Map" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Enable" })).toBeNull();
    });

    it("gates Enable behind window.confirm(), naming the specific device", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <DiscoveredDevicesList
          devices={[
            makeDevice({
              discoveredName: "Bahamas - Front Door",
              propertyId: "prop-1",
              property: {
                id: "prop-1",
                name: "Bahamas",
                internalCode: "BAHAMAS",
              },
            }),
          ]}
          properties={PROPERTIES}
        />,
      );

      screen.getByRole("button", { name: "Enable" }).click();

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("Bahamas - Front Door"),
      );
      confirmSpy.mockRestore();
    });

    it("gates Unmap behind window.confirm(), naming the specific device and property", () => {
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      render(
        <DiscoveredDevicesList
          devices={[
            makeDevice({
              discoveredName: "Bahamas - Front Door",
              propertyId: "prop-1",
              property: {
                id: "prop-1",
                name: "Bahamas",
                internalCode: "BAHAMAS",
              },
            }),
          ]}
          properties={PROPERTIES}
        />,
      );

      screen.getByRole("button", { name: "Unmap" }).click();

      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("Bahamas - Front Door"),
      );
      expect(confirmSpy).toHaveBeenCalledWith(
        expect.stringContaining("Bahamas"),
      );
      confirmSpy.mockRestore();
    });

    it("never renders more than one Map control per row — no bulk action anywhere", () => {
      render(
        <DiscoveredDevicesList
          devices={[
            makeDevice({ id: "a", discoveredName: "Device A" }),
            makeDevice({ id: "b", discoveredName: "Device B" }),
          ]}
          properties={PROPERTIES}
        />,
      );

      expect(screen.getAllByRole("button", { name: "Map" })).toHaveLength(2);
      expect(screen.queryByRole("button", { name: /map all/i })).toBeNull();
      expect(screen.queryByRole("button", { name: /enable all/i })).toBeNull();
    });
  });
});
