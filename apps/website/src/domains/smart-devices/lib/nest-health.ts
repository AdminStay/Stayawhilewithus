/**
 * Nest refresh health (2026-09-27, Nest Phase 1). Pure helpers shared by
 * the refresh service (which records a sanitized result for every Nest
 * refresh attempt as an IntegrationSyncLog row) and /thermostats (which
 * must never present old Nest telemetry as if it were current).
 *
 * The stored `errorMessage` is always one of the fixed sentences below,
 * prefixed with a stable code — never a token, credential, raw Google
 * response, request body or project/device identifier.
 */

/** IntegrationSyncLog.entityType for a /thermostats Nest telemetry refresh (distinct from discovery / Sync Now rows on the same connection). */
export const NEST_REFRESH_LOG_ENTITY = "NestTelemetryRefresh";

/** A thermostat reading older than this is shown as stale (same 24 h as the platform's telemetry staleness rule). */
export const THERMOSTAT_READING_STALE_MS = 24 * 60 * 60 * 1000;

export type NestRefreshFailureCode =
  | "NEST_AUTH_EXPIRED"
  | "NEST_PROVIDER_ERROR"
  | "NEST_NOT_CONFIGURED"
  | "NEST_REFRESH_FAILED";

const FAILURE_TEXT: Record<NestRefreshFailureCode, string> = {
  NEST_AUTH_EXPIRED:
    "Google authorization for Nest has expired or been revoked. Nest must be reauthorized before any Nest data can refresh.",
  NEST_PROVIDER_ERROR: "The Google Nest API request failed.",
  NEST_NOT_CONFIGURED: "Nest credentials are not configured on the server.",
  NEST_REFRESH_FAILED:
    "The Nest refresh failed for an unexpected reason (details are in the server logs).",
};

/** The only form a Nest refresh failure is ever stored in. `httpStatus` is a number or nothing — never free text. */
export function formatNestRefreshFailure(
  code: NestRefreshFailureCode,
  httpStatus?: number,
): string {
  const status =
    typeof httpStatus === "number" && Number.isInteger(httpStatus)
      ? ` (HTTP ${httpStatus})`
      : "";
  return `${code}: ${FAILURE_TEXT[code]}${status}`;
}

export function parseNestRefreshFailure(
  errorMessage: string | null | undefined,
): NestRefreshFailureCode | null {
  if (!errorMessage) return null;
  const code = errorMessage.split(":", 1)[0] as NestRefreshFailureCode;
  return code in FAILURE_TEXT ? code : null;
}

export function isThermostatReadingStale(
  readingAt: Date | null,
  now: Date,
): boolean {
  return (
    readingAt === null ||
    now.getTime() - readingAt.getTime() > THERMOSTAT_READING_STALE_MS
  );
}

export interface NestRefreshAttempt {
  status: "SUCCEEDED" | "FAILED" | string;
  finishedAt: string | null;
  errorMessage: string | null;
}

export interface NestHealthInput {
  lastAttempt: NestRefreshAttempt | null;
  lastSucceededAt: string | null;
  /** Newest telemetry time across the Nest thermostats shown on /thermostats. */
  newestReadingAt: string | null;
  nestThermostatCount: number;
  now: Date;
}

export type NestHealthState =
  "ok" | "needs_reauthorization" | "refresh_failing" | "stale" | "no_devices";

export interface NestHealthSummary {
  state: NestHealthState;
  headline: string | null;
  lastSucceededAt: string | null;
  lastAttemptAt: string | null;
  lastAttemptOk: boolean | null;
  newestReadingAt: string | null;
}

/**
 * Worst-first: a recorded authorization failure, then any other failed last
 * attempt, then readings older than 24 h (or none at all). Before the first
 * recorded refresh (no log rows yet), the state still comes from the actual
 * age of the readings — so old data is flagged immediately, without anyone
 * having to trigger a refresh.
 */
export function summarizeNestHealth(input: NestHealthInput): NestHealthSummary {
  const base = {
    lastSucceededAt: input.lastSucceededAt,
    lastAttemptAt: input.lastAttempt?.finishedAt ?? null,
    lastAttemptOk: input.lastAttempt
      ? input.lastAttempt.status === "SUCCEEDED"
      : null,
    newestReadingAt: input.newestReadingAt,
  };
  if (input.nestThermostatCount === 0) {
    return { state: "no_devices", headline: null, ...base };
  }
  const failed = input.lastAttempt && input.lastAttempt.status === "FAILED";
  const code = failed
    ? parseNestRefreshFailure(input.lastAttempt?.errorMessage)
    : null;
  if (failed && code === "NEST_AUTH_EXPIRED") {
    return {
      state: "needs_reauthorization",
      headline:
        "Nest connection needs attention: Google authorization has expired or been revoked. Nest readings cannot refresh until Nest is reauthorized.",
      ...base,
    };
  }
  if (failed) {
    return {
      state: "refresh_failing",
      headline: `The last Nest refresh failed${code ? ` (${FAILURE_TEXT[code].replace(/\.$/, "")})` : ""}. Nest readings may be out of date.`,
      ...base,
    };
  }
  const newest = input.newestReadingAt ? new Date(input.newestReadingAt) : null;
  if (isThermostatReadingStale(newest, input.now)) {
    return {
      state: "stale",
      headline:
        "Nest readings are stale. They are older than 24 hours and may not reflect current conditions.",
      ...base,
    };
  }
  return { state: "ok", headline: null, ...base };
}
