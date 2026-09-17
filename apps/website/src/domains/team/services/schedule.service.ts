import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";

import {
  deriveAvailability,
  isScheduleDataStale,
  mergeContiguousShifts,
  type AvailabilityStatus,
  type PersonAvailability,
} from "./availability";
import {
  addCalendarDays,
  calendarDayWindowUtc,
  formatCalendarDateLabel,
  formatChicagoTime,
  formatChicagoTimeRange,
  getCalendarDateInZone,
  SCHEDULE_TIMEZONE,
  type CalendarDate,
} from "./chicago-date";
import { parseCsv } from "./csv";
import {
  beginScheduleSync,
  finishScheduleSync,
  getLastSyncAttempt,
  readDurableSnapshot,
  writeDurableSnapshot,
  type DurableScheduleSnapshot,
} from "./schedule-persistence";
import { fetchScheduleSheetCsv } from "./schedule-source";
import { parseScheduleGrid, toNormalizedShifts } from "./sheet-schedule-parser";
import { resolveTeamMember } from "./team-identity-mapping";

/**
 * A person as the schedule SOURCE identifies them — deliberately distinct
 * from an authenticated StayWhile `User`. Most of the 24 real people in
 * Michelle's sheet have no StayWhile login at all today (see README.md),
 * and requiring one before the schedule could work would make this feature
 * depend on an account-creation decision it has no business depending on.
 * `stayWhileUserId` comes only from resolveTeamMember()'s existing,
 * deliberately-manual, no-fuzzy-matching lookup — `null` means genuinely
 * unmapped, not "broken."
 */
export interface SchedulePerson {
  sourceKey: string;
  stayWhileUserId: string | null;
}

// Reuse window: how long a successful fetch is trusted before a NEW request
// triggers a real re-fetch attempt, rather than serving the in-memory
// micro-cache — keeps rapid consecutive page loads from hammering Google's
// export endpoint. Stale threshold: how old the durable last-known-good
// snapshot can get before the UI flags it as possibly out of date, even
// though it's still the best data available (never silently replaced with
// empty). Both are placeholders pending a real StayWhile decision on
// refresh cadence (see README.md) — not the result of researched Google
// rate limits. Mirrors the same category of decision
// TELEMETRY_STALE_THRESHOLD_MS already makes for device telemetry
// (smart-devices.service.ts).
const CACHE_REUSE_WINDOW_MS = 5 * 60 * 1000;
const SCHEDULE_STALE_THRESHOLD_MS = 60 * 60 * 1000;

// In-memory micro-cache IN FRONT OF the durable database row
// (schedule-persistence.ts) — purely a perf optimization so a burst of
// requests within CACHE_REUSE_WINDOW_MS doesn't each pay a DB round-trip
// (let alone a live Google fetch). It is NOT the source of truth: it
// resets on server restart/cold start exactly like the old design did, but
// unlike the old design, getSnapshot() below falls back to the real
// database row when this is empty — so a restart no longer means "no
// schedule data until someone gets lucky with a fresh fetch," it means
// "read what's already durably known," which is the actual fix for
// "does not provide durable last-known-good state."
let memCache: DurableScheduleSnapshot | null = null;

/**
 * Runs exactly one real sync attempt: begin (advisory-locked, records a
 * RUNNING IntegrationSyncLog row) → fetch the Sheet → parse → validate →
 * on success, durably persist and finish SUCCEEDED; on any failure, finish
 * FAILED and leave the durable last-known-good snapshot untouched. Callable
 * from ANY trigger with no actor/RBAC involved — see schedule-persistence.
 * ts's own doc comment for why (a scheduled job has no signed-in user).
 * Manual refresh (forceRefreshSchedule) and a future scheduled/cron trigger
 * both call this same function; RBAC is enforced by forceRefreshSchedule
 * itself, before it ever reaches here.
 */
export async function runScheduleSync(): Promise<void> {
  const begin = await beginScheduleSync();
  if (begin.alreadyRunning) {
    // Another attempt (manual or automatic) is genuinely in flight right
    // now — nothing to do; that attempt will update the durable snapshot
    // when it finishes.
    return;
  }

  const result = await fetchScheduleSheetCsv();
  if (!result.ok) {
    await finishScheduleSync(begin.logId, {
      status: "FAILED",
      errorMessage: `${result.reason}: ${result.detail}`,
    });
    return;
  }

  const rows = parseCsv(result.csvText);
  const { slots, warnings } = parseScheduleGrid(rows);
  if (slots.length === 0) {
    // A fetch that succeeds but yields zero parseable slots is far more
    // likely to mean the source's own structure shifted than that the real
    // schedule is genuinely empty — deliberately does NOT touch the
    // durable snapshot; showing older real data with a failure banner is
    // safer than replacing it with a false "nobody is scheduled."
    await finishScheduleSync(begin.logId, {
      status: "FAILED",
      errorMessage:
        "MALFORMED_SCHEDULE: The export fetched successfully but no recognizable schedule slots were found in it.",
    });
    return;
  }

  const fetchedAt = new Date();
  const shifts = toNormalizedShifts(slots, SCHEDULE_TIMEZONE);
  await writeDurableSnapshot(shifts, warnings, fetchedAt);
  await finishScheduleSync(begin.logId, {
    status: "SUCCEEDED",
    recordsProcessed: shifts.length,
  });
  memCache = { shifts, warnings, fetchedAt };
}

async function getSnapshot(): Promise<DurableScheduleSnapshot | null> {
  const isFresh =
    memCache !== null &&
    Date.now() - memCache.fetchedAt.getTime() < CACHE_REUSE_WINDOW_MS;
  if (isFresh) return memCache;

  await runScheduleSync();
  if (memCache) return memCache;

  // The attempt above either failed, or found another sync already in
  // flight and no-op'd — either way, fall back to the durable last-known-
  // good row in the database. This is what survives a server restart: the
  // in-memory cache is gone, but the database row isn't.
  const durable = await readDurableSnapshot();
  if (durable) {
    memCache = durable;
    return durable;
  }
  return null;
}

/** Forces a real re-fetch regardless of the reuse window — the manual "Refresh" control's only job. Read-only against the source; only ever writes this app's own durable sync state, never the Sheet itself. */
export async function forceRefreshSchedule(actor: AuthContext): Promise<void> {
  await assertPermission(actor, "team:update");
  await runScheduleSync();
}

export interface ScheduleFetchStatus {
  lastSyncedAt: Date | null;
  isStale: boolean;
  /** Human-readable reason the most recent fetch attempt failed — null when the most recent attempt succeeded, even if that was a while ago (see isStale for that). */
  lastFetchError: string | null;
}

async function getFetchStatus(): Promise<ScheduleFetchStatus> {
  const [snapshot, lastAttempt] = await Promise.all([
    getSnapshot(),
    getLastSyncAttempt(),
  ]);
  return {
    lastSyncedAt: snapshot?.fetchedAt ?? null,
    isStale: isScheduleDataStale(
      snapshot?.fetchedAt ?? null,
      new Date(),
      SCHEDULE_STALE_THRESHOLD_MS,
    ),
    lastFetchError:
      lastAttempt?.status === "FAILED" ? lastAttempt.errorMessage : null,
  };
}

export interface TeamAvailabilityEntry {
  person: SchedulePerson;
  status: AvailabilityStatus;
  role: string | null;
  /** Pre-formatted in Chicago time, e.g. "until 6:00 PM" or "2:00 PM – 6:00 PM" — callers do no further time math. */
  timeLabel: string | null;
}

export interface TeamAvailabilitySnapshot extends ScheduleFetchStatus {
  workingNow: TeamAvailabilityEntry[];
  comingUp: TeamAvailabilityEntry[];
  off: TeamAvailabilityEntry[];
  /** Count of entries above (across all three groups) whose source identity has no confirmed StayWhile user mapping yet — informational only, never used to hide anyone. */
  unmappedCount: number;
}

function toEntry(a: PersonAvailability): TeamAvailabilityEntry {
  const shift = a.currentShift ?? a.nextShift;
  return {
    person: {
      sourceKey: a.personKey,
      stayWhileUserId: resolveTeamMember(a.personKey),
    },
    status: a.status,
    role: shift?.label ?? null,
    timeLabel:
      a.status === "WORKING_NOW" && a.currentShift
        ? `until ${formatChicagoTime(a.currentShift.end)}`
        : a.status === "SCHEDULED_LATER" && a.nextShift
          ? formatChicagoTimeRange(a.nextShift.start, a.nextShift.end)
          : null,
  };
}

/**
 * The dashboard "Team Availability" widget's data, for `now` (real instant,
 * defaults to the actual current time). "Today" for OFF/scheduled purposes
 * is today's CHICAGO calendar day, not the server's or browser's — a shift
 * that crosses midnight is included via overlap, not exact-day membership,
 * so someone still on an 11 PM–7 AM shift correctly shows as WORKING_NOW
 * shortly after midnight.
 */
export async function getTeamAvailabilitySnapshot(
  actor: AuthContext,
  now: Date = new Date(),
): Promise<TeamAvailabilitySnapshot> {
  await assertPermission(actor, "team:read");
  const status = await getFetchStatus();
  const snapshot = await getSnapshot();

  if (!snapshot) {
    return {
      ...status,
      workingNow: [],
      comingUp: [],
      off: [],
      unmappedCount: 0,
    };
  }

  const chicagoToday = getCalendarDateInZone(now, SCHEDULE_TIMEZONE);
  const todayWindow = calendarDayWindowUtc(chicagoToday, SCHEDULE_TIMEZONE);

  // Merged BEFORE deriving availability, not just for the dedicated range
  // view — otherwise a person mid-shift would show "until <end of this
  // hourly slot>" instead of the real end of their continuous shift (e.g.
  // "until 7:00 AM" for someone actually working 6 AM–2 PM), since the raw
  // source data is one row per hour (see mergeContiguousShifts() doc
  // comment).
  const todaysShifts = mergeContiguousShifts(
    snapshot.shifts.filter(
      (s) => s.start < todayWindow.end && s.end > todayWindow.start,
    ),
  );
  const personKeys = [...new Set(todaysShifts.map((s) => s.personKey))];
  const availability = deriveAvailability(personKeys, todaysShifts, now);

  const workingNow = availability
    .filter((a) => a.status === "WORKING_NOW")
    .map(toEntry);
  const comingUp = availability
    .filter((a) => a.status === "SCHEDULED_LATER")
    .sort((a, b) => a.nextShift!.start.getTime() - b.nextShift!.start.getTime())
    .map(toEntry);
  const off = availability.filter((a) => a.status === "OFF").map(toEntry);

  const unmappedCount = [...workingNow, ...comingUp, ...off].filter(
    (e) => e.person.stayWhileUserId === null,
  ).length;

  return { ...status, workingNow, comingUp, off, unmappedCount };
}

export type ScheduleRange = "today" | "tomorrow" | "week";

export interface ScheduleRangeShiftEntry {
  sourceKey: string;
  /** Whether this source identity has a confirmed StayWhile user mapping — display-only, never gates visibility (see SchedulePerson doc comment). */
  mapped: boolean;
  role: string;
  timeLabel: string;
}

export interface ScheduleRangeDay {
  date: CalendarDate;
  dateLabel: string;
  entries: ScheduleRangeShiftEntry[];
}

export interface ScheduleRangeResult extends ScheduleFetchStatus {
  days: ScheduleRangeDay[];
}

/**
 * The dedicated schedule view's data for Today/Tomorrow/Week — each day's
 * entries are contiguous shift blocks (see mergeContiguousShifts()), sorted
 * by start time, so a person's full 6 AM–2 PM shift renders as one row
 * instead of eight hourly ones.
 */
export async function getScheduleForRange(
  actor: AuthContext,
  range: ScheduleRange,
  now: Date = new Date(),
): Promise<ScheduleRangeResult> {
  await assertPermission(actor, "team:read");
  const status = await getFetchStatus();
  const snapshot = await getSnapshot();

  const chicagoToday = getCalendarDateInZone(now, SCHEDULE_TIMEZONE);
  const dayCount = range === "week" ? 7 : 1;
  const startOffset = range === "tomorrow" ? 1 : 0;
  const dates = Array.from({ length: dayCount }, (_, i) =>
    addCalendarDays(chicagoToday, startOffset + i),
  );

  if (!snapshot) {
    return {
      ...status,
      days: dates.map((date) => ({
        date,
        dateLabel: formatCalendarDateLabel(date),
        entries: [],
      })),
    };
  }

  const days: ScheduleRangeDay[] = dates.map((date) => {
    const window = calendarDayWindowUtc(date, SCHEDULE_TIMEZONE);
    const dayShifts = snapshot.shifts.filter(
      (s) => s.start < window.end && s.end > window.start,
    );
    const merged = mergeContiguousShifts(dayShifts).sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );
    return {
      date,
      dateLabel: formatCalendarDateLabel(date),
      entries: merged.map((s) => ({
        sourceKey: s.personKey,
        mapped: resolveTeamMember(s.personKey) !== null,
        role: s.label ?? "—",
        timeLabel: formatChicagoTimeRange(s.start, s.end),
      })),
    };
  });

  return { ...status, days };
}

/**
 * Admin-only diagnostic: every distinct source identity currently appearing
 * in the schedule that has no confirmed StayWhile user mapping — including
 * the known typo-variant clusters (Henry/Heny, etc., see README.md).
 * Gated on team:manage, deliberately separate from team:read, so an
 * ordinary viewer never sees this raw identity-quality list (per the "no
 * scary technical warnings for ordinary users" instruction) while an admin
 * reviewing mapping work still can.
 */
export async function getUnresolvedScheduleIdentities(
  actor: AuthContext,
): Promise<string[]> {
  await assertPermission(actor, "team:manage");
  const snapshot = await getSnapshot();
  if (!snapshot) return [];
  const keys = new Set(snapshot.shifts.map((s) => s.personKey));
  return [...keys].filter((k) => resolveTeamMember(k) === null).sort();
}

/** Whether the "team" resource is enabled for this dashboard — always true; the schedule source is a fixed sheet, not a per-environment credential/toggle like Notion/OwnerRez. Exported for the page/widget to keep the same `configured` shape other integration widgets use. */
export const TEAM_SCHEDULE_CONFIGURED = true as const;
