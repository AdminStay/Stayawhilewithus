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

/**
 * The smallest safe mapping assistance (2026-09-23, item F) — a
 * deterministic SUGGESTION only, never an automatic mapping. Kenny's
 * complaint was that manually mapping every newly-discovered/replacement
 * lock feels unnecessarily heavy; this reduces that friction using a real,
 * exact, provider-assigned identifier that's already captured for every
 * discovered August lock (getAugustHouseId() above), never a name/address/
 * substring/fuzzy comparison of any kind.
 *
 * Looks across every OTHER already-mapped AUGUST device (any device whose
 * `property` is non-null — mapping, not enablement, is the relevant
 * signal) whose own real houseId exactly equals the target's. Only
 * suggests a property when that search resolves to exactly ONE distinct
 * property — fails closed (returns null, no suggestion) in every other
 * case:
 *
 *   - `houseId` is null (missing or malformed — getAugustHouseId() already
 *     returns null for both, never guessed at here) — no suggestion.
 *   - no other AUGUST device shares this exact houseId and is mapped — no
 *     suggestion.
 *   - the matching mapped devices disagree — two different properties
 *     both claim the same houseId — genuinely ambiguous, no suggestion.
 *     (This can legitimately happen, e.g. mid-replacement, when an old
 *     lock's mapping hasn't been cleaned up yet — silently guessing which
 *     one is "right" would be exactly the unsafe inference this function
 *     must never do.)
 *   - a matching device belongs to a different provider — never
 *     considered at all; this function only ever reads AUGUST rows.
 *
 * Never writes anything, never calls a mapping action — purely a read-only
 * computation over already-fetched data, for the caller to render as a
 * pre-filled (never pre-submitted) suggestion the operator must still
 * explicitly confirm.
 */
export function findSuggestedPropertyForHouseId(
  devices: DiscoveredDevice[],
  houseId: string | null,
): Property | null {
  if (!houseId) return null;

  const matchingProperties = new Map<string, Property>();
  for (const device of devices) {
    if (device.integrationConnection.provider !== "AUGUST") continue;
    if (!device.property) continue;
    if (getAugustHouseId(device) !== houseId) continue;
    matchingProperties.set(device.property.id, device.property);
  }

  if (matchingProperties.size !== 1) return null;
  return [...matchingProperties.values()][0] ?? null;
}
