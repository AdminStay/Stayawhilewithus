export type ThermostatStatusFilter =
  "ALL" | "ONLINE" | "OFFLINE" | "UNKNOWN" | "NEEDS_ATTENTION";

export interface ThermostatFilterState {
  search: string;
  /** "ALL" or a real provider code present in the loaded inventory (e.g. "NEST", "CIELO") — never a hard-coded enum, so a future provider needs no code change here. */
  provider: string;
  status: ThermostatStatusFilter;
}

export const DEFAULT_THERMOSTAT_FILTER_STATE: ThermostatFilterState = {
  search: "",
  provider: "ALL",
  status: "ALL",
};

export interface FilterableThermostat {
  name: string;
  provider: string;
  status: string;
  property: { name: string };
}

function matchesSearch(
  thermostat: FilterableThermostat,
  term: string,
): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  return (
    thermostat.name.toLowerCase().includes(needle) ||
    thermostat.property.name.toLowerCase().includes(needle)
  );
}

/**
 * Pure, client-side only — never issues a request, never reads or writes
 * anything beyond the `thermostats` array already passed in. "Offline" here
 * means any non-ONLINE, non-UNKNOWN status (e.g. ERROR) — the same
 * collapsing convention ThermostatsList's own summary cards already use.
 * NEEDS_ATTENTION is a convenience shortcut, not a new underlying category
 * — it matches exactly the union of OFFLINE and UNKNOWN.
 */
export function filterThermostats<T extends FilterableThermostat>(
  thermostats: readonly T[],
  filters: ThermostatFilterState,
): T[] {
  return thermostats.filter((thermostat) => {
    if (
      filters.provider !== "ALL" &&
      thermostat.provider !== filters.provider
    ) {
      return false;
    }

    if (filters.status === "ONLINE" && thermostat.status !== "ONLINE") {
      return false;
    }
    if (filters.status === "UNKNOWN" && thermostat.status !== "UNKNOWN") {
      return false;
    }
    if (
      filters.status === "OFFLINE" &&
      (thermostat.status === "ONLINE" || thermostat.status === "UNKNOWN")
    ) {
      return false;
    }
    if (
      filters.status === "NEEDS_ATTENTION" &&
      thermostat.status === "ONLINE"
    ) {
      return false;
    }

    return matchesSearch(thermostat, filters.search);
  });
}
