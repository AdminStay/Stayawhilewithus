import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import { CieloClient } from "@stayw/integrations/cielo";
import { NestClient } from "@stayw/integrations/nest";

import { toSmartDeviceMetadata } from "./provider-devices.service";

/**
 * Manual "Refresh" for /thermostats — a pure read-from-provider,
 * write-telemetry-to-StayWhile-DB action. Explicitly NOT a sync/discovery
 * pass and NEVER a control command: it never creates, maps, enables,
 * disables, or deletes a device, and never calls a provider's command/write
 * endpoint. See refreshNestTelemetry() and refreshCieloTelemetry() below for
 * the exact per-provider read/write boundary.
 *
 * Deliberately does NOT reuse smart-devices.service.ts's syncCieloDevices()
 * for this — that function is a real, genuine upsert (create-or-update)
 * keyed on CIELO_PROPERTY_MAP: the first time it runs after a new device is
 * added to that env var, it creates a brand-new SmartDevice row. That's
 * correct behavior for its own job (bootstrap sync/mapping, reachable from
 * /integrations' "Sync Now" — left completely untouched here), but wrong
 * for "Refresh," which must only ever touch devices already represented in
 * StayWhile. refreshCieloTelemetry() below reads the exact same live Cielo
 * data but only ever writes to SmartDevice rows that already exist.
 */

function getNestClientFromEnv(): NestClient {
  const clientId = process.env.NEST_CLIENT_ID;
  const clientSecret = process.env.NEST_CLIENT_SECRET;
  const projectId = process.env.NEST_PROJECT_ID;
  const refreshToken = process.env.NEST_REFRESH_TOKEN;
  if (!clientId || !clientSecret || !projectId || !refreshToken) {
    throw new Error(
      "Nest isn't configured — set NEST_CLIENT_ID/NEST_CLIENT_SECRET/NEST_PROJECT_ID/NEST_REFRESH_TOKEN.",
    );
  }
  return new NestClient({ clientId, clientSecret, projectId, refreshToken });
}

export interface NestRefreshResult {
  /** Already-enabled/mapped Nest thermostats whose SmartDevice/ProviderDevice telemetry was updated from a fresh read. */
  refreshed: number;
  /** Enabled devices Nest's own listDevices() didn't return this time — left completely untouched, never pruned/disabled (same "no automatic data loss" rule as every other provider sync in this app). */
  notReturnedByProvider: number;
}

/**
 * Refreshes telemetry for Nest thermostats that are ALREADY enabled/mapped
 * — never discovers, maps, enables, disables, or creates anything, and
 * never calls a Nest command-execution endpoint (no command-sending
 * function is imported into this file at all — see
 * thermostat-refresh.service.test.ts's dedicated source-level guarantee
 * test for this).
 *
 * Exactly one real Nest API call: NestClient.listDevices() (the same bulk
 * read discoverNestDevices() already uses) — never one getDevice() call per
 * device, which is what previously caused a real Production P2024/timeout
 * incident when applied to August's larger fleet (see HANDOFF.md Increment
 * 59). Every DB write below is pure — no network call happens inside the
 * transaction — so all of them are batched into one prisma.$transaction,
 * the same discipline already applied to August's discovery enrichment
 * phase.
 *
 * A device this account no longer reports is left exactly as it was
 * (status/metadata/lastSeenAt all untouched) — counted, never silently
 * dropped or reclassified.
 */
export async function refreshNestTelemetry(
  actor: AuthContext,
): Promise<NestRefreshResult> {
  await assertPermission(actor, "smart_devices:update");

  // Configuration is validated unconditionally, before checking whether
  // there's anything to refresh — same as every other provider sync
  // function in this codebase (discoverNestDevices/syncCieloDevices). A VA
  // should see "Nest isn't configured" if credentials are missing/revoked,
  // never a silently-misleading "0 refreshed" success just because there
  // also happen to be zero enabled devices right now.
  const client = getNestClientFromEnv();

  const enabledDevices = await prisma.providerDevice.findMany({
    where: {
      enabled: true,
      smartDeviceId: { not: null },
      integrationConnection: { provider: "NEST" },
    },
    select: { id: true, externalDeviceId: true, smartDeviceId: true },
  });

  if (enabledDevices.length === 0) {
    return { refreshed: 0, notReturnedByProvider: 0 };
  }

  // The one and only real Nest API call this function makes — a bulk read,
  // never a per-device call, and never anything but a read (no command
  // method is imported into this file).
  const freshDevices = await client.listDevices();
  const freshByExternalId = new Map(
    freshDevices.map((device) => [device.externalDeviceId, device]),
  );

  const now = new Date();
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  let notReturnedByProvider = 0;

  for (const enabledDevice of enabledDevices) {
    // Defensive — the query above already filters on this, but never trust
    // an assumed invariant blindly (same discipline as elsewhere in this
    // codebase).
    if (!enabledDevice.smartDeviceId) continue;

    const fresh = freshByExternalId.get(enabledDevice.externalDeviceId);
    if (!fresh) {
      notReturnedByProvider++;
      continue;
    }

    const status = fresh.connectivity ?? "UNKNOWN";

    // Existing rows only, by their own real id/unique key — never an
    // upsert, so this can never create a SmartDevice or ProviderDevice row.
    writes.push(
      prisma.smartDevice.update({
        where: { id: enabledDevice.smartDeviceId },
        data: {
          status,
          metadata: toSmartDeviceMetadata(fresh, now) as Prisma.InputJsonValue,
        },
      }),
    );
    writes.push(
      prisma.providerDevice.update({
        where: { id: enabledDevice.id },
        data: {
          connectivityStatus: status,
          rawMetadata: fresh as unknown as Prisma.InputJsonValue,
          lastSeenAt: now,
        },
      }),
    );
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes);
  }

  return { refreshed: writes.length / 2, notReturnedByProvider };
}

export interface CieloRefreshResult {
  /** Existing Cielo SmartDevice rows whose status/lastSeenAt was updated from a fresh read. */
  refreshed: number;
  /** Existing rows Cielo's own listDevices() didn't return this time — left completely untouched, never pruned/disabled. */
  notReturnedByProvider: number;
}

/**
 * Refreshes status for Cielo thermostats that ALREADY have a SmartDevice
 * row — never creates one. Unlike syncCieloDevices(), this never reads
 * CIELO_PROPERTY_MAP and never upserts: it starts from the existing
 * SmartDevice rows themselves (provider = CIELO), so a device that has
 * never been synced/created before is structurally impossible to touch
 * here, regardless of what CIELO_PROPERTY_MAP currently contains.
 *
 * Exactly one real Cielo API call: CieloClient.listDevices() (the same
 * bulk read syncCieloDevices() already uses) — never a per-device call.
 * CieloClient.listDevices() only ever reports {id, name, online} — no
 * temperature/mode/humidity exists to refresh for this provider, so only
 * status/lastSeenAt are written; metadata is deliberately left untouched
 * (never overwritten with a value this provider didn't actually report).
 * `name` is also deliberately left untouched — a display-name change is a
 * sync concern, not a telemetry-refresh one; syncCieloDevices() still owns
 * that.
 */
export async function refreshCieloTelemetry(
  actor: AuthContext,
): Promise<CieloRefreshResult> {
  await assertPermission(actor, "smart_devices:update");

  const username = process.env.CIELO_USERNAME;
  const password = process.env.CIELO_PASSWORD;
  if (!username || !password) {
    throw new Error(
      "Cielo isn't configured — set CIELO_USERNAME and CIELO_PASSWORD.",
    );
  }

  // Existing rows only — this is the entire universe of devices this
  // function can ever touch. A device not yet represented in StayWhile
  // simply never appears here, no matter what CIELO_PROPERTY_MAP contains.
  const existingDevices = await prisma.smartDevice.findMany({
    where: { provider: "CIELO" },
    select: { id: true, externalDeviceId: true },
  });

  if (existingDevices.length === 0) {
    return { refreshed: 0, notReturnedByProvider: 0 };
  }

  const client = new CieloClient({ username, password });
  const freshDevices = await client.listDevices();
  const freshByExternalId = new Map(
    freshDevices.map((device) => [device.id, device]),
  );

  const now = new Date();
  const writes: Prisma.PrismaPromise<unknown>[] = [];
  let notReturnedByProvider = 0;

  for (const existing of existingDevices) {
    const fresh = freshByExternalId.get(existing.externalDeviceId);
    if (!fresh) {
      notReturnedByProvider++;
      continue;
    }

    // Existing row only, by its own real id — never an upsert, so this can
    // never create a SmartDevice row.
    writes.push(
      prisma.smartDevice.update({
        where: { id: existing.id },
        data: {
          status: fresh.online ? "ONLINE" : "OFFLINE",
          lastSeenAt: fresh.online ? now : null,
        },
      }),
    );
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes);
  }

  return { refreshed: writes.length, notReturnedByProvider };
}

/** One provider's outcome from a manual refresh — never masks another provider's result. */
export type ProviderRefreshOutcome =
  | {
      provider: "NEST";
      status: "success";
      refreshed: number;
      notReturnedByProvider: number;
    }
  | { provider: "NEST"; status: "not_configured" }
  | { provider: "NEST"; status: "failure"; error: string }
  | {
      provider: "CIELO";
      status: "success";
      refreshed: number;
      notReturnedByProvider: number;
    }
  | { provider: "CIELO"; status: "not_configured" }
  | { provider: "CIELO"; status: "failure"; error: string };

export interface RefreshThermostatsResult {
  providers: ProviderRefreshOutcome[];
  refreshedAt: string;
}

/** Every provider's own "not configured yet" throw in this codebase uses this exact phrase — see discoverNestDevices/syncCieloDevices/getNestClientFromEnv above. */
function isNotConfiguredError(err: unknown): boolean {
  return err instanceof Error && err.message.includes("isn't configured");
}

async function refreshNestProvider(
  actor: AuthContext,
): Promise<ProviderRefreshOutcome> {
  try {
    const result = await refreshNestTelemetry(actor);
    return {
      provider: "NEST",
      status: "success",
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
    };
  } catch (err) {
    if (isNotConfiguredError(err))
      return { provider: "NEST", status: "not_configured" };
    return {
      provider: "NEST",
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * See refreshCieloTelemetry()'s own doc comment for why this deliberately
 * does NOT call syncCieloDevices() — that function can create a new
 * SmartDevice row (a real upsert keyed on CIELO_PROPERTY_MAP), which
 * "Refresh" must never do.
 */
async function refreshCieloProvider(
  actor: AuthContext,
): Promise<ProviderRefreshOutcome> {
  try {
    const result = await refreshCieloTelemetry(actor);
    return {
      provider: "CIELO",
      status: "success",
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
    };
  } catch (err) {
    if (isNotConfiguredError(err))
      return { provider: "CIELO", status: "not_configured" };
    return {
      provider: "CIELO",
      status: "failure",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * The single entry point behind the /thermostats "Refresh" button.
 * Orchestrates every currently-supported provider, one at a time (Ecobee
 * and Trane have no real client yet — deliberately not attempted here, not
 * even as a "not_configured" row, since there's no real provider branch to
 * report on; see thermostat-refresh follow-up notes). RBAC is checked once,
 * up front — a genuine permission denial throws and propagates normally
 * (same as every other permission check in this app), never silently
 * downgraded to a per-provider "failure" row. Each provider's own call
 * re-checks the same permission redundantly (defense in depth, matching
 * every other service function in this codebase) — harmless, since nothing
 * about the actor's permissions changes between these two checks.
 *
 * One provider throwing (bad credentials, network error, provider-side
 * outage) never prevents the other from running or being reported — each
 * is wrapped in its own try/catch, and both always run.
 */
export async function refreshThermostats(
  actor: AuthContext,
): Promise<RefreshThermostatsResult> {
  await assertPermission(actor, "smart_devices:update");

  const providers: ProviderRefreshOutcome[] = [
    await refreshNestProvider(actor),
    await refreshCieloProvider(actor),
  ];

  return { providers, refreshedAt: new Date().toISOString() };
}
