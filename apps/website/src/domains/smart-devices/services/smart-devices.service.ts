import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type SmartDevice } from "@stayw/database";
import { AugustClient, isAugustBrand } from "@stayw/integrations/august";
import { CieloClient } from "@stayw/integrations/cielo";

export type { SmartDevice };

/** Battery percentage below this is flagged as needing attention. Stored in SmartDevice.metadata (no dedicated column) since not every provider/device type reports one. */
const LOW_BATTERY_THRESHOLD = 20;

export async function listSmartDevices(actor: AuthContext) {
  await assertPermission(actor, "smart_devices:read");
  return prisma.smartDevice.findMany({
    orderBy: [{ status: "desc" }, { name: "asc" }],
    include: { property: true },
  });
}

/**
 * A row's own externalDeviceId, not the provider's PROVIDER_CLIENT_STATUS
 * ("does a real HTTP client exist for this provider"), is the honest
 * per-row signal for "is this demo data" — see
 * packages/database/prisma/seed.ts's seedDemoSmartDevices(), the only place
 * that ever creates a "demo-"-prefixed externalDeviceId. A real August
 * lockId or Cielo MAC address will never collide with that prefix. This
 * stays correct even after a provider's client is genuinely implemented but
 * a given environment hasn't run a real sync yet (or synced some
 * properties' devices but not others) — a provider-level flag can't
 * distinguish that, a per-row check can.
 */
export function isDemoSmartDevice(
  device: Pick<SmartDevice, "externalDeviceId">,
): boolean {
  return device.externalDeviceId.startsWith("demo-");
}

export interface DeviceSyncResult {
  synced: number;
  /** External IDs (lock/device IDs) fetched from the provider but not written, because their house/MAC-address key wasn't in the property map. */
  skippedExternalIds: string[];
}

/** `AUGUST_PROPERTY_MAP` / `CIELO_PROPERTY_MAP` are JSON objects — malformed or missing means "map nothing," not a crash. */
function parsePropertyMap(raw: string | undefined): Record<string, string> {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, string>;
    }
    return {};
  } catch {
    return {};
  }
}

/**
 * `AUGUST_EXCLUDED_LOCK_IDS` — a JSON array of specific August lock IDs to
 * never sync as a SmartDevice, even if their houseId is in
 * AUGUST_PROPERTY_MAP. For known non-lock entries August's own API returns
 * alongside real locks (e.g. a WiFi Bridge/Connect hub, identifiable by a
 * generic unbranded name and a battery reading August returns as -1/no
 * reading, which bridges don't have) — confirmed per-device, not a blanket
 * "skip anything with a weird battery reading" heuristic, since a real
 * lock's battery sensor failing shouldn't silently vanish from the
 * dashboard instead of showing as a problem.
 */
function parseExcludedLockIds(raw: string | undefined): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.filter((v): v is string => typeof v === "string"));
    }
    return new Set();
  } catch {
    return new Set();
  }
}

/**
 * Real sync against the account authenticated via AUGUST_IDENTIFIER /
 * AUGUST_INSTALL_ID / AUGUST_ACCESS_TOKEN (see
 * packages/integrations/src/august/README.md for how those are obtained —
 * not by this function). Requires smart_devices:update, distinct from the
 * smart_devices:read the dashboard uses, since this makes real outbound API
 * calls and writes.
 */
export async function syncAugustDevices(
  actor: AuthContext,
): Promise<DeviceSyncResult> {
  await assertPermission(actor, "smart_devices:update");

  const identifier = process.env.AUGUST_IDENTIFIER;
  const installId = process.env.AUGUST_INSTALL_ID;
  const accessToken = process.env.AUGUST_ACCESS_TOKEN;
  const brand = process.env.AUGUST_BRAND;
  if (!identifier || !installId || !accessToken) {
    throw new Error(
      "August isn't configured yet — run the login script (see packages/integrations/src/august/README.md).",
    );
  }

  const propertyMap = parsePropertyMap(process.env.AUGUST_PROPERTY_MAP);
  const excludedLockIds = parseExcludedLockIds(
    process.env.AUGUST_EXCLUDED_LOCK_IDS,
  );
  const client = new AugustClient({
    identifier,
    installId,
    accessToken,
    brand: brand && isAugustBrand(brand) ? brand : "august",
  });

  const locks = await client
    .listLocks()
    .then((all) => all.filter((lock) => !excludedLockIds.has(lock.id)));
  const skipped: string[] = [];
  let synced = 0;

  for (const lock of locks) {
    const propertyId = propertyMap[lock.houseId];
    if (!propertyId) {
      skipped.push(lock.id);
      continue;
    }

    const detail = await client.getLockDetail(lock.id);
    // Only safe, non-sensitive provider fields ever go into metadata —
    // battery, telemetry recency, lock state. Never PIN values, guest
    // names, or anything from the account/auth surface of the raw
    // response, even though those live right alongside these fields in
    // August's actual API payload.
    const data = {
      propertyId,
      name: detail.name,
      status: detail.connectivity,
      metadata: {
        ...(detail.batteryLevel != null && {
          batteryLevel: detail.batteryLevel,
        }),
        ...(detail.telemetryUpdatedAt != null && {
          telemetryUpdatedAt: detail.telemetryUpdatedAt,
        }),
        ...(detail.lockState != null && { lockState: detail.lockState }),
      },
      // seenAt only exists for the lock generation that gives August's own
      // real-time-confirmed timestamp (LockStatus.dateTime) — never
      // backfilled from telemetry or our own sync time for the rest, per
      // the standing rule that lastSeenAt means "provider confirmed this
      // device," not "we ran a sync."
      lastSeenAt: detail.seenAt ? new Date(detail.seenAt) : null,
    };
    await prisma.smartDevice.upsert({
      where: {
        provider_externalDeviceId: {
          provider: "AUGUST",
          externalDeviceId: detail.id,
        },
      },
      update: data,
      create: {
        ...data,
        provider: "AUGUST",
        deviceType: "LOCK",
        externalDeviceId: detail.id,
      },
    });
    synced++;
  }

  /**
   * Deliberately no pruning of SmartDevice rows missing from `locks`. This
   * used to hard-delete any row not in the current run's response — real,
   * confirmed data loss the moment a provider account temporarily stops
   * returning a device it still owns (a Cielo sync did exactly this: two
   * real thermostats vanished from the account's API response for reasons
   * external to StayWhile, and the deleted call here removed their rows on
   * the very next sync, cascading away any SmartDeviceEvent history too via
   * that table's onDelete: Cascade).
   *
   * A device not returned by a sync is simply never touched — its row,
   * propertyId, status, lastSeenAt, and history stay exactly as last
   * reported, so it keeps showing on /locks with its last known state
   * instead of silently disappearing. There's no existing
   * SmartDeviceStatus value that can represent "not returned by the latest
   * sync" without conflating it with a real provider-reported OFFLINE
   * signal — a dedicated status would need a schema change, not made here
   * without explicit sign-off. Real tradeoff, stated plainly: a device
   * that's genuinely, permanently retired now lingers indefinitely with
   * stale data — there is no automatic cleanup path, deliberately, since
   * classifying a missing device as "removed" is a decision only a human
   * should make, not an automatic side effect of a sync. That decision
   * point belongs in the ProviderDevice architecture's admin-driven
   * unmap/disable flow (not built yet).
   */

  return { synced, skippedExternalIds: skipped };
}

/**
 * Real sync against the account authenticated via CIELO_USERNAME /
 * CIELO_PASSWORD (see packages/integrations/src/cielo/README.md). Unlike
 * August, Cielo's login has no interactive step, so there's no separate
 * setup script — this function logs in itself on every call.
 */
export async function syncCieloDevices(
  actor: AuthContext,
): Promise<DeviceSyncResult> {
  await assertPermission(actor, "smart_devices:update");

  const username = process.env.CIELO_USERNAME;
  const password = process.env.CIELO_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Cielo isn't configured yet — set CIELO_USERNAME and CIELO_PASSWORD (see packages/integrations/src/cielo/README.md).",
    );
  }

  const propertyMap = parsePropertyMap(process.env.CIELO_PROPERTY_MAP);
  const client = new CieloClient({ username, password });

  const devices = await client.listDevices();
  const skipped: string[] = [];
  let synced = 0;

  for (const device of devices) {
    const propertyId = propertyMap[device.id];
    if (!propertyId) {
      skipped.push(device.id);
      continue;
    }

    const data = {
      propertyId,
      name: device.name,
      status: device.online ? ("ONLINE" as const) : ("OFFLINE" as const),
      metadata: {},
      lastSeenAt: device.online ? new Date() : null,
    };
    await prisma.smartDevice.upsert({
      where: {
        provider_externalDeviceId: {
          provider: "CIELO",
          externalDeviceId: device.id,
        },
      },
      update: data,
      create: {
        ...data,
        provider: "CIELO",
        deviceType: "THERMOSTAT",
        externalDeviceId: device.id,
      },
    });
    synced++;
  }

  // Deliberately no pruning of devices missing from `devices` — see
  // syncAugustDevices' matching comment above for the full reasoning. This
  // is exactly the case that caused real data loss for two real Cielo
  // thermostats (Ocean Pearl, Miramar Bliss) when they temporarily stopped
  // appearing in the account's API response.

  return { synced, skippedExternalIds: skipped };
}

/** Reads a device's battery percentage from its provider metadata, if that provider/device reports one. */
export function getBatteryLevel(
  device: Pick<SmartDevice, "metadata">,
): number | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const level = metadata?.batteryLevel;
  return typeof level === "number" ? level : null;
}

export function isLowBattery(device: Pick<SmartDevice, "metadata">): boolean {
  const level = getBatteryLevel(device);
  return level !== null && level < LOW_BATTERY_THRESHOLD;
}

/**
 * Thermostat readings (temperature/setpoint/mode/humidity) are read the
 * same way battery is — from SmartDevice.metadata, since not every provider
 * reports every field. No current provider's sync function writes any of
 * these yet (CieloClient.listDevices() only returns name/online), so these
 * will honestly return null — rendered as "—" — until a provider that
 * reports them is actually synced. Never fabricated.
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

/** Locked/unlocked, only where the provider gives a valid reading — see AugustLockDetail.lockState. Never guessed. */
export function getLockState(
  device: Pick<SmartDevice, "metadata">,
): string | null {
  const metadata = device.metadata as Record<string, unknown> | null;
  const value = metadata?.lockState;
  return typeof value === "string" ? value : null;
}

/** The provider's own last-telemetry timestamp (e.g. August's batteryInfo.infoUpdatedDate) — distinct from SmartDevice.updatedAt, which is when StayWhile itself last synced this row. */
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
 * A device's provider telemetry is considered stale after 24 hours.
 * Chosen from real observed data (2026-08-20 investigation), not a guess:
 * six of seven real August locks reported telemetry 136-227 minutes old at
 * check time (roughly 2-4 hours — the normal reporting cadence for this
 * fleet); one outlier was ~2,781 minutes old (~46 hours). 24 hours sits
 * comfortably above the normal cadence (so a routine gap between checks
 * never misfires) while still catching a genuinely stale device like that
 * one well before it reaches 46 hours. Applies to any device with a
 * telemetryUpdatedAt value, not a per-property or per-lock special case.
 */
const TELEMETRY_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

export function isTelemetryStale(
  device: Pick<SmartDevice, "metadata">,
): boolean {
  const telemetryUpdatedAt = getTelemetryUpdatedAt(device);
  if (!telemetryUpdatedAt) return false;
  return (
    Date.now() - telemetryUpdatedAt.getTime() > TELEMETRY_STALE_THRESHOLD_MS
  );
}

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
