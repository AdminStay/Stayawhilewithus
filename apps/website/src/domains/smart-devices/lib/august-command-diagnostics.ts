import type { AugustLockDetail } from "@stayw/integrations/august";
import { HttpRequestError } from "@stayw/integrations/core";

/**
 * Sanitized diagnostics for one real August lock command (2026-10-13).
 *
 * Why: five AMBIGUOUS results after an acknowledged PUT (Island SOS, Island
 * Tides Man Cave, Ocean Pearl Spa, Riverside Château, Royal Eden) have no
 * recorded poll trace, so delayed reporting, `valid:false`/unknown readings,
 * swallowed read errors and non-execution can't be told apart. This records
 * WHAT the acknowledgement and each confirmation read reported, stored as
 * `metadata.diagnostics` on the existing `smart_device.august_lock_command`
 * audit row.
 *
 * Diagnostic only. Nothing reads this to decide an outcome, eligibility or
 * block — SUCCEEDED/AMBIGUOUS/FAILED classification, the one-PUT/no-retry
 * rule, polling timing and the admin-reset-after-physical-check requirement
 * are all unchanged. Later telemetry never resolves an AMBIGUOUS result.
 *
 * Security: built ONLY from the explicit allow-list below — never a
 * response body, header, error message, URL, lock id, serial number,
 * credential, PIN or provider free-text message. Provider strings must be
 * short identifier-shaped tokens (anything else is stored as null), and
 * timestamps are re-serialized from a parsed date. Size is bounded: at most
 * CONFIRMATION_POLL_ATTEMPTS poll entries, each of fixed keys.
 */

/*
 * LOCK STATUS TIMESTAMP (investigated 2026-10-13, not acted on): it would
 * be tempting to require a confirming reading's `LockStatus.dateTime` to be
 * later than the acknowledgement, so a stale cached state can't confirm a
 * command. That is NOT done, because it would change command behavior and
 * isn't yet safe: (1) the timestamp comes from August's cloud/bridge clock
 * and the acknowledgement time from this server's clock, with skew of
 * unknown size; (2) whether August refreshes `dateTime` on every report, or
 * only on a state change, is unverified; (3) the existing match rule already
 * rejects the OLD state, and the already-in-state check refuses a command
 * whose target state was already reported. `lockStatusAtMinusAckMs` records
 * the difference per read so real commands can show whether such a check
 * would be reliable before anyone proposes one.
 */

export const AUGUST_COMMAND_DIAGNOSTICS_VERSION = 1;

/** Coarse class of a failed request — never its message. */
export type AugustRequestErrorClass = "http" | "timeout" | "network" | "other";

export interface AugustCommandAckDiagnostics {
  /** acknowledged = 2xx; http_error = August answered non-2xx; no_response = abort/network. */
  outcome: "acknowledged" | "http_error" | "no_response";
  httpStatus: number | null;
  /** PUT round-trip time as measured by this server. */
  elapsedMs: number;
  /** This server's clock when the 2xx acknowledgement arrived; null otherwise. */
  receivedAt: string | null;
  errorClass: AugustRequestErrorClass | null;
  providerErrorCode: string | null;
}

export type AugustConfirmationPollDiagnostics =
  | {
      attempt: number;
      outcome: "read_ok";
      /** When the read started, relative to the acknowledgement. */
      msSinceAck: number;
      durationMs: number;
      /** Raw `LockStatus.status` (e.g. "locked" / "unknown"). */
      lockStatus: string | null;
      lockStatusValid: boolean | null;
      /** Raw `LockStatus.dateTime` (August's clock), re-serialized. */
      lockStatusAt: string | null;
      /**
       * lockStatusAt minus this server's acknowledgement time, in ms.
       * INFORMATIONAL ONLY — see LOCK STATUS TIMESTAMP below. Never used
       * to accept or reject a reading.
       */
      lockStatusAtMinusAckMs: number | null;
      unknownReason: string | null;
      doorState: string | null;
      /** Exactly the existing confirmation check's result for this read. */
      matchedExpected: boolean;
    }
  | {
      attempt: number;
      outcome: "read_error";
      msSinceAck: number;
      durationMs: number;
      errorClass: AugustRequestErrorClass;
      httpStatus: number | null;
      providerErrorCode: string | null;
    }
  | {
      attempt: number;
      /** Not started: it couldn't finish inside the command time budget. */
      outcome: "skipped_budget";
      msSinceAck: number;
    };

export interface AugustCommandDiagnostics {
  version: typeof AUGUST_COMMAND_DIAGNOSTICS_VERSION;
  /** From the start of the command flow until just before the PUT was sent. */
  preCommandMs: number;
  /** The fresh pre-command read's valid lock state (null = not valid/unknown). */
  preCommandLockState: string | null;
  preCommandLockStatusAt: string | null;
  ack: AugustCommandAckDiagnostics;
  polls: AugustConfirmationPollDiagnostics[];
  budgetMs: number;
  /** True when a confirmation read was skipped because the budget ran out. */
  deadlineReached: boolean;
}

const MAX_TOKEN_LENGTH = 64;
const SAFE_TOKEN = /^[A-Za-z0-9_.:-]+$/;

/**
 * A provider-reported identifier-shaped value ("locked",
 * "unknown_error_during_connect", "closed", an error code), or null. Free
 * text, long values and non-strings are dropped rather than truncated, so a
 * provider message can never end up stored here.
 */
export function safeDiagnosticToken(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const str = String(value);
  if (str.length === 0 || str.length > MAX_TOKEN_LENGTH) return null;
  return SAFE_TOKEN.test(str) ? str : null;
}

/** A parseable timestamp re-serialized as ISO, or null — never the raw string. */
export function safeDiagnosticTimestamp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function safeMs(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

function safeHttpStatus(value: unknown): number | null {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 100 &&
    value <= 599
    ? value
    : null;
}

export function classifyAugustRequestError(
  err: unknown,
): AugustRequestErrorClass {
  if (err instanceof HttpRequestError) return "http";
  const name =
    typeof err === "object" && err !== null && "name" in err
      ? (err as { name?: unknown }).name
      : undefined;
  if (name === "AbortError" || name === "TimeoutError") return "timeout";
  if (err instanceof TypeError) return "network";
  return "other";
}

/** A 2xx acknowledgement (`httpStatus`), or a PUT that threw (`error`). */
export function buildAckDiagnostics(
  args:
    | { httpStatus: number | null; elapsedMs: number; receivedAtMs: number }
    | { error: unknown; elapsedMs: number },
): AugustCommandAckDiagnostics {
  if ("error" in args) {
    const httpError =
      args.error instanceof HttpRequestError ? args.error : null;
    return {
      outcome: httpError ? "http_error" : "no_response",
      httpStatus: httpError ? safeHttpStatus(httpError.status) : null,
      elapsedMs: safeMs(args.elapsedMs),
      receivedAt: null,
      errorClass: classifyAugustRequestError(args.error),
      providerErrorCode: httpError
        ? safeDiagnosticToken(httpError.providerErrorCode)
        : null,
    };
  }
  return {
    outcome: "acknowledged",
    httpStatus: safeHttpStatus(args.httpStatus),
    elapsedMs: safeMs(args.elapsedMs),
    receivedAt: new Date(args.receivedAtMs).toISOString(),
    errorClass: null,
    providerErrorCode: null,
  };
}

export function buildReadOkPoll(args: {
  attempt: number;
  msSinceAck: number;
  durationMs: number;
  detail: AugustLockDetail;
  matchedExpected: boolean;
  ackReceivedAtMs: number;
}): AugustConfirmationPollDiagnostics {
  const health = args.detail.health;
  const lockStatusAt = safeDiagnosticTimestamp(health?.lockStatusAt);
  return {
    attempt: args.attempt,
    outcome: "read_ok",
    msSinceAck: safeMs(args.msSinceAck),
    durationMs: safeMs(args.durationMs),
    lockStatus: safeDiagnosticToken(health?.lockStatus),
    lockStatusValid:
      typeof health?.lockStatusValid === "boolean"
        ? health.lockStatusValid
        : null,
    lockStatusAt,
    lockStatusAtMinusAckMs:
      lockStatusAt === null
        ? null
        : Date.parse(lockStatusAt) - args.ackReceivedAtMs,
    unknownReason: safeDiagnosticToken(health?.unknownReason),
    doorState: safeDiagnosticToken(health?.doorState),
    matchedExpected: args.matchedExpected,
  };
}

export function buildReadErrorPoll(args: {
  attempt: number;
  msSinceAck: number;
  durationMs: number;
  error: unknown;
}): AugustConfirmationPollDiagnostics {
  const httpError = args.error instanceof HttpRequestError ? args.error : null;
  return {
    attempt: args.attempt,
    outcome: "read_error",
    msSinceAck: safeMs(args.msSinceAck),
    durationMs: safeMs(args.durationMs),
    errorClass: classifyAugustRequestError(args.error),
    httpStatus: httpError ? safeHttpStatus(httpError.status) : null,
    providerErrorCode: httpError
      ? safeDiagnosticToken(httpError.providerErrorCode)
      : null,
  };
}

export function buildSkippedPoll(args: {
  attempt: number;
  msSinceAck: number;
}): AugustConfirmationPollDiagnostics {
  return {
    attempt: args.attempt,
    outcome: "skipped_budget",
    msSinceAck: safeMs(args.msSinceAck),
  };
}
