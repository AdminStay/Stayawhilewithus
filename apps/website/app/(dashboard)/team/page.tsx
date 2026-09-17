import { hasPermission } from "@stayw/auth";
import { PageHeader, SectionHeader } from "@stayw/ui";
import Link from "next/link";

import { formatTimestamp } from "@/domains/smart-devices/lib/format-timestamp";
import { refreshTeamScheduleAction } from "@/domains/team/actions";
import { RefreshScheduleButton } from "@/domains/team/components/RefreshScheduleButton";
import { ScheduleRangeView } from "@/domains/team/components/ScheduleRangeView";
import { UnresolvedIdentities } from "@/domains/team/components/UnresolvedIdentities";
import {
  getScheduleForRange,
  getUnresolvedScheduleIdentities,
  type ScheduleRange,
} from "@/domains/team/services/schedule.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

const RANGE_LABELS: Record<ScheduleRange, string> = {
  today: "Today",
  tomorrow: "Tomorrow",
  week: "Week",
};
const RANGES = Object.keys(RANGE_LABELS) as ScheduleRange[];

function isScheduleRange(value: string | undefined): value is ScheduleRange {
  return value === "today" || value === "tomorrow" || value === "week";
}

export default async function TeamSchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  const actor = await getCurrentUser();
  const { range: rawRange } = await searchParams;
  const range: ScheduleRange = isScheduleRange(rawRange) ? rawRange : "today";

  const result = await getScheduleForRange(actor, range);

  // UX-only gates, same convention as every other canX check in this app —
  // real enforcement is assertPermission("team:manage"/"team:update")
  // inside getUnresolvedScheduleIdentities()/forceRefreshSchedule()
  // themselves.
  const canSeeDiagnostics = await hasPermission(actor, "team:manage");
  const unresolvedIdentities = canSeeDiagnostics
    ? await getUnresolvedScheduleIdentities(actor)
    : [];
  const canRefresh = await hasPermission(actor, "team:update");

  return (
    <div>
      <PageHeader
        title="Team Schedule"
        subtitle="Michelle's VA/team schedule, read directly from its Google Sheet — every time shown here is Central Time."
      />

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex gap-2">
          {RANGES.map((r) => (
            <Link
              key={r}
              href={`/team?range=${r}`}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                r === range
                  ? "bg-forest-600 text-white"
                  : "bg-surface-muted text-ink-muted hover:text-ink"
              }`}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </div>
        {canRefresh && (
          <RefreshScheduleButton action={refreshTeamScheduleAction} />
        )}
      </div>

      {result.lastFetchError ? (
        <p className="mb-4 text-sm text-error-500">
          Couldn&apos;t refresh the schedule — showing the last known data
          {result.lastSyncedAt
            ? ` (as of ${formatTimestamp(result.lastSyncedAt)})`
            : ""}
          .
        </p>
      ) : (
        result.isStale && (
          <p className="mb-4 text-sm text-warning-600">
            Schedule data may be stale
            {result.lastSyncedAt
              ? ` — last synced ${formatTimestamp(result.lastSyncedAt)}`
              : ""}
            .
          </p>
        )
      )}

      <ScheduleRangeView days={result.days} />

      {canSeeDiagnostics && (
        <div className="mt-10">
          <SectionHeader title="Admin diagnostics" size="lg" />
          <UnresolvedIdentities identities={unresolvedIdentities} />
        </div>
      )}
    </div>
  );
}
