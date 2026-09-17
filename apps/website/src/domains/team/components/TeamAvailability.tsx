import { Badge, EmptyState, SectionHeader } from "@stayw/ui";
import { Users } from "lucide-react";
import type { ReactNode } from "react";

import { formatTimestamp } from "@/domains/smart-devices/lib/format-timestamp";

/**
 * What this component renders. `sourceKey` is the exact identity as
 * Michelle's schedule source itself states it (a real first name) — shown
 * directly, per the standing instruction that the dashboard may display
 * exact source names as schedule assignments without claiming they're
 * authenticated-user identities. `mapped` says only whether this source
 * identity has a confirmed link to a real StayWhile login (see
 * team-identity-mapping.ts) — display-only, and never used to hide an
 * entry; an unmapped person is still shown by name, just without implying
 * they can sign in as anyone.
 */
export interface TeamAvailabilityDisplayEntry {
  sourceKey: string;
  mapped: boolean;
  /** Role/team label exactly as the source prints it, e.g. "Operations", "MOD", "EA" — informational only, never used for access control. */
  role?: string | null;
  /** Pre-formatted Chicago time, e.g. "until 5:00 PM" or "2:00 PM – 6:00 PM" — this component does no timezone/date math itself. */
  timeLabel?: string | null;
}

export interface TeamAvailabilityProps {
  lastSyncedAt: Date | null;
  isStale: boolean;
  /** Reason the most recent fetch attempt failed, if any — the data shown may still be from an earlier successful fetch (see isStale for how old). */
  lastFetchError: string | null;
  workingNow: TeamAvailabilityDisplayEntry[];
  comingUp: TeamAvailabilityDisplayEntry[];
  off: TeamAvailabilityDisplayEntry[];
  /** Count of entries above with no confirmed StayWhile user mapping — informational only, never used to hide anyone. */
  unmappedCount: number;
  /** Optional header action slot, e.g. a "View schedule" link to the dedicated /team page — same convention as the Notion/OwnerRez dashboard widgets. */
  action?: ReactNode;
}

function PersonRow({ entry }: { entry: TeamAvailabilityDisplayEntry }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">
          {entry.sourceKey}
        </span>
        {entry.role && (
          <span className="block truncate text-xs text-ink-muted">
            {entry.role}
          </span>
        )}
      </span>
      {entry.timeLabel && (
        <span className="shrink-0 text-xs text-ink-muted">
          {entry.timeLabel}
        </span>
      )}
    </li>
  );
}

function Group({
  title,
  entries,
  emptyLabel,
}: {
  title: string;
  entries: TeamAvailabilityDisplayEntry[];
  emptyLabel: string;
}) {
  if (entries.length === 0) {
    return (
      <div>
        <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
          {title}
        </h3>
        <p className="mt-1 text-sm text-ink-faint">{emptyLabel}</p>
      </div>
    );
  }

  return (
    <div>
      <h3 className="text-xs font-medium uppercase tracking-wide text-ink-muted">
        {title}
      </h3>
      <ul className="mt-1 divide-y divide-border">
        {entries.map((entry) => (
          <PersonRow key={entry.sourceKey} entry={entry} />
        ))}
      </ul>
    </div>
  );
}

/**
 * Purely presentational — every list is already fully computed by the
 * caller (see getTeamAvailabilitySnapshot() in schedule.service.ts); this
 * component does no fetching, no Google Sheets access, no identity
 * resolution, and renders no write/mutation control of any kind. The "CT"
 * badge appears once in the section header, not per-row, per the
 * "don't clutter every row with timezone labels" instruction — every time
 * shown anywhere in this component is already Chicago time.
 */
export function TeamAvailability({
  lastSyncedAt,
  isStale,
  lastFetchError,
  workingNow,
  comingUp,
  off,
  unmappedCount,
  action,
}: TeamAvailabilityProps) {
  const hasAnyone =
    workingNow.length > 0 || comingUp.length > 0 || off.length > 0;

  return (
    <div>
      <SectionHeader
        title="Team Availability"
        size="lg"
        action={action}
        description={
          lastFetchError
            ? `Couldn't refresh the schedule — showing the last known data (${lastSyncedAt ? formatTimestamp(lastSyncedAt) : "never synced"}).`
            : lastSyncedAt
              ? `Last synced ${formatTimestamp(lastSyncedAt)} · Central Time`
              : "Central Time"
        }
      />

      {lastFetchError ? (
        <Badge tone="error" className="mb-3">
          Schedule source unavailable
        </Badge>
      ) : (
        isStale && (
          <Badge tone="warning" className="mb-3">
            Possibly stale
          </Badge>
        )
      )}

      {!hasAnyone ? (
        <EmptyState
          icon={Users}
          title="No team schedule yet"
          description={
            lastFetchError
              ? "The schedule source hasn't been reached yet."
              : "Nobody is on today's schedule."
          }
        />
      ) : (
        <div className="space-y-4">
          <Group
            title="Working now"
            entries={workingNow}
            emptyLabel="Nobody currently on shift."
          />
          <Group
            title="Coming up"
            entries={comingUp}
            emptyLabel="No upcoming shifts today."
          />
          <Group title="Off" entries={off} emptyLabel="Nobody marked off." />
        </div>
      )}

      {unmappedCount > 0 && (
        <p className="mt-3 text-xs text-ink-faint">
          {unmappedCount} of the names above{" "}
          {unmappedCount === 1 ? "isn't" : "aren't"} yet linked to a StayWhile
          login.
        </p>
      )}
    </div>
  );
}
