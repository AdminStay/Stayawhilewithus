// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mocked so this file tests ThermostatsList's own rendering/gating logic in
// isolation, not NestThermostatControls' internals (covered by its own
// tests) — this component imports server actions that would otherwise pull
// in server-only-guarded services.
vi.mock("./NestThermostatControls", () => ({
  NestThermostatControls: () => <div>REAL CONTROLS</div>,
}));

import { formatTimestamp } from "../lib/format-timestamp";
import { ThermostatsList } from "./ThermostatsList";

afterEach(cleanup);

function makeThermostat(overrides: Record<string, unknown> = {}) {
  return {
    id: "device-1",
    provider: "NEST",
    status: "ONLINE",
    name: "Living Room",
    propertyId: "prop-1",
    property: { name: "Aqua Palm" },
    metadata: {},
    updatedAt: new Date("2026-01-01"),
    providerDevice: null,
    ...overrides,
  } as never;
}

describe("ThermostatsList", () => {
  it("renders the empty state when there are no thermostats", () => {
    render(<ThermostatsList thermostats={[]} canManageByPropertyId={{}} />);

    expect(screen.getByText("No thermostats yet")).toBeTruthy();
  });

  it("shows a result count reflecting the loaded inventory before any search", () => {
    render(
      <ThermostatsList
        thermostats={[makeThermostat({ id: "a" }), makeThermostat({ id: "b" })]}
        canManageByPropertyId={{}}
      />,
    );

    expect(screen.getByText("2 of 2 thermostats")).toBeTruthy();
  });

  it("searches by thermostat name", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({ id: "a", name: "Living Room" }),
          makeThermostat({ id: "b", name: "Kitchen" }),
        ]}
        canManageByPropertyId={{}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search thermostats"), {
      target: { value: "kitchen" },
    });

    expect(screen.getByText("Kitchen")).toBeTruthy();
    expect(screen.queryByText("Living Room")).toBeNull();
    expect(screen.getByText("1 of 2 thermostats")).toBeTruthy();
  });

  it("searches by property name", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({ id: "a", property: { name: "Champion Retreat" } }),
          makeThermostat({ id: "b", property: { name: "Aqua Palm" } }),
        ]}
        canManageByPropertyId={{}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search thermostats"), {
      target: { value: "champion" },
    });

    expect(screen.getByText("Champion Retreat")).toBeTruthy();
    expect(screen.queryByText("Aqua Palm")).toBeNull();
  });

  it("filters by provider", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({ id: "a", provider: "NEST", name: "Nest Device" }),
          makeThermostat({ id: "b", provider: "CIELO", name: "Cielo Device" }),
        ]}
        canManageByPropertyId={{}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter by provider"), {
      target: { value: "CIELO" },
    });

    expect(screen.getByText("Cielo Device")).toBeTruthy();
    expect(screen.queryByText("Nest Device")).toBeNull();
  });

  it("filters by status, including the combined 'Needs attention' option", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({ id: "a", status: "ONLINE", name: "Online One" }),
          makeThermostat({ id: "b", status: "OFFLINE", name: "Offline One" }),
          makeThermostat({ id: "c", status: "UNKNOWN", name: "Unknown One" }),
        ]}
        canManageByPropertyId={{}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Filter by status"), {
      target: { value: "NEEDS_ATTENTION" },
    });

    expect(screen.getByText("Offline One")).toBeTruthy();
    expect(screen.getByText("Unknown One")).toBeTruthy();
    expect(screen.queryByText("Online One")).toBeNull();
  });

  it("preserves the Total/Online/Offline summary cards unaffected by active search/filters", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({ id: "a", status: "ONLINE", name: "Online One" }),
          makeThermostat({ id: "b", status: "OFFLINE", name: "Offline One" }),
        ]}
        canManageByPropertyId={{}}
      />,
    );

    fireEvent.change(screen.getByLabelText("Search thermostats"), {
      target: { value: "online" },
    });

    expect(screen.getByText("Total thermostats")).toBeTruthy();
    expect(screen.getByText("2")).toBeTruthy(); // total unaffected by the search
  });

  it("shows a compact 'Controls' toggle (not the live control stack) by default when canManage is true", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({
            id: "a",
            name: "Living Room",
            propertyId: "prop-can-manage",
            providerDevice: { enabled: true, rawMetadata: { rawTraits: {} } },
          }),
        ]}
        canManageByPropertyId={{ "prop-can-manage": true }}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Show controls for Living Room" }),
    ).toBeTruthy();
    expect(screen.queryByText("REAL CONTROLS")).toBeNull();
    expect(screen.queryByText(/View only/)).toBeNull();
  });

  it("expands to reveal the live control stack on click, and collapses again on a second click — the row never starts tall", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({
            id: "a",
            name: "Living Room",
            propertyId: "prop-can-manage",
            providerDevice: { enabled: true, rawMetadata: { rawTraits: {} } },
          }),
        ]}
        canManageByPropertyId={{ "prop-can-manage": true }}
      />,
    );

    const toggle = screen.getByRole("button", {
      name: "Show controls for Living Room",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(toggle);

    expect(screen.getByText("REAL CONTROLS")).toBeTruthy();
    const hideToggle = screen.getByRole("button", {
      name: "Hide controls for Living Room",
    });
    expect(hideToggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(hideToggle);

    expect(screen.queryByText("REAL CONTROLS")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Show controls for Living Room" }),
    ).toBeTruthy();
  });

  it("keeps each thermostat's expanded state independent of the others", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({
            id: "a",
            name: "Living Room",
            propertyId: "prop-can-manage",
            providerDevice: { enabled: true, rawMetadata: { rawTraits: {} } },
          }),
          makeThermostat({
            id: "b",
            name: "Kitchen",
            propertyId: "prop-can-manage",
            providerDevice: { enabled: true, rawMetadata: { rawTraits: {} } },
          }),
        ]}
        canManageByPropertyId={{ "prop-can-manage": true }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show controls for Living Room" }),
    );

    expect(screen.getAllByText("REAL CONTROLS")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Show controls for Kitchen" }),
    ).toBeTruthy();
  });

  it("renders 'View only' when canManage is false for the device's property, even though rawTraits exist — never renders live controls in this case", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({
            id: "a",
            propertyId: "prop-cannot-manage",
            providerDevice: { enabled: true, rawMetadata: { rawTraits: {} } },
          }),
        ]}
        canManageByPropertyId={{ "prop-cannot-manage": false }}
      />,
    );

    expect(screen.getByText(/View only — no permission/)).toBeTruthy();
    expect(screen.queryByText("REAL CONTROLS")).toBeNull();
  });

  it("renders the compact column set, with 'Device' (not 'Thermostat') and no separate 'Last telemetry' column", () => {
    render(
      <ThermostatsList
        thermostats={[makeThermostat()]}
        canManageByPropertyId={{}}
      />,
    );

    for (const header of [
      "Property",
      "Device",
      "Provider",
      "Status",
      "Current",
      "Target",
      "Mode",
      "Humidity",
      "Last synced",
      "Controls",
    ]) {
      expect(screen.getByText(header)).toBeTruthy();
    }
    expect(screen.queryByText("Thermostat")).toBeNull();
    expect(screen.queryByText("Last telemetry")).toBeNull();
  });

  it("surfaces last-telemetry as a tooltip on the Last synced cell, not as its own column", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({
            metadata: { telemetryUpdatedAt: "2026-01-02T00:00:00.000Z" },
          }),
        ]}
        canManageByPropertyId={{}}
      />,
    );

    const lastSyncedCell = screen.getByText(
      formatTimestamp(new Date("2026-01-01")),
    );
    expect(lastSyncedCell.getAttribute("title")).toMatch(/Last telemetry:/);
  });

  it("renders '—' for a non-Nest device with no rawTraits, regardless of canManage", () => {
    render(
      <ThermostatsList
        thermostats={[
          makeThermostat({
            id: "a",
            provider: "CIELO",
            propertyId: "prop-1",
            providerDevice: null,
          }),
        ]}
        canManageByPropertyId={{ "prop-1": true }}
      />,
    );

    expect(screen.queryByText("REAL CONTROLS")).toBeNull();
    expect(screen.queryByText(/View only/)).toBeNull();
  });
});
