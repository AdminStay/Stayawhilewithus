import { describe, expect, it } from "vitest";

import {
  DEFAULT_THERMOSTAT_FILTER_STATE,
  filterThermostats,
  type FilterableThermostat,
  type ThermostatFilterState,
} from "./thermostat-filter";

function makeThermostat(
  overrides: Partial<FilterableThermostat> = {},
): FilterableThermostat {
  return {
    name: "Living Room",
    provider: "NEST",
    status: "ONLINE",
    property: { name: "Aqua Palm" },
    ...overrides,
  };
}

function filters(
  overrides: Partial<ThermostatFilterState> = {},
): ThermostatFilterState {
  return { ...DEFAULT_THERMOSTAT_FILTER_STATE, ...overrides };
}

describe("filterThermostats", () => {
  it("returns every thermostat unchanged for the default (no search, no filters) state", () => {
    const thermostats = [makeThermostat(), makeThermostat({ name: "b" })];

    expect(
      filterThermostats(thermostats, DEFAULT_THERMOSTAT_FILTER_STATE),
    ).toEqual(thermostats);
  });

  it("searches by thermostat name, case-insensitively", () => {
    const thermostats = [
      makeThermostat({ name: "Living Room" }),
      makeThermostat({ name: "Kitchen" }),
    ];

    expect(
      filterThermostats(thermostats, filters({ search: "living" })),
    ).toEqual([thermostats[0]]);
  });

  it("searches by property name", () => {
    const thermostats = [
      makeThermostat({ property: { name: "Champion Retreat" } }),
      makeThermostat({ property: { name: "Aqua Palm" } }),
    ];

    expect(
      filterThermostats(thermostats, filters({ search: "champion" })),
    ).toEqual([thermostats[0]]);
  });

  it("filters by provider", () => {
    const thermostats = [
      makeThermostat({ provider: "NEST" }),
      makeThermostat({ provider: "CIELO" }),
    ];

    expect(
      filterThermostats(thermostats, filters({ provider: "CIELO" })),
    ).toEqual([thermostats[1]]);
  });

  it("filters by Online status", () => {
    const thermostats = [
      makeThermostat({ status: "ONLINE" }),
      makeThermostat({ status: "OFFLINE" }),
      makeThermostat({ status: "UNKNOWN" }),
    ];

    expect(
      filterThermostats(thermostats, filters({ status: "ONLINE" })),
    ).toEqual([thermostats[0]]);
  });

  it("filters by Unknown status, distinctly from Offline", () => {
    const thermostats = [
      makeThermostat({ status: "OFFLINE" }),
      makeThermostat({ status: "UNKNOWN" }),
    ];

    expect(
      filterThermostats(thermostats, filters({ status: "UNKNOWN" })),
    ).toEqual([thermostats[1]]);
  });

  it("filters by Offline status, excluding Unknown", () => {
    const thermostats = [
      makeThermostat({ status: "OFFLINE" }),
      makeThermostat({ status: "ERROR" }),
      makeThermostat({ status: "UNKNOWN" }),
      makeThermostat({ status: "ONLINE" }),
    ];

    const result = filterThermostats(
      thermostats,
      filters({ status: "OFFLINE" }),
    );

    expect(result).toEqual([thermostats[0], thermostats[1]]);
  });

  it("'Needs attention' matches both Offline and Unknown, never Online", () => {
    const thermostats = [
      makeThermostat({ status: "ONLINE" }),
      makeThermostat({ status: "OFFLINE" }),
      makeThermostat({ status: "UNKNOWN" }),
    ];

    const result = filterThermostats(
      thermostats,
      filters({ status: "NEEDS_ATTENTION" }),
    );

    expect(result).toEqual([thermostats[1], thermostats[2]]);
  });

  it("combines search and filters (AND, not OR)", () => {
    const thermostats = [
      makeThermostat({
        name: "Living Room",
        provider: "NEST",
        status: "ONLINE",
      }),
      makeThermostat({
        name: "Living Room",
        provider: "CIELO",
        status: "ONLINE",
      }),
      makeThermostat({
        name: "Living Room",
        provider: "NEST",
        status: "OFFLINE",
      }),
    ];

    const result = filterThermostats(
      thermostats,
      filters({ search: "living", provider: "NEST", status: "ONLINE" }),
    );

    expect(result).toEqual([thermostats[0]]);
  });

  it("restores the full inventory when the search term is cleared back to empty", () => {
    const thermostats = [
      makeThermostat({ name: "Alpha" }),
      makeThermostat({ name: "Beta" }),
    ];

    const searched = filterThermostats(
      thermostats,
      filters({ search: "alpha" }),
    );
    const cleared = filterThermostats(thermostats, filters({ search: "" }));

    expect(searched).toEqual([thermostats[0]]);
    expect(cleared).toEqual(thermostats);
  });
});
