import type { SmartDevice } from "../services/smart-devices.service";

/**
 * Split out of smart-devices.service.ts (which starts with `import
 * "server-only"`) specifically so a "use client" component
 * (CopyInventoryButton.tsx) can use it without dragging that guard into
 * client-side JS — the same reason Nest's capabilities.ts was split out of
 * client.ts. Zero I/O, pure lookup, safe in either environment.
 * smart-devices.service.ts re-exports this so every existing server-side
 * caller keeps importing from the same place as before.
 */
const PROVIDER_DISPLAY_NAMES: Partial<Record<SmartDevice["provider"], string>> =
  {
    AUGUST: "August",
    YALE: "Yale",
    CIELO: "Cielo",
    NEST: "Nest",
    ECOBEE: "Ecobee",
    HONEYWELL: "Honeywell",
  };

export function getProviderDisplayName(
  device: Pick<SmartDevice, "provider">,
): string {
  return PROVIDER_DISPLAY_NAMES[device.provider] ?? device.provider;
}
