import type { SmartDevice } from "../services/smart-devices.service";

/**
 * Split out of smart-devices.service.ts (which starts with `import
 * "server-only"`) specifically so a "use client" component
 * (ThermostatsList.tsx) can use these without dragging that guard into
 * client-side JS — the same fix class already applied to
 * lib/provider-display-name.ts and lib/discovered-device.ts. Zero I/O,
 * pure metadata reads, safe in either environment.
 * smart-devices.service.ts re-exports every one of these so existing
 * server-side callers (LocksList.tsx, thermostat-permission-gating.test.ts,
 * smart-devices.service.test.ts) keep importing from the same place as
 * before. `SmartDevice` is imported as a type only, from the service's own
 * re-export (never directly from `@stayw/database`, which this repo's
 * module-boundary lint rule restricts to `services/**`/`platform/**`) — so
 * it's erased at build time and never pulls in any server-only guard.
 */
export function getCurrentTemperature(
  device: Pick<SmartDevice, "metadata">,
): number | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const value = metadata?.currentTemperature;
  return typeof value === "number" ? value : null;
}

export function getTargetTemperature(
  device: Pick<SmartDevice, "metadata">,
): number | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const value = metadata?.targetTemperature;
  return typeof value === "number" ? value : null;
}

export function getMode(device: Pick<SmartDevice, "metadata">): string | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const value = metadata?.mode;
  return typeof value === "string" ? value : null;
}

export function getHumidity(
  device: Pick<SmartDevice, "metadata">,
): number | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const value = metadata?.humidity;
  return typeof value === "number" ? value : null;
}

/** The provider's own last-telemetry timestamp — distinct from SmartDevice.updatedAt, which is when StayWhile itself last synced this row. */
export function getTelemetryUpdatedAt(
  device: Pick<SmartDevice, "metadata">,
): Date | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const value = metadata?.telemetryUpdatedAt;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Gates whether NestThermostatControls should render at all. `canManage`
 * must be resolved server-side, per-property, via
 * hasPermission(actor, "thermostats:manage", {propertyId}) — see
 * /thermostats/page.tsx, which computes it once per distinct property and
 * passes the result down. assertPermission() inside
 * sendNestThermostatCommand remains the real, unchanged security boundary;
 * this function only controls whether a control that would be rejected
 * anyway is shown at all. Unchanged by this move — same signature, same
 * two-line boolean combination, still covered by
 * thermostat-permission-gating.test.ts.
 */
export function canRenderNestControls(input: {
  hasRawTraits: boolean;
  canManage: boolean;
}): boolean {
  return input.hasRawTraits && input.canManage;
}
