/**
 * Automatic thermostat refresh (2026-10-27) — pure rules shared by the cron
 * route, thermostat-refresh.service.ts and the alert check. No I/O here, so
 * every rule is unit-tested directly.
 *
 * Schedule: Vercel Cron every 30 minutes (UTC; Production deployments only).
 * apps/website/vercel.json must carry THERMOSTAT_AUTO_REFRESH_SCHEDULE; a
 * test pins the two together.
 *
 * - Nest: every run. One OAuth token refresh + one devices.list per run —
 *   Google's Sandbox limit for devices.list is 5 per minute, so 2 per hour
 *   is far below it. Skipped when a Nest refresh (manual or automatic)
 *   started in the last NEST_AUTO_MIN_INTERVAL_MS, and paused after a
 *   NEST_AUTH_EXPIRED until a refresh succeeds (the manual Refresh on
 *   /thermostats is the check after reauthorizing — same model as August).
 * - Cielo: at most once per CIELO_AUTO_MIN_INTERVAL_MS (≈ every other run).
 *   CieloClient logs in fresh on every call against Cielo's unofficial,
 *   undocumented API with no published limits, so it gets half the
 *   frequency. After a refused sign-in it waits CIELO_AUTH_RETRY_MS before
 *   trying again (at most 4 sign-in attempts a day while it stays refused),
 *   so repeated failed logins can't pile up against the account.
 */

export const THERMOSTAT_AUTO_REFRESH_SCHEDULE = "*/30 * * * *";

/** IntegrationSyncLog.entityType of one automatic run (on the Nest connection; RUNNING while it works — the overlap guard). */
export const THERMOSTAT_AUTO_REFRESH_ENTITY = "ThermostatAutoRefresh";
/** IntegrationSyncLog.entityType of one automatic Cielo refresh attempt (on the Cielo connection; finished rows only). */
export const CIELO_REFRESH_LOG_ENTITY = "CieloTelemetryRefresh";

export const NEST_AUTO_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const CIELO_AUTO_MIN_INTERVAL_MS = 55 * 60 * 1000;
export const CIELO_AUTH_RETRY_MS = 6 * 60 * 60 * 1000;
/** Failed attempts in a row (per provider) that raise the admin alert. */
export const THERMOSTAT_REFRESH_ALERT_FAILURES = 3;

/** Kill switch: automatic runs happen only when this is exactly "true". */
export function isThermostatAutoRefreshEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.THERMOSTAT_AUTO_REFRESH_ENABLED === "true";
}

export type CieloRefreshFailureCode =
  | "CIELO_AUTH_FAILED"
  | "CIELO_PROVIDER_ERROR"
  | "CIELO_NOT_CONFIGURED"
  | "CIELO_NO_DEVICES_RETURNED"
  | "CIELO_REFRESH_FAILED";

const CIELO_FAILURE_TEXT: Record<CieloRefreshFailureCode, string> = {
  CIELO_AUTH_FAILED: "Cielo refused the sign-in.",
  CIELO_PROVIDER_ERROR: "The Cielo API request failed.",
  CIELO_NOT_CONFIGURED: "Cielo credentials are not configured on the server.",
  CIELO_NO_DEVICES_RETURNED:
    "Cielo returned none of the existing Cielo thermostats, so nothing was refreshed.",
  CIELO_REFRESH_FAILED:
    "The Cielo refresh failed for an unexpected reason (details are in the server logs).",
};

/** The only form a Cielo refresh failure is ever stored in — same shape as formatNestRefreshFailure(). Never Cielo's own text. */
export function formatCieloRefreshFailure(
  code: CieloRefreshFailureCode,
  httpStatus?: number,
): string {
  const status =
    typeof httpStatus === "number" && Number.isInteger(httpStatus)
      ? ` (HTTP ${httpStatus})`
      : "";
  return `${code}: ${CIELO_FAILURE_TEXT[code]}${status}`;
}

export function parseCieloRefreshFailure(
  errorMessage: string | null | undefined,
): CieloRefreshFailureCode | null {
  if (!errorMessage) return null;
  const code = errorMessage.split(":", 1)[0] as CieloRefreshFailureCode;
  return code in CIELO_FAILURE_TEXT ? code : null;
}

/** The fields of an IntegrationSyncLog row these rules look at. */
export interface RefreshAttemptLike {
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL";
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
}

/** FAILED attempts in a row, newest first. RUNNING rows are skipped; anything else ends the streak. */
export function countConsecutiveRefreshFailures(
  attemptsNewestFirst: RefreshAttemptLike[],
): number {
  let count = 0;
  for (const attempt of attemptsNewestFirst) {
    if (attempt.status === "RUNNING") continue;
    if (attempt.status !== "FAILED") break;
    count++;
  }
  return count;
}

export type NestAutoDecision = "run" | "auth_required" | "recently_refreshed";

/**
 * Whether this automatic run calls Google for Nest. `attemptsNewestFirst`
 * are the Nest refresh attempts (manual and automatic) — every one of them
 * is a finished row.
 */
export function decideNestAutoRefresh(
  attemptsNewestFirst: RefreshAttemptLike[],
  now: Date,
  isAuthFailure: (errorMessage: string | null) => boolean,
): NestAutoDecision {
  const latest = attemptsNewestFirst[0];
  if (!latest) return "run";
  // Paused until a later attempt succeeds: the newest attempt that wasn't a
  // plain failure decides. A non-auth failure after an auth failure keeps
  // the pause too (nothing has succeeded since).
  for (const attempt of attemptsNewestFirst) {
    if (attempt.status === "SUCCEEDED") break;
    if (attempt.status === "FAILED" && isAuthFailure(attempt.errorMessage)) {
      return "auth_required";
    }
  }
  if (now.getTime() - latest.startedAt.getTime() < NEST_AUTO_MIN_INTERVAL_MS) {
    return "recently_refreshed";
  }
  return "run";
}

export type CieloAutoDecision = "run" | "auth_retry_wait" | "not_due";

/** Whether this automatic run calls Cielo. `attemptsNewestFirst` are automatic Cielo attempts (finished rows). */
export function decideCieloAutoRefresh(
  attemptsNewestFirst: RefreshAttemptLike[],
  now: Date,
): CieloAutoDecision {
  const latest = attemptsNewestFirst[0];
  if (!latest) return "run";
  const ageMs = now.getTime() - latest.startedAt.getTime();
  if (
    latest.status === "FAILED" &&
    parseCieloRefreshFailure(latest.errorMessage) === "CIELO_AUTH_FAILED" &&
    ageMs < CIELO_AUTH_RETRY_MS
  ) {
    return "auth_retry_wait";
  }
  if (ageMs < CIELO_AUTO_MIN_INTERVAL_MS) return "not_due";
  return "run";
}

export type ThermostatRefreshAlertReason =
  "auth_failed" | "consecutive_failures";

/**
 * Which admin alert (if any) a provider's attempt history calls for. An
 * authorization failure alerts on the first occurrence; any other failure
 * after THERMOSTAT_REFRESH_ALERT_FAILURES in a row. `alreadyAlerted` says
 * whether an alert for that reason already exists since the provider's
 * last successful attempt — one alert per incident.
 */
export function decideThermostatRefreshAlert(input: {
  attemptsNewestFirst: RefreshAttemptLike[];
  isAuthFailure: (errorMessage: string | null) => boolean;
  alreadyAlerted: (reason: ThermostatRefreshAlertReason) => boolean;
}): ThermostatRefreshAlertReason | null {
  const latest = input.attemptsNewestFirst.find((a) => a.status !== "RUNNING");
  if (!latest || latest.status !== "FAILED") return null;
  if (input.isAuthFailure(latest.errorMessage)) {
    return input.alreadyAlerted("auth_failed") ? null : "auth_failed";
  }
  if (
    countConsecutiveRefreshFailures(input.attemptsNewestFirst) >=
      THERMOSTAT_REFRESH_ALERT_FAILURES &&
    !input.alreadyAlerted("consecutive_failures")
  ) {
    return "consecutive_failures";
  }
  return null;
}
