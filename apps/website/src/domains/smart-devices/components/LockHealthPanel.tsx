import { Badge, Card, type Tone } from "@stayw/ui";
import { ShieldAlert } from "lucide-react";

import { formatTimestamp } from "../lib/format-timestamp";
import {
  buildDailyLockReport,
  formatDailyLockReportText,
  SEVERITY_LABELS,
  type LockReportRow,
} from "../lib/lock-daily-report";
import type { LockHealthSeverity } from "../lib/lock-health";

import { CopyTextButton } from "./CopyTextButton";

export type LockHealthRow = LockReportRow;

const SEVERITY_TONE: Record<LockHealthSeverity, Tone> = {
  red: "error",
  orange: "warning",
  yellow: "gold",
};

const fmt = (iso: string) => formatTimestamp(new Date(iso));

/**
 * Daily lock report for /locks (2026-09-29; replaces the 2026-09-25 "Needs
 * attention" list in place). One line per problem, worst first: property,
 * lock, severity, problem, detail, since/duration (trusted start times only)
 * or last reading, New (began in the last 24 h), and the recommended Ops
 * action. Read-only: no controls; Copy only copies text.
 */
export function LockHealthPanel({
  rows,
  now,
}: {
  rows: LockHealthRow[];
  /** When the page read the data (ISO); drives durations and New. */
  now: string;
}) {
  const report = buildDailyLockReport(rows, new Date(now));
  const text = formatDailyLockReportText(report, {
    generatedAt: fmt(now),
    formatTime: fmt,
  });

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-ink-muted" />
          <h2 className="text-sm font-semibold text-ink">
            Daily lock report — needs attention ({report.locksNeedingAttention})
          </h2>
        </div>
        <CopyTextButton label="Copy daily lock report" text={text} />
      </div>
      <p
        aria-label="Daily lock report summary"
        className="mt-1 text-xs text-ink-muted"
      >
        {report.items.length} items · Urgent {report.counts.red} · High{" "}
        {report.counts.orange} · Routine {report.counts.yellow} · New in last 24
        h {report.newCount}. Actions are for the Ops team onsite or in the
        August app — nothing here runs automatically.
      </p>
      {report.items.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">
          No lock health exceptions right now.
        </p>
      ) : (
        <ol className="mt-3 divide-y divide-border">
          {report.items.map((item) => (
            <li
              key={`${item.smartDeviceId}:${item.code}`}
              className="space-y-0.5 py-2 text-xs"
            >
              <p className="flex flex-wrap items-center gap-2">
                <Badge tone={SEVERITY_TONE[item.severity]}>
                  {SEVERITY_LABELS[item.severity]}
                </Badge>
                {item.isNew && <Badge tone="info">New</Badge>}
                <span className="text-sm font-medium text-ink">
                  {item.propertyName}
                </span>
                <span className="text-ink-muted">— {item.lockName}</span>
                <span className="font-medium text-ink">{item.problem}</span>
              </p>
              {item.detail && <p className="text-ink-muted">{item.detail}</p>}
              {item.startedAt ? (
                <p className="text-ink-faint">
                  Since {fmt(item.startedAt)} ({item.duration ?? "just now"})
                </p>
              ) : item.lastReadingAt ? (
                <p className="text-ink-faint">
                  Last reading {fmt(item.lastReadingAt)}
                </p>
              ) : null}
              <p className="text-ink">
                <span className="font-medium">Action:</span> {item.action}
              </p>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
