import {
  classifyOwnerRezSyncResult,
  describeOwnerRezSyncExceptions,
} from "../lib/ownerrez-sync-outcome";
import type { OwnerRezSyncStatus } from "../services/ownerrez-sync-status.service";

/**
 * Read-only OwnerRez sync status for /reservations (2026-09-30): last
 * complete sync, last attempt and its result, the last automatic run, the
 * next expected automatic run, and a stale warning (> 3 hours without a
 * complete sync). Server-rendered; no controls, no data about bookings.
 *
 * 2026-10-28: the latest completed run is described from the counts saved
 * for it:
 *   - "complete, nothing skipped" only when every count was recorded and
 *     is zero;
 *   - "complete with exceptions" plus what wasn't synced when any count is
 *     above zero;
 *   - otherwise (older record, or no saved counts matched) the previous
 *     wording plus "skipped bookings not recorded" — never implied clean.
 * A failure shows a fixed description of its kind, never the stored error.
 */

function ct(date: Date): string {
  return `${new Date(date).toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })} CT`;
}

type Attempt = NonNullable<OwnerRezSyncStatus["lastAttempt"]>;

function describeComplete(attempt: Attempt): string {
  const changed = `${attempt.recordsProcessed} created or changed`;
  switch (classifyOwnerRezSyncResult(attempt.exceptions)) {
    case "clean":
      return `complete, nothing skipped (${changed})`;
    case "with_exceptions":
      return `complete with exceptions (${changed})`;
    case "unknown":
      return `complete (${changed}; skipped bookings not recorded)`;
  }
}

function describeAttempt(attempt: Attempt): string {
  const when = ct(attempt.finishedAt ?? attempt.startedAt);
  switch (attempt.status) {
    case "RUNNING":
      return `running since ${ct(attempt.startedAt)}`;
    case "SUCCEEDED":
      return `${when} — ${describeComplete(attempt)}`;
    case "PARTIAL": {
      const deferred = attempt.exceptions?.deferred;
      return deferred
        ? `${when} — partial: ${deferred} deferred (OwnerRez request limit; the rest is picked up by the next run)`
        : `${when} — partial (OwnerRez request limit; the rest is picked up by the next run)`;
    }
    case "FAILED":
      if (attempt.rateLimited) {
        return `${when} — stopped by the OwnerRez request limit (nothing written; the next run retries)`;
      }
      return attempt.failureReason
        ? `${when} — failed: ${attempt.failureReason}`
        : `${when} — failed`;
  }
}

/** What the latest completed run didn't sync, when any was recorded. */
function exceptionsLine(attempt: Attempt): string | null {
  if (attempt.status !== "SUCCEEDED" && attempt.status !== "PARTIAL") {
    return null;
  }
  if (!attempt.exceptions) return null;
  const sentences = describeOwnerRezSyncExceptions(attempt.exceptions);
  return sentences.length > 0 ? sentences.join(" ") : null;
}

export function OwnerRezSyncStatusLine({
  status,
}: {
  status: OwnerRezSyncStatus;
}) {
  const showStale = status.stale && status.autoSyncEnabled;
  const skipped = status.lastAttempt
    ? exceptionsLine(status.lastAttempt)
    : null;
  return (
    <div
      className="space-y-1 text-xs text-ink-muted"
      data-testid="ownerrez-sync-status"
    >
      <p>
        <span className="font-medium text-ink">Automatic sync:</span>{" "}
        {status.autoSyncEnabled
          ? `on — hourly${status.nextExpectedRunAt ? `, next expected ${ct(status.nextExpectedRunAt)}` : ""}`
          : "off — new or changed OwnerRez bookings appear only after a manual Sync OwnerRez"}
      </p>
      <p>
        <span className="font-medium text-ink">Last complete sync:</span>{" "}
        {status.lastCompleteSyncAt ? ct(status.lastCompleteSyncAt) : "never"}
      </p>
      <p>
        <span className="font-medium text-ink">Last attempt:</span>{" "}
        {status.lastAttempt ? describeAttempt(status.lastAttempt) : "none"}
      </p>
      {skipped && (
        <p className="text-warning-600" data-testid="ownerrez-sync-exceptions">
          {skipped}
        </p>
      )}
      {status.autoSyncEnabled && (
        <p>
          <span className="font-medium text-ink">Last automatic run:</span>{" "}
          {status.lastAutomaticRunAt
            ? ct(status.lastAutomaticRunAt)
            : "none yet"}
        </p>
      )}
      {showStale && (
        <p className="text-warning-600" role="status">
          No complete OwnerRez sync in over 3 hours — reservations may be out of
          date.
          {status.consecutiveFailures > 0
            ? ` The last ${status.consecutiveFailures} ${status.consecutiveFailures === 1 ? "run" : "runs"} failed.`
            : ""}{" "}
          Use Sync OwnerRez below if needed.
        </p>
      )}
    </div>
  );
}
