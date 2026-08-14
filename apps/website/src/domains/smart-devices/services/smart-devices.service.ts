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
 * Deletes SmartDevice rows for this provider that weren't in the set the
 * provider just returned — covers both the seeded demo rows (which have
 * externalDeviceIds like "demo-august-...", never returned by a real
 * account) and locks/devices genuinely removed from the account since the
 * last sync. Guarded against an empty `keepIds`: a sync that legitimately
 * returned zero devices (network blip, empty account) should never be
 * treated as "delete everything."
 */
async function pruneStaleDevices(
  provider: "AUGUST" | "CIELO",
  keepExternalIds: string[],
): Promise<void> {
  if (keepExternalIds.length === 0) return;
  await prisma.smartDevice.deleteMany({
    where: { provider, externalDeviceId: { notIn: keepExternalIds } },
  });
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
    const data = {
      propertyId,
      name: detail.name,
      status: detail.online ? ("ONLINE" as const) : ("OFFLINE" as const),
      metadata:
        detail.batteryLevel != null
          ? { batteryLevel: detail.batteryLevel }
          : {},
      lastSeenAt: detail.online ? new Date() : null,
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

  await pruneStaleDevices(
    "AUGUST",
    locks.map((l) => l.id),
  );

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

  await pruneStaleDevices(
    "CIELO",
    devices.map((d) => d.id),
  );

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
