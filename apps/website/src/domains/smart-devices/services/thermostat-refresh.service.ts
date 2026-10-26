import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import { CieloClient } from "@stayw/integrations/cielo";
import { HttpRequestError } from "@stayw/integrations/core";
import { NestClient, NestOAuthRefreshError } from "@stayw/integrations/nest";

import {
  formatNestRefreshFailure,
  NEST_REFRESH_LOG_ENTITY,
  parseNestRefreshFailure,
  type NestRefreshAttempt,
} from "../lib/nest-health";
import {
  CIELO_REFRESH_LOG_ENTITY,
  type CieloAutoDecision,
  decideCieloAutoRefresh,
  decideNestAutoRefresh,
  formatCieloRefreshFailure,
  isThermostatAutoRefreshEnabled,
  type NestAutoDecision,
  THERMOSTAT_AUTO_REFRESH_ENTITY,
} from "../lib/thermostat-auto-refresh";

import {
  toCieloSmartDeviceMetadata,
  toSmartDeviceMetadata,
} from "./provider-devices.service";

import {
  ensureConnectionRows,
  STALE_RUNNING_THRESHOLD_MS,
} from "@/domains/integrations/services/integrations.service";

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
 * conclusively diagnosable from Vercel logs alone — plain console.log,
 * structured JSON, never gated behind anything.
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
  return runNestTelemetryRefresh(actor.userId);
}

/**
 * refreshNestTelemetry()'s body, without the RBAC check — reached only
 * through refreshNestTelemetry() (RBAC-checked) or the automatic, CRON_SECRET-
 * protected refreshThermostatsAutomatic() below. Deliberately not exported.
 */
async function runNestTelemetryRefresh(
  actorUserId: string,
): Promise<NestRefreshResult> {
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
    actorUserId,
    eligibleCount: enabledDevices.length,
  });

  if (enabledDevices.length === 0) {
    logThermostatRefresh("nest_no_eligible_rows", {
      actorUserId,
    });
    return { refreshed: 0, notReturnedByProvider: 0 };
  }

  // The one and only real Nest API call this function makes — a bulk read,
  // never a per-device call, and never anything but a read (no command
  // method is imported into this file).
  const freshDevices = await client.listDevices();
  logThermostatRefresh("nest_devices_returned", {
    actorUserId,
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
      actorUserId,
      eligibleCount: enabledDevices.length,
      returnedCount: freshDevices.length,
    });
  }

  logThermostatRefresh("nest_refresh_completed", {
    actorUserId,
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
 * CieloClient.listDevices() now also reports current/target temperature,
 * mode, fan speed, humidity, power, and a telemetry timestamp when the
 * device confirms Fahrenheit units (see parseCieloDevice(),
 * packages/integrations/src/cielo/client.ts, for the exact fail-safe
 * extraction) — written into `metadata` via the same
 * toCieloSmartDeviceMetadata() "only set what's present" mapper every
 * other provider already uses. `name` is deliberately left untouched — a
 * display-name change is a sync concern, not a telemetry-refresh one;
 * syncCieloDevices() still owns that.
 */
export async function refreshCieloTelemetry(
  actor: AuthContext,
): Promise<CieloRefreshResult> {
  await assertPermission(actor, "smart_devices:update");
  return runCieloTelemetryRefresh(actor.userId);
}

/** refreshCieloTelemetry()'s body, without the RBAC check — same reachability rule as runNestTelemetryRefresh(). Not exported. */
async function runCieloTelemetryRefresh(
  actorUserId: string,
): Promise<CieloRefreshResult> {
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
    actorUserId,
    eligibleCount: existingDevices.length,
  });

  if (existingDevices.length === 0) {
    logThermostatRefresh("cielo_no_eligible_rows", {
      actorUserId,
    });
    return { refreshed: 0, notReturnedByProvider: 0 };
  }

  const client = new CieloClient({ username, password });
  const freshDevices = await client.listDevices();
  logThermostatRefresh("cielo_devices_returned", {
    actorUserId,
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
    // never create a SmartDevice row. metadata is written unconditionally
    // (even when `fresh.online` is false) — connectivity and telemetry are
    // independent facts Cielo reports independently, same discipline as
    // August's refresh never withholding battery/lock-state based on
    // connectivity.
    writes.push(
      prisma.smartDevice.update({
        where: { id: existing.id },
        data: {
          status: fresh.online ? "ONLINE" : "OFFLINE",
          lastSeenAt: fresh.online ? now : null,
          metadata: toCieloSmartDeviceMetadata(fresh) as Prisma.InputJsonValue,
        },
      }),
    );
  }

  if (writes.length > 0) {
    await prisma.$transaction(writes);
  } else {
    logThermostatRefresh("cielo_zero_matched", {
      actorUserId,
      eligibleCount: existingDevices.length,
      returnedCount: freshDevices.length,
    });
  }

  logThermostatRefresh("cielo_refresh_completed", {
    actorUserId,
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

/**
 * Sanitized, stable classification of a Nest refresh failure (2026-09-27,
 * Nest Phase 1). Only Google's standard OAuth `error` code and an HTTP
 * status number are ever looked at — never a message, token or response
 * body — and the stored text is one of nest-health.ts's fixed sentences.
 */
export function classifyNestRefreshFailure(err: unknown): string {
  if (isNotConfiguredError(err)) {
    return formatNestRefreshFailure("NEST_NOT_CONFIGURED");
  }
  if (err instanceof NestOAuthRefreshError) {
    return err.diagnostic.oauthError === "invalid_grant"
      ? formatNestRefreshFailure("NEST_AUTH_EXPIRED")
      : formatNestRefreshFailure(
          "NEST_PROVIDER_ERROR",
          err.diagnostic.httpStatus,
        );
  }
  if (err instanceof HttpRequestError) {
    return formatNestRefreshFailure("NEST_PROVIDER_ERROR", err.status);
  }
  return formatNestRefreshFailure("NEST_REFRESH_FAILED");
}

/**
 * One durable IntegrationSyncLog row per Nest refresh attempt, written only
 * after the attempt has finished (never a RUNNING row, so it can't interact
 * with the Sync Now/Discover overlap guard on the same connection). Needs an
 * existing Nest connection row — never creates one. A logging failure is
 * reported in the server log and never changes the refresh's own outcome.
 */
async function recordNestRefreshAttempt(
  args: RefreshAttemptRecord,
): Promise<void> {
  await recordRefreshAttempt("NEST", NEST_REFRESH_LOG_ENTITY, args);
}

interface RefreshAttemptRecord {
  startedAt: Date;
  status: "SUCCEEDED" | "FAILED";
  recordsProcessed?: number;
  errorMessage?: string;
}

/** Shared by the Nest and (automatic) Cielo attempt records — same rules: finished rows only, existing connection only, never throws. */
async function recordRefreshAttempt(
  provider: "NEST" | "CIELO",
  entityType: string,
  args: RefreshAttemptRecord,
): Promise<void> {
  try {
    const connection = await prisma.integrationConnection.findUnique({
      where: { provider },
      select: { id: true },
    });
    if (!connection) return;
    await prisma.integrationSyncLog.create({
      data: {
        integrationConnectionId: connection.id,
        direction: "INBOUND",
        entityType,
        status: args.status,
        startedAt: args.startedAt,
        finishedAt: new Date(),
        recordsProcessed: args.recordsProcessed ?? 0,
        errorMessage: args.errorMessage ?? null,
      },
    });
  } catch (logErr) {
    logThermostatRefresh(
      provider === "NEST"
        ? "nest_refresh_log_write_failed"
        : "cielo_refresh_log_write_failed",
      { error: logErr instanceof Error ? logErr.name : "unknown" },
    );
  }
}

/**
 * Sanitized, stable classification of a Cielo refresh failure (2026-10-27,
 * automatic refresh) — the Cielo counterpart of classifyNestRefreshFailure().
 * Only an HTTP status number is ever kept, never Cielo's own message text
 * (CieloClient's login error carries it).
 */
export function classifyCieloRefreshFailure(err: unknown): string {
  if (isNotConfiguredError(err)) {
    return formatCieloRefreshFailure("CIELO_NOT_CONFIGURED");
  }
  if (err instanceof HttpRequestError) {
    return err.status === 401 || err.status === 403
      ? formatCieloRefreshFailure("CIELO_AUTH_FAILED", err.status)
      : formatCieloRefreshFailure("CIELO_PROVIDER_ERROR", err.status);
  }
  if (err instanceof Error && err.message.startsWith("Cielo login failed")) {
    return formatCieloRefreshFailure("CIELO_AUTH_FAILED");
  }
  return formatCieloRefreshFailure("CIELO_REFRESH_FAILED");
}

export interface NestRefreshHealthRecord {
  lastAttempt: NestRefreshAttempt | null;
  lastSucceededAt: string | null;
}

/** Read-only: the latest recorded Nest refresh attempt and last success, for /thermostats. Never creates rows or calls Google. */
export async function getNestRefreshHealthRecord(
  actor: AuthContext,
): Promise<NestRefreshHealthRecord> {
  await assertPermission(actor, "smart_devices:read");
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: "NEST" },
    select: { id: true },
  });
  if (!connection) return { lastAttempt: null, lastSucceededAt: null };
  const where = {
    integrationConnectionId: connection.id,
    entityType: NEST_REFRESH_LOG_ENTITY,
  };
  const [lastAttempt, lastSucceeded] = await Promise.all([
    prisma.integrationSyncLog.findFirst({
      where,
      orderBy: { startedAt: "desc" },
      select: { status: true, finishedAt: true, errorMessage: true },
    }),
    prisma.integrationSyncLog.findFirst({
      where: { ...where, status: "SUCCEEDED" },
      orderBy: { startedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  return {
    lastAttempt: lastAttempt
      ? {
          status: lastAttempt.status,
          finishedAt: lastAttempt.finishedAt?.toISOString() ?? null,
          errorMessage: lastAttempt.errorMessage,
        }
      : null,
    lastSucceededAt: lastSucceeded?.finishedAt?.toISOString() ?? null,
  };
}

/**
 * One provider's refresh: the outcome the dashboard shows, plus — on any
 * failure — the sanitized stored form (formatNestRefreshFailure /
 * formatCieloRefreshFailure: a fixed code and sentence, never provider text)
 * that the automatic run reports and alerts on.
 */
interface ProviderAttempt {
  outcome: ProviderRefreshOutcome;
  failure: string | null;
}

async function refreshNestProvider(
  actorUserId: string,
  run: () => Promise<NestRefreshResult>,
): Promise<ProviderAttempt> {
  logThermostatRefresh("provider_start", {
    actorUserId,
    provider: "NEST",
  });
  const startedAt = new Date();
  try {
    const result = await run();
    await recordNestRefreshAttempt({
      startedAt,
      status: "SUCCEEDED",
      recordsProcessed: result.refreshed,
    });
    const outcome: ProviderRefreshOutcome = {
      provider: "NEST",
      status: "success",
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
    };
    logThermostatRefresh("provider_outcome", {
      actorUserId,
      ...outcome,
    });
    return { outcome, failure: null };
  } catch (err) {
    const failure = classifyNestRefreshFailure(err);
    await recordNestRefreshAttempt({
      startedAt,
      status: "FAILED",
      errorMessage: failure,
    });
    if (isNotConfiguredError(err)) {
      logThermostatRefresh("provider_outcome", {
        actorUserId,
        provider: "NEST",
        status: "not_configured",
      });
      return {
        outcome: { provider: "NEST", status: "not_configured" },
        failure,
      };
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
        actorUserId,
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
      actorUserId,
      provider: "NEST",
      status: "failure",
      error,
    });
    return { outcome: { provider: "NEST", status: "failure", error }, failure };
  }
}

/**
 * See refreshCieloTelemetry()'s own doc comment for why this deliberately
 * does NOT call syncCieloDevices() — that function can create a new
 * SmartDevice row (a real upsert keyed on CIELO_PROPERTY_MAP), which
 * "Refresh" must never do.
 */
async function refreshCieloProvider(
  actorUserId: string,
  run: () => Promise<CieloRefreshResult>,
  options: { recordAttempt?: boolean } = {},
): Promise<ProviderAttempt> {
  logThermostatRefresh("provider_start", {
    actorUserId,
    provider: "CIELO",
  });
  const startedAt = new Date();
  try {
    const result = await run();
    if (options.recordAttempt) {
      await recordRefreshAttempt("CIELO", CIELO_REFRESH_LOG_ENTITY, {
        startedAt,
        status: "SUCCEEDED",
        recordsProcessed: result.refreshed,
      });
    }
    const outcome: ProviderRefreshOutcome = {
      provider: "CIELO",
      status: "success",
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
    };
    logThermostatRefresh("provider_outcome", {
      actorUserId,
      ...outcome,
    });
    return { outcome, failure: null };
  } catch (err) {
    const failure = classifyCieloRefreshFailure(err);
    if (options.recordAttempt) {
      await recordRefreshAttempt("CIELO", CIELO_REFRESH_LOG_ENTITY, {
        startedAt,
        status: "FAILED",
        errorMessage: failure,
      });
    }
    if (isNotConfiguredError(err)) {
      logThermostatRefresh("provider_outcome", {
        actorUserId,
        provider: "CIELO",
        status: "not_configured",
      });
      return {
        outcome: { provider: "CIELO", status: "not_configured" },
        failure,
      };
    }
    const error = err instanceof Error ? err.message : String(err);
    logThermostatRefresh("provider_outcome", {
      actorUserId,
      provider: "CIELO",
      status: "failure",
      error,
    });
    return {
      outcome: { provider: "CIELO", status: "failure", error },
      failure,
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
  logThermostatRefresh("refresh_requested", { actorUserId: actor.userId });

  // Logged explicitly at this exact boundary — the project has history
  // (HANDOFF.md Increment 38, a Nest permission discrepancy; its temporary
  // page-level diagnostic was removed 2026-09-27) of a computed "can do
  // this" check disagreeing with actual enforcement. This makes the real, enforced Refresh
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
    (await refreshNestProvider(actor.userId, () => refreshNestTelemetry(actor)))
      .outcome,
    (
      await refreshCieloProvider(actor.userId, () =>
        refreshCieloTelemetry(actor),
      )
    ).outcome,
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

/** What one automatic run did for one provider — counts and fixed codes only, never a device id or provider text. */
export type AutomaticProviderResult =
  | { status: "success"; refreshed: number; notReturnedByProvider: number }
  | { status: "failed"; code: string }
  | { status: "not_configured" }
  | {
      status: "skipped";
      reason: NestAutoDecision | CieloAutoDecision;
    };

export type AutomaticThermostatRefreshOutcome =
  | { status: "disabled" }
  | { status: "already_running" }
  | {
      status: "completed";
      nest: AutomaticProviderResult;
      cielo: AutomaticProviderResult;
    };

/** A provider attempt as the automatic run reports it: a failure becomes only the code part of its stored "CODE: sentence (HTTP n)" text. */
function toAutomaticResult(attempt: ProviderAttempt): AutomaticProviderResult {
  const { outcome } = attempt;
  if (outcome.status === "success") {
    return {
      status: "success",
      refreshed: outcome.refreshed,
      notReturnedByProvider: outcome.notReturnedByProvider,
    };
  }
  if (outcome.status === "not_configured") return { status: "not_configured" };
  return {
    status: "failed",
    code: attempt.failure?.split(":", 1)[0] ?? "REFRESH_FAILED",
  };
}

const AUTO_REFRESH_ACTOR = "system:thermostat-auto-refresh";
/** Advisory-lock namespace of the automatic run's claim — its own, so it never contends with the August/Cielo `integration_sync` lock. */
const AUTO_REFRESH_LOCK_NAME = "thermostat_auto_refresh";
const RECENT_ATTEMPTS = 10;

const attemptSelect = {
  status: true,
  startedAt: true,
  finishedAt: true,
  errorMessage: true,
} as const;

function isNestAuthFailure(errorMessage: string | null): boolean {
  return parseNestRefreshFailure(errorMessage) === "NEST_AUTH_EXPIRED";
}

/**
 * Automatic, scheduled thermostat refresh (2026-10-27) — the
 * CRON_SECRET-protected counterpart of the /thermostats Refresh button, run
 * by /api/cron/thermostat-refresh. There is no signed-in user: the route's
 * bearer check is the authorization boundary (same as the August and
 * OwnerRez scheduled jobs), and the provider work is the same read-only
 * runNestTelemetryRefresh()/runCieloTelemetryRefresh() the button uses —
 * existing rows only, never a create/map/delete, never a command.
 *
 * 1. THERMOSTAT_AUTO_REFRESH_ENABLED must be exactly "true", checked before
 *    any database or provider call.
 * 2. Claim (one short transaction, no network inside): a transaction-scoped
 *    advisory lock, then the overlap check — a RUNNING
 *    THERMOSTAT_AUTO_REFRESH_ENTITY row younger than
 *    STALE_RUNNING_THRESHOLD_MS means another run is working (skip); an
 *    older one is a crashed run, closed as FAILED. The per-provider
 *    decisions (thermostat-auto-refresh.ts) are read inside the same claim.
 * 3. Providers run one at a time, outside the transaction. Nest records its
 *    attempt exactly like a manual refresh (so the /thermostats banner
 *    reflects automatic runs too); Cielo's automatic attempts are recorded
 *    as CIELO_REFRESH_LOG_ENTITY rows.
 * 4. The run row is closed SUCCEEDED / PARTIAL / FAILED with a summary made
 *    only of provider names, statuses, counts and fixed codes.
 *
 * The manual button deliberately stays outside this claim: its behavior is
 * unchanged, and a manual refresh overlapping an automatic one only writes
 * the same provider data twice.
 */
export async function refreshThermostatsAutomatic(
  now: Date = new Date(),
): Promise<AutomaticThermostatRefreshOutcome> {
  if (!isThermostatAutoRefreshEnabled()) {
    logThermostatRefresh("auto_refresh_disabled", {});
    return { status: "disabled" };
  }

  await ensureConnectionRows();
  const [nestConnection, cieloConnection] = await Promise.all([
    prisma.integrationConnection.findUniqueOrThrow({
      where: { provider: "NEST" },
      select: { id: true },
    }),
    prisma.integrationConnection.findUniqueOrThrow({
      where: { provider: "CIELO" },
      select: { id: true },
    }),
  ]);

  type Claim =
    | { proceeding: false }
    | {
        proceeding: true;
        runId: string;
        nest: NestAutoDecision;
        cielo: CieloAutoDecision;
      };
  const claim = await prisma.$transaction(async (tx): Promise<Claim> => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext(${AUTO_REFRESH_LOCK_NAME}), hashtext(${nestConnection.id})) AS locked
    `;
    if (!lockRows[0]?.locked) return { proceeding: false };

    const running = await tx.integrationSyncLog.findFirst({
      where: {
        integrationConnectionId: nestConnection.id,
        entityType: THERMOSTAT_AUTO_REFRESH_ENTITY,
        status: "RUNNING",
      },
      orderBy: { startedAt: "desc" },
    });
    if (running) {
      if (
        now.getTime() - running.startedAt.getTime() <
        STALE_RUNNING_THRESHOLD_MS
      ) {
        return { proceeding: false };
      }
      await tx.integrationSyncLog.update({
        where: { id: running.id },
        data: {
          status: "FAILED",
          errorMessage:
            "Automatic thermostat refresh timed out or the process terminated unexpectedly.",
          finishedAt: now,
        },
      });
    }

    const [nestAttempts, cieloAttempts] = await Promise.all([
      tx.integrationSyncLog.findMany({
        where: {
          integrationConnectionId: nestConnection.id,
          entityType: NEST_REFRESH_LOG_ENTITY,
        },
        orderBy: { startedAt: "desc" },
        take: RECENT_ATTEMPTS,
        select: attemptSelect,
      }),
      tx.integrationSyncLog.findMany({
        where: {
          integrationConnectionId: cieloConnection.id,
          entityType: CIELO_REFRESH_LOG_ENTITY,
        },
        orderBy: { startedAt: "desc" },
        take: 1,
        select: attemptSelect,
      }),
    ]);

    const run = await tx.integrationSyncLog.create({
      data: {
        integrationConnectionId: nestConnection.id,
        direction: "INBOUND",
        entityType: THERMOSTAT_AUTO_REFRESH_ENTITY,
        status: "RUNNING",
        startedAt: now,
      },
    });
    return {
      proceeding: true,
      runId: run.id,
      nest: decideNestAutoRefresh(nestAttempts, now, isNestAuthFailure),
      cielo: decideCieloAutoRefresh(cieloAttempts, now),
    };
  });

  if (!claim.proceeding) {
    logThermostatRefresh("auto_refresh_skipped_already_running", {});
    return { status: "already_running" };
  }

  logThermostatRefresh("auto_refresh_started", {
    nest: claim.nest,
    cielo: claim.cielo,
  });

  let nest: AutomaticProviderResult = { status: "skipped", reason: claim.nest };
  let cielo: AutomaticProviderResult = {
    status: "skipped",
    reason: claim.cielo,
  };
  try {
    if (claim.nest === "run") {
      nest = toAutomaticResult(
        await refreshNestProvider(AUTO_REFRESH_ACTOR, () =>
          runNestTelemetryRefresh(AUTO_REFRESH_ACTOR),
        ),
      );
    }
    if (claim.cielo === "run") {
      cielo = toAutomaticResult(
        await refreshCieloProvider(
          AUTO_REFRESH_ACTOR,
          () => runCieloTelemetryRefresh(AUTO_REFRESH_ACTOR),
          { recordAttempt: true },
        ),
      );
    }
  } finally {
    await finishAutomaticRun(claim.runId, nest, cielo);
  }

  logThermostatRefresh("auto_refresh_completed", { nest, cielo });
  return { status: "completed", nest, cielo };
}

function summarizeAutomaticResult(
  provider: string,
  result: AutomaticProviderResult,
): string {
  switch (result.status) {
    case "success":
      return `${provider}=success(${result.refreshed})`;
    case "failed":
      return `${provider}=failed(${result.code})`;
    case "not_configured":
      return `${provider}=not_configured`;
    case "skipped":
      return `${provider}=skipped(${result.reason})`;
  }
}

/** Closes the run row. Never throws — a failed close is logged, and the RUNNING row then ages out through the stale-claim path. */
async function finishAutomaticRun(
  runId: string,
  nest: AutomaticProviderResult,
  cielo: AutomaticProviderResult,
): Promise<void> {
  const attempted = [nest, cielo].filter((r) => r.status !== "skipped");
  const failed = attempted.filter(
    (r) => r.status === "failed" || r.status === "not_configured",
  ).length;
  const status =
    failed === 0
      ? "SUCCEEDED"
      : failed === attempted.length
        ? "FAILED"
        : "PARTIAL";
  const refreshed = [nest, cielo].reduce(
    (sum, r) => sum + (r.status === "success" ? r.refreshed : 0),
    0,
  );
  try {
    await prisma.integrationSyncLog.update({
      where: { id: runId },
      data: {
        status,
        finishedAt: new Date(),
        recordsProcessed: refreshed,
        errorMessage: `${summarizeAutomaticResult("nest", nest)} ${summarizeAutomaticResult("cielo", cielo)}`,
      },
    });
  } catch (err) {
    logThermostatRefresh("auto_refresh_finish_failed", {
      error: err instanceof Error ? err.name : "unknown",
    });
  }
}
