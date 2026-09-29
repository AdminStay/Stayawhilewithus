/**
 * Unmapped August devices (2026-09-30, three-way /locks separation): August
 * locks StayWhile discovered but that are not on the Fleet Status list
 * (e.g. MJ Side Door). Pure and read-only — surfaced for visibility only,
 * with no controls and no mapping action. Mapping stays an explicit admin
 * action in Discovered Devices; nothing here infers a property from a name.
 *
 * Unmapped devices are refreshed only by Discovery, not by the lock
 * refresh, so their readings can be older than Fleet Status readings —
 * the UI says "last seen by StayWhile (discovery)" for that reason.
 */

export type UnmappedMappingStatus =
  "NOT_MAPPED" | "NO_PROPERTY" | "MAPPING_DISABLED";

export const UNMAPPED_MAPPING_STATUS_LABELS: Record<
  UnmappedMappingStatus,
  string
> = {
  NOT_MAPPED: "Not mapped",
  NO_PROPERTY: "No property assigned",
  MAPPING_DISABLED: "Mapping disabled",
};

export interface AugustProviderDeviceInput {
  id: string;
  discoveredName: string;
  connectivityStatus: string;
  rawMetadata: unknown;
  lastSeenAt: Date | string;
  propertyId: string | null;
  enabled: boolean;
  smartDeviceId: string | null;
  /** The linked SmartDevice's metadata, when linked (to detect retirement). */
  smartDeviceMetadata: unknown;
}

export interface UnmappedAugustDevice {
  providerDeviceId: string;
  name: string;
  connectivity: string;
  batteryLevel: number | null;
  /** August's battery report time. */
  batteryReadingAt: string | null;
  /** August's own lock-status time, when reported. */
  statusReportedAt: string | null;
  /** When StayWhile last saw it (discovery). */
  lastSeenAt: string;
  mappingStatus: UnmappedMappingStatus;
}

const isRetired = (metadata: unknown) =>
  !!metadata &&
  typeof metadata === "object" &&
  typeof (metadata as Record<string, unknown>).retiredAt === "string";

/**
 * Null = not unmapped (it's on Fleet Status) or explicitly retired (an
 * admin decision; counted separately, never re-surfaced as unmapped).
 */
export function classifyUnmappedAugustDevice(
  device: AugustProviderDeviceInput,
): UnmappedMappingStatus | "RETIRED" | null {
  if (device.smartDeviceId && isRetired(device.smartDeviceMetadata))
    return "RETIRED";
  if (!device.smartDeviceId) return "NOT_MAPPED";
  if (!device.propertyId) return "NO_PROPERTY";
  if (!device.enabled) return "MAPPING_DISABLED";
  return null;
}

export function toUnmappedAugustDevice(
  device: AugustProviderDeviceInput,
  mappingStatus: UnmappedMappingStatus,
): UnmappedAugustDevice {
  const raw =
    device.rawMetadata && typeof device.rawMetadata === "object"
      ? (device.rawMetadata as Record<string, unknown>)
      : {};
  const health =
    raw.health && typeof raw.health === "object"
      ? (raw.health as Record<string, unknown>)
      : {};
  return {
    providerDeviceId: device.id,
    name: device.discoveredName,
    connectivity: device.connectivityStatus,
    batteryLevel:
      typeof raw.batteryLevel === "number" ? raw.batteryLevel : null,
    batteryReadingAt:
      typeof raw.telemetryUpdatedAt === "string"
        ? raw.telemetryUpdatedAt
        : null,
    statusReportedAt:
      typeof health.lockStatusAt === "string" ? health.lockStatusAt : null,
    lastSeenAt:
      typeof device.lastSeenAt === "string"
        ? device.lastSeenAt
        : device.lastSeenAt.toISOString(),
    mappingStatus,
  };
}

export function buildUnmappedAugustDevices(
  devices: readonly AugustProviderDeviceInput[],
): { devices: UnmappedAugustDevice[]; retiredCount: number } {
  const out: UnmappedAugustDevice[] = [];
  let retiredCount = 0;
  for (const device of devices) {
    const status = classifyUnmappedAugustDevice(device);
    if (status === "RETIRED") retiredCount++;
    else if (status) out.push(toUnmappedAugustDevice(device, status));
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { devices: out, retiredCount };
}
