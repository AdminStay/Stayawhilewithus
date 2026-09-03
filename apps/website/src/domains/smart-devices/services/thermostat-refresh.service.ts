import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import { CieloClient } from "@stayw/integrations/cielo";
import { NestClient, NestOAuthRefreshError } from "@stayw/integrations/nest";

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

/**
 * Every diagnostic line this file (and refreshThermostatsAction in
 * actions.ts) emits goes through this one function, always under the
 * `[thermostat-refresh]` prefix, so a real Production Refresh is
 * conclusively diagnosable from Vercel logs alone. Same convention as the
 * existing `[nest-diag]` log in app/(dashboard)/thermostats/page.tsx —
 * plain console.log, structured JSON, never gated behind anything.
 *
 * Hard rule for every call site below: only non-secret operational facts —
 * actor id, provider name, counts, and status strings/messages that are
 * already returned to the browser via ProviderRefreshOutcome (so if it's
 * safe to show a VA in the UI, it's safe to log). Never a credential, env
 * value, token, raw provider payload, or full API response. See
 * thermostat-refresh.service.test.ts's dedicated secret-safety tests for
 * the enforced proof.
 */
export function logThermostatRefresh(
  event: string,
  data: Record<string, unknown> = {},
): void {
  console.log(
    "[thermostat-refresh]",
    JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }),
  );
}

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
  logThermostatRefresh("nest_eligible_rows", {
    actorUserId: actor.userId,
    eligibleCount: enabledDevices.length,
  });

  if (enabledDevices.length === 0) {
    logThermostatRefresh("nest_no_eligible_rows", {
      actorUserId: actor.userId,
    });
    return { refreshed: 0, notReturnedByProvider: 0 };
  }

  // The one and only real Nest API call this function makes — a bulk read,
  // never a per-device call, and never anything but a read (no command
  // method is imported into this file).
  const freshDevices = await client.listDevices();
  logThermostatRefresh("nest_devices_returned", {
    actorUserId: actor.userId,
    returnedCount: freshDevices.length,
  });
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
  } else {
    // Distinct, explicitly named case: the provider call succeeded and
    // returned devices, but none of them matched an eligible row by
    // externalDeviceId — worth telling apart from "provider returned
    // nothing at all" or "provider call failed."
    logThermostatRefresh("nest_zero_matched", {
      actorUserId: actor.userId,
      eligibleCount: enabledDevices.length,
      returnedCount: freshDevices.length,
    });
  }

  logThermostatRefresh("nest_refresh_completed", {
    actorUserId: actor.userId,
    refreshed: writes.length / 2,
    notReturnedByProvider,
  });

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
  logThermostatRefresh("cielo_eligible_rows", {
    actorUserId: actor.userId,
    eligibleCount: existingDevices.length,
  });

  if (existingDevices.length === 0) {
    logThermostatRefresh("cielo_no_eligible_rows", {
      actorUserId: actor.userId,
    });
    return { refreshed: 0, notReturnedByProvider: 0 };
  }

  const client = new CieloClient({ username, password });
  const freshDevices = await client.listDevices();
  logThermostatRefresh("cielo_devices_returned", {
    actorUserId: actor.userId,
    returnedCount: freshDevices.length,
  });
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
  } else {
    logThermostatRefresh("cielo_zero_matched", {
      actorUserId: actor.userId,
      eligibleCount: existingDevices.length,
      returnedCount: freshDevices.length,
    });
  }

  logThermostatRefresh("cielo_refresh_completed", {
    actorUserId: actor.userId,
    refreshed: writes.length,
    notReturnedByProvider,
  });

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
  logThermostatRefresh("provider_start", {
    actorUserId: actor.userId,
    provider: "NEST",
  });
  try {
    const result = await refreshNestTelemetry(actor);
    const outcome: ProviderRefreshOutcome = {
      provider: "NEST",
      status: "success",
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
    };
    logThermostatRefresh("provider_outcome", {
      actorUserId: actor.userId,
      ...outcome,
    });
    return outcome;
  } catch (err) {
    if (isNotConfiguredError(err)) {
      logThermostatRefresh("provider_outcome", {
        actorUserId: actor.userId,
        provider: "NEST",
        status: "not_configured",
      });
      return { provider: "NEST", status: "not_configured" };
    }
    // A failed OAuth token refresh carries a much richer, still-fully-
    // sanitized diagnostic (HTTP status, Google's own short error code/
    // description, and credential-presence/whitespace booleans — never a
    // credential value) — logged here, server-side only, under its own
    // event name, and deliberately NEVER folded into `error` below. Google's
    // error_description is real free-text authored by Google, not something
    // this codebase controls the wording of — surfacing it straight to a
    // dashboard user would be "excessive Google response information," not
    // a safe/generic UI error, so it stays log-only.
    if (err instanceof NestOAuthRefreshError) {
      logThermostatRefresh("nest_oauth_error_diagnostic", {
        actorUserId: actor.userId,
        ...err.diagnostic,
      });
    }
    // Same message ProviderRefreshOutcome.error already carries back to the
    // browser via RefreshThermostatsButton — already safe to show a VA, so
    // already safe to log. Never the raw thrown object, only its message
    // (HttpClient-shaped errors in this codebase are always "Request to
    // ... failed with <status>" — never a credential value; a
    // NestOAuthRefreshError's own message is the same generic
    // "Nest OAuth token refresh failed with <status>" shape, unchanged by
    // the diagnostic addition above).
    const error = err instanceof Error ? err.message : String(err);
    logThermostatRefresh("provider_outcome", {
      actorUserId: actor.userId,
      provider: "NEST",
      status: "failure",
      error,
    });
    return { provider: "NEST", status: "failure", error };
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
  logThermostatRefresh("provider_start", {
    actorUserId: actor.userId,
    provider: "CIELO",
  });
  try {
    const result = await refreshCieloTelemetry(actor);
    const outcome: ProviderRefreshOutcome = {
      provider: "CIELO",
      status: "success",
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
    };
    logThermostatRefresh("provider_outcome", {
      actorUserId: actor.userId,
      ...outcome,
    });
    return outcome;
  } catch (err) {
    if (isNotConfiguredError(err)) {
      logThermostatRefresh("provider_outcome", {
        actorUserId: actor.userId,
        provider: "CIELO",
        status: "not_configured",
      });
      return { provider: "CIELO", status: "not_configured" };
    }
    const error = err instanceof Error ? err.message : String(err);
    logThermostatRefresh("provider_outcome", {
      actorUserId: actor.userId,
      provider: "CIELO",
      status: "failure",
      error,
    });
    return { provider: "CIELO", status: "failure", error };
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
  logThermostatRefresh("refresh_requested", { actorUserId: actor.userId });

  // Logged explicitly at this exact boundary — the project has unresolved
  // history (see the `[nest-diag]` diagnostic still in
  // app/(dashboard)/thermostats/page.tsx, added for a real, still-open Nest
  // permission discrepancy) of a computed "can do this" check disagreeing
  // with actual enforcement. This makes the real, enforced Refresh
  // authorization outcome directly visible in logs, independent of what the
  // page's own button-visibility check (a separate hasPermission call)
  // decided.
  try {
    await assertPermission(actor, "smart_devices:update");
  } catch (err) {
    logThermostatRefresh("permission_denied", {
      actorUserId: actor.userId,
      permission: "smart_devices:update",
    });
    throw err;
  }
  logThermostatRefresh("permission_granted", {
    actorUserId: actor.userId,
    permission: "smart_devices:update",
  });

  const providers: ProviderRefreshOutcome[] = [
    await refreshNestProvider(actor),
    await refreshCieloProvider(actor),
  ];

  logThermostatRefresh("refresh_completed", {
    actorUserId: actor.userId,
    providers: providers.map((p) => ({
      provider: p.provider,
      status: p.status,
    })),
  });

  return { providers, refreshedAt: new Date().toISOString() };
}
