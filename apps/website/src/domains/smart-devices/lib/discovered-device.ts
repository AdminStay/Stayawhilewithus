import type { ProviderDevice } from "../services/provider-devices.service";

export interface Property {
  id: string;
  name: string;
  internalCode: string;
}

export type DiscoveredDevice = ProviderDevice & {
  property: Property | null;
  integrationConnection: { provider: string };
};

/**
 * August-only today — `rawMetadata.houseId` is how discoverAugustDevices()
 * stores every lock's real August house identifier (see
 * provider-devices.service.ts). No other provider's rawMetadata has this
 * shape, so any other provider (or a malformed/missing value) renders null
 * rather than guessing. Never reads or returns anything else from
 * rawMetadata — deliberately narrow, same pattern as
 * DiscoveredDevicesList's CapabilitySummary.
 *
 * Kept in this dependency-free lib file (rather than on
 * DiscoveredDevicesList.tsx, which pulls in `../actions` and its own
 * server-only-guarded service imports) so CopyInventoryButton.tsx can use
 * it without dragging in either component's unrelated dependencies.
 */
export function getAugustHouseId(device: DiscoveredDevice): string | null {
  if (device.integrationConnection.provider !== "AUGUST") return null;
  const rawMetadata = device.rawMetadata as { houseId?: unknown } | null;
  const houseId =
    rawMetadata && typeof rawMetadata === "object" ? rawMetadata.houseId : null;
  return typeof houseId === "string" && houseId.length > 0 ? houseId : null;
}
