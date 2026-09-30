import type { OwnerRezSyncStatus } from "../services/ownerrez-sync-status.service";

/**
 * Read-only OwnerRez sync status for /reservations (2026-09-30): last
 * complete sync, last attempt and its result, the last automatic run, the
 * next expected automatic run, and a stale warning (> 3 hours without a
 * complete sync). Server-rendered; no controls, no data about bookings.
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

function describeAttempt(
  attempt: NonNullable<OwnerRezSyncStatus["lastAttempt"]>,
): string {
  const when = ct(attempt.finishedAt ?? attempt.startedAt);
  switch (attempt.status) {
    case "RUNNING":
      return `running since ${ct(attempt.startedAt)}`;
    case "SUCCEEDED":
      return `${when} — complete (${attempt.recordsProcessed} created or changed)`;
    case "PARTIAL":
      return `${when} — partial (OwnerRez request limit; the rest is picked up by the next run)`;
    case "FAILED":
      return attempt.rateLimited
        ? `${when} — stopped by the OwnerRez request limit (nothing written; the next run retries)`
        : `${when} — failed`;
  }
}

export function OwnerRezSyncStatusLine({
  status,
}: {
  status: OwnerRezSyncStatus;
}) {
  const showStale = status.stale && status.autoSyncEnabled;
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
