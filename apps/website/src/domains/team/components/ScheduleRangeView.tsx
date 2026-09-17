import { EmptyState } from "@stayw/ui";
import { CalendarDays } from "lucide-react";

/** One already-merged, already-Chicago-time-formatted shift block — see getScheduleForRange() in schedule.service.ts. */
export interface ScheduleRangeShiftDisplayEntry {
  sourceKey: string;
  mapped: boolean;
  role: string;
  timeLabel: string;
}

export interface ScheduleRangeDayDisplay {
  dateLabel: string;
  entries: ScheduleRangeShiftDisplayEntry[];
}

/**
 * The dedicated /team page's day-by-day shift list — purely presentational,
 * every entry already resolved/merged/formatted by the caller. No fetching,
 * no timezone math, no write/mutation affordance of any kind.
 */
export function ScheduleRangeView({
  days,
}: {
  days: ScheduleRangeDayDisplay[];
}) {
  const hasAnyEntry = days.some((day) => day.entries.length > 0);

  if (!hasAnyEntry) {
    return (
      <EmptyState
        icon={CalendarDays}
        title="No shifts in this range"
        description="Nobody is scheduled for the selected days."
      />
    );
  }

  return (
    <div className="space-y-6">
      {days.map((day) => (
        <div key={day.dateLabel}>
          <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
            {day.dateLabel}
          </h3>
          {day.entries.length === 0 ? (
            <p className="mt-1 text-sm text-ink-faint">Nobody scheduled.</p>
          ) : (
            <ul className="mt-1 divide-y divide-border rounded-card border border-border">
              {day.entries.map((entry, i) => (
                <li
                  key={`${entry.sourceKey}-${i}`}
                  className="flex items-center justify-between gap-3 px-4 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {entry.sourceKey}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {entry.role}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-muted">
                    {entry.timeLabel}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
    </div>
  );
}
