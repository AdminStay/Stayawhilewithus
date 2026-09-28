import { AlertTriangle, CheckCircle2 } from "lucide-react";

import { formatTimestamp } from "../lib/format-timestamp";
import type { NestHealthSummary } from "../lib/nest-health";

const toDate = (iso: string | null) => (iso ? new Date(iso) : null);

/**
 * Nest connection/freshness banner for /thermostats (2026-09-27, Nest
 * Phase 1). Read-only, no controls. Never lets old Nest telemetry pass as
 * current: whenever the state isn't "ok" it says why, when Nest last
 * refreshed successfully, when a refresh was last attempted, and how old
 * the newest reading is.
 */
export function NestHealthBanner({ health }: { health: NestHealthSummary }) {
  if (health.state === "no_devices") return null;
  const problem = health.state !== "ok";
  return (
    <div
      role={problem ? "alert" : "status"}
      className={`rounded-lg border p-3 text-sm ${
        problem
          ? "border-2 border-warning-500 bg-warning-50"
          : "border-border bg-surface"
      }`}
    >
      <div className="flex items-start gap-2">
        {problem ? (
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning-600" />
        ) : (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success-600" />
        )}
        <div className="space-y-1">
          <p
            className={problem ? "font-semibold text-warning-700" : "text-ink"}
          >
            {health.headline ?? "Nest readings are current."}
          </p>
          <p className="text-xs text-ink-muted">
            Newest Nest reading:{" "}
            {formatTimestamp(toDate(health.newestReadingAt))}
            {" · "}Last successful refresh:{" "}
            {health.lastSucceededAt
              ? formatTimestamp(toDate(health.lastSucceededAt))
              : "not recorded yet"}
            {" · "}Last attempted refresh:{" "}
            {health.lastAttemptAt
              ? `${formatTimestamp(toDate(health.lastAttemptAt))} (${health.lastAttemptOk ? "succeeded" : "failed"})`
              : "not recorded yet"}
          </p>
        </div>
      </div>
    </div>
  );
}
