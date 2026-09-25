import { Badge, Card, type Tone } from "@stayw/ui";
import { ShieldAlert } from "lucide-react";

import { formatTimestamp } from "../lib/format-timestamp";
import type { LockHealthFlag, LockHealthSeverity } from "../lib/lock-health";

export interface LockHealthRow {
  smartDeviceId: string;
  propertyName: string;
  lockName: string;
  flags: LockHealthFlag[];
}

const SEVERITY_TONE: Record<LockHealthSeverity, Tone> = {
  red: "error",
  orange: "warning",
  yellow: "gold",
};

const SEVERITY_ORDER: Record<LockHealthSeverity, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
};

/**
 * "Needs attention" list for /locks (2026-09-25 lock-health monitoring).
 * Shows ONLY locks with at least one flag, worst first, each with the
 * underlying reason and the relevant timestamp. Read-only: no controls.
 */
export function LockHealthPanel({ rows }: { rows: LockHealthRow[] }) {
  const actionable = rows
    .filter((row) => row.flags.length > 0)
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.flags[0]!.severity] -
          SEVERITY_ORDER[b.flags[0]!.severity] ||
        a.propertyName.localeCompare(b.propertyName),
    );

  return (
    <Card>
      <div className="flex items-center gap-2">
        <ShieldAlert className="h-4 w-4 text-ink-muted" />
        <h2 className="text-sm font-semibold text-ink">
          Lock health — needs attention ({actionable.length})
        </h2>
      </div>
      {actionable.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          No lock health exceptions right now.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {actionable.map((row) => (
            <li key={row.smartDeviceId} className="py-2">
              <p className="text-sm font-medium text-ink">
                {row.propertyName}{" "}
                <span className="font-normal text-ink-muted">
                  — {row.lockName}
                </span>
              </p>
              <ul className="mt-1 space-y-1">
                {row.flags.map((flag) => (
                  <li
                    key={flag.code}
                    className="flex flex-wrap items-baseline gap-2 text-xs"
                  >
                    <Badge tone={SEVERITY_TONE[flag.severity]}>
                      {flag.label}
                    </Badge>
                    <span className="text-ink-muted">{flag.detail}</span>
                    {flag.since && (
                      <span className="text-ink-faint">
                        since {formatTimestamp(new Date(flag.since))}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
