import { getAugustHouseId, type DiscoveredDevice } from "./discovered-device";

export type MappingFilter = "ALL" | "MAPPED" | "UNMAPPED";
export type StatusFilter = "ALL" | "ENABLED" | "DISCOVERED";

export interface DeviceFilterState {
  search: string;
  /** "ALL" or a real provider code present in the loaded inventory (e.g. "AUGUST", "NEST") — never a hard-coded enum, so a future provider needs no code change here. */
  provider: string;
  mapping: MappingFilter;
  status: StatusFilter;
}

export const DEFAULT_DEVICE_FILTER_STATE: DeviceFilterState = {
  search: "",
  provider: "ALL",
  mapping: "ALL",
  status: "ALL",
};

/**
 * Maps an August house ID to every mapped property name/internal code seen
 * on any device sharing that house ID. Built fresh from the already-loaded
 * `devices` prop on every filter pass — no fetch, no persistence, nothing
 * written anywhere. This is what lets a search for "Ocean Pearl" also
 * surface generically-named housemates ("Garage Door", "Spa lock") once at
 * least one device sharing their house ID has been explicitly, manually
 * mapped to Ocean Pearl — display-only correlation from a real, human-made
 * mapping, never a guess, and never a property auto-selected in any form.
 */
function buildHouseIdToPropertyNames(
  devices: readonly DiscoveredDevice[],
): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const device of devices) {
    if (!device.property) continue;
    const houseId = getAugustHouseId(device);
    if (!houseId) continue;
    const names = map.get(houseId) ?? [];
    names.push(device.property.name, device.property.internalCode);
    map.set(houseId, names);
  }
  return map;
}

function matchesSearch(
  device: DiscoveredDevice,
  term: string,
  houseIdToPropertyNames: Map<string, string[]>,
): boolean {
  if (!term) return true;
  const needle = term.toLowerCase();
  const houseId = getAugustHouseId(device);
  const clusterPropertyNames = houseId
    ? (houseIdToPropertyNames.get(houseId) ?? [])
    : [];

  const haystacks: string[] = [
    device.discoveredName,
    device.integrationConnection.provider,
    device.externalDeviceId,
    houseId ?? "",
    device.property?.name ?? "",
    device.property?.internalCode ?? "",
    ...clusterPropertyNames,
  ];

  return haystacks.some((value) => value.toLowerCase().includes(needle));
}

/**
 * Pure, client-side only — never issues a request, never reads or writes
 * anything beyond the `devices` array already passed in. Every predicate is
 * independent (search AND provider AND mapping AND status all narrow the
 * same list), so combining filters is just applying each check in turn.
 */
export function filterDiscoveredDevices(
  devices: readonly DiscoveredDevice[],
  filters: DeviceFilterState,
): DiscoveredDevice[] {
  const houseIdToPropertyNames = buildHouseIdToPropertyNames(devices);

  return devices.filter((device) => {
    if (
      filters.provider !== "ALL" &&
      device.integrationConnection.provider !== filters.provider
    ) {
      return false;
    }
    if (filters.mapping === "MAPPED" && !device.propertyId) return false;
    if (filters.mapping === "UNMAPPED" && device.propertyId) return false;
    if (filters.status === "ENABLED" && !device.enabled) return false;
    if (filters.status === "DISCOVERED" && device.enabled) return false;

    return matchesSearch(device, filters.search, houseIdToPropertyNames);
  });
}
