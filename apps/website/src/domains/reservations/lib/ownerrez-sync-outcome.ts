/**
 * What the /reservations status line says about the latest OwnerRez sync
 * (2026-10-28) — pure rules, no I/O.
 *
 * A run's status alone can't say whether it was clean: a SUCCEEDED run may
 * still have skipped bookings (property not linked, guest not resolved,
 * status OwnerRez never documented). Those counts are already saved in the
 * run's `reservation.ownerrez_synced` audit entry; this reads them back.
 * A FAILED run's stored error is free text that can carry provider or
 * database detail, so it is never shown — only a fixed description of its
 * kind.
 */

/** Exception counts of one completed run. `null` = not recorded on that run. */
export interface OwnerRezSyncExceptions {
  unmatchedProperty: number | null;
  guestErrors: number | null;
  unrecognizedStatus: number | null;
  deferred: number | null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

/**
 * Reads the counts from a sync audit entry's afterState. Each field stands
 * on its own: a missing or malformed one is `null` (unknown), never 0.
 * Returns null when the entry holds none of them (no entry, or an older
 * entry shape).
 */
export function parseOwnerRezSyncExceptions(
  afterState: unknown,
): OwnerRezSyncExceptions | null {
  if (
    afterState === null ||
    typeof afterState !== "object" ||
    Array.isArray(afterState)
  ) {
    return null;
  }
  const state = afterState as Record<string, unknown>;
  const exceptions: OwnerRezSyncExceptions = {
    unmatchedProperty: count(state.unmatchedPropertyCount),
    guestErrors: count(state.guestErrorCount),
    unrecognizedStatus: count(state.unrecognizedStatusCount),
    deferred: count(state.guestDeferredCount),
  };
  return Object.values(exceptions).every((v) => v === null) ? null : exceptions;
}

export type OwnerRezSyncResultKind =
  /** Every exception count recorded, and all zero. */
  | "clean"
  /** At least one booking was skipped. */
  | "with_exceptions"
  /**
   * Counts missing (older record, or no audit entry matched the run): never
   * presented as clean — the status line says the counts weren't recorded.
   */
  | "unknown";

export function classifyOwnerRezSyncResult(
  exceptions: OwnerRezSyncExceptions | null,
): OwnerRezSyncResultKind {
  if (!exceptions) return "unknown";
  const { unmatchedProperty, guestErrors, unrecognizedStatus } = exceptions;
  const skipped = [unmatchedProperty, guestErrors, unrecognizedStatus];
  if (skipped.some((n) => n !== null && n > 0)) return "with_exceptions";
  return skipped.every((n) => n === 0) ? "clean" : "unknown";
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

/**
 * One sentence per kind of exception, only for counts recorded and above
 * zero. Unmatched-property and unrecognized-status counts are bookings.
 * Guest errors are not: a guest that couldn't be saved counts once, plus
 * once for each of its bookings, so they are reported as errors, with the
 * consequence (those guests' bookings weren't synced), never as a booking
 * count.
 */
export function describeOwnerRezSyncExceptions(
  exceptions: OwnerRezSyncExceptions,
): string[] {
  const bookings: string[] = [];
  if (exceptions.unmatchedProperty) {
    bookings.push(
      `${plural(exceptions.unmatchedProperty, "booking", "bookings")} on an OwnerRez property not linked in StayWhile`,
    );
  }
  if (exceptions.unrecognizedStatus) {
    bookings.push(
      `${plural(exceptions.unrecognizedStatus, "booking", "bookings")} with an unrecognized OwnerRez status`,
    );
  }
  const sentences: string[] = [];
  if (bookings.length > 0) {
    sentences.push(`Not synced: ${bookings.join(", ")}.`);
  }
  if (exceptions.guestErrors) {
    sentences.push(
      `${plural(exceptions.guestErrors, "guest error", "guest errors")} — bookings for the affected guests weren't synced.`,
    );
  }
  return sentences;
}

/**
 * A safe, fixed description of why a FAILED run failed — never the stored
 * text itself. Only an integer HTTP status is carried over. Unknown errors
 * (database errors, anything unexpected) get a generic line; the full error
 * is in the server log (`sync_failed`).
 */
export function describeOwnerRezSyncFailure(
  errorMessage: string | null,
  deferredMarker: string,
): string | null {
  if (!errorMessage) return null;
  if (errorMessage.startsWith(deferredMarker)) {
    return "OwnerRez's request limit was reached.";
  }
  if (errorMessage.includes("timed out or the process terminated")) {
    return "The sync stopped before finishing (timed out or interrupted).";
  }
  const http = /^Request to .+ failed with (\d{3})$/.exec(errorMessage);
  if (http) {
    const status = Number(http[1]);
    if (status === 401 || status === 403) {
      return `OwnerRez refused StayWhile's credentials (HTTP ${status}).`;
    }
    if (status >= 500) {
      return `OwnerRez had a server error (HTTP ${status}).`;
    }
    return `An OwnerRez request was refused (HTTP ${status}).`;
  }
  if (
    errorMessage.startsWith("OwnerRez returned an unexpected response") ||
    errorMessage.startsWith("OwnerRez returned bookings outside")
  ) {
    return "OwnerRez returned data in an unexpected format.";
  }
  if (
    errorMessage.startsWith("OwnerRez") &&
    errorMessage.includes("pagination")
  ) {
    return "OwnerRez's paging didn't behave as expected.";
  }
  if (errorMessage === "OwnerRez isn't configured.") {
    return "OwnerRez isn't configured on the server.";
  }
  return "An unexpected error stopped the sync (details are in the server logs).";
}
