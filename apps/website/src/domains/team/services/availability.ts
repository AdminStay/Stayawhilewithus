/**
 * Pure, source-agnostic availability derivation — deliberately has no idea
 * where a shift came from (Google Sheet, a future real scheduling system,
 * anything else). It only ever sees already-normalized time ranges, so it
 * can be built and tested now, before the real VA/team schedule source is
 * connected, and doesn't need rewriting once it is.
 *
 * Every date/time in and out of this module is a real `Date` (a concrete
 * instant), never a naive "3:00 PM" string — the caller that eventually
 * parses the real schedule source is responsible for resolving each shift
 * to a real instant using that source's own documented timezone (see
 * README.md in this domain for why that's still an open question).
 */

export type AvailabilityStatus =
  "WORKING_NOW" | "SCHEDULED_LATER" | "OFF" | "UNAVAILABLE" | "UNKNOWN";

export interface NormalizedShift {
  /** The schedule source's own identifier for this person (e.g. a sheet row's name/id) — NOT a StayWhile User.id. Identity mapping is a separate, deliberately-manual step; see team-identity-mapping.ts. */
  personKey: string;
  /** Real instant, already resolved from the source's own timezone. */
  start: Date;
  end: Date;
  /** Optional raw role/note text from the source — purely informational, never used to derive status. */
  label?: string;
}

export interface PersonAvailability {
  personKey: string;
  status: AvailabilityStatus;
  /** The shift covering `now`, if status is WORKING_NOW. */
  currentShift: NormalizedShift | null;
  /** The next upcoming shift today, if status is SCHEDULED_LATER. */
  nextShift: NormalizedShift | null;
}

/**
 * Explicit non-shift status for a person, when the source data actually
 * supports one (e.g. a real "PTO"/"Off"/"Leave" column) — optional and
 * separate from shift-time derivation on purpose. Today nothing populates
 * this (no real schedule source is connected yet), so every person is
 * derived purely from their shift time ranges below. Once the real sheet
 * structure is confirmed, if it has a genuine status/leave column, its
 * values map here rather than inventing a new derivation rule.
 */
export interface ExplicitStatusOverride {
  personKey: string;
  status: Extract<AvailabilityStatus, "OFF" | "UNAVAILABLE">;
}

/**
 * Derives each requested person's current availability from their shifts
 * for "today" (in whatever timezone `now` and every shift's start/end were
 * already resolved to — this function does no timezone conversion itself).
 *
 * States, and exactly what makes each one true:
 * - WORKING_NOW: a shift whose [start, end) contains `now`.
 * - SCHEDULED_LATER: no current shift, but at least one shift today starts after `now`.
 * - OFF: has at least one NormalizedShift entry for today (proving this person is on the schedule at all) but none active now or later — or an explicit "OFF" override.
 * - UNAVAILABLE: only ever set by an explicit override (e.g. a real PTO/leave column) — never inferred from an empty shift list, since an empty list more often just means "not on today's schedule," not "on leave."
 * - UNKNOWN: no shift data and no explicit override exists for this person at all — the honest default, not a guess. Deliberately never displayed as "off" or "working" — see TeamAvailability.tsx.
 *
 * `personKeys` is passed explicitly (not inferred from `shifts`) so a
 * person who is on the team but has zero shifts today still gets a real
 * UNKNOWN/OFF answer instead of silently vanishing from the result.
 */
export function deriveAvailability(
  personKeys: readonly string[],
  shifts: readonly NormalizedShift[],
  now: Date,
  overrides: readonly ExplicitStatusOverride[] = [],
): PersonAvailability[] {
  return personKeys.map((personKey) => {
    const override = overrides.find((o) => o.personKey === personKey);
    if (override) {
      return {
        personKey,
        status: override.status,
        currentShift: null,
        nextShift: null,
      };
    }

    const personShifts = shifts
      .filter((s) => s.personKey === personKey)
      .sort((a, b) => a.start.getTime() - b.start.getTime());

    if (personShifts.length === 0) {
      return {
        personKey,
        status: "UNKNOWN",
        currentShift: null,
        nextShift: null,
      };
    }

    const current =
      personShifts.find((s) => s.start <= now && now < s.end) ?? null;
    if (current) {
      return {
        personKey,
        status: "WORKING_NOW",
        currentShift: current,
        nextShift: null,
      };
    }

    const next = personShifts.find((s) => s.start > now) ?? null;
    if (next) {
      return {
        personKey,
        status: "SCHEDULED_LATER",
        currentShift: null,
        nextShift: next,
      };
    }

    // Has shifts today, but all of them are already over and none is
    // upcoming — genuinely off for the rest of the window being evaluated,
    // not merely "no data."
    return { personKey, status: "OFF", currentShift: null, nextShift: null };
  });
}

/**
 * Whether the last successful sync is old enough that schedule data should
 * be shown as possibly stale rather than confidently current. Mirrors the
 * same "never claim UNKNOWN is confidently something else" discipline
 * already used for device telemetry (see dashboard.service.ts's
 * TELEMETRY_STALE_THRESHOLD_MS) — the exact threshold for a schedule
 * source is a separate, not-yet-made decision (how often the real Sheet is
 * expected to change), so this takes the threshold as a parameter rather
 * than hardcoding one.
 */
export function isScheduleDataStale(
  lastSyncedAt: Date | null,
  now: Date,
  staleThresholdMs: number,
): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() > staleThresholdMs;
}

/**
 * Coalesces back-to-back hourly shifts into one continuous block for
 * display — the real schedule source is one row per hour, so a person
 * working 6 AM–2 PM is 8 separate `NormalizedShift` entries with identical
 * `personKey`/`label`, each starting exactly where the previous one ended.
 * Showing 8 rows for that one real shift would be exactly the cluttered,
 * unscannable table this domain's UI is meant to avoid.
 *
 * Deliberately narrow: only merges entries with the EXACT SAME `personKey`
 * (no fuzzy/typo-variant matching — see team-identity-mapping.ts) and the
 * EXACT SAME `label`, where one's `end` instant exactly equals the next
 * one's `start` instant (no gap-bridging, no rounding). A gap of even one
 * minute, or a role-label change mid-block, stays two separate entries —
 * merging across either would silently invent continuity the source never
 * stated.
 */
export function mergeContiguousShifts(
  shifts: readonly NormalizedShift[],
): NormalizedShift[] {
  const sorted = [...shifts].sort((a, b) => {
    if (a.personKey !== b.personKey)
      return a.personKey.localeCompare(b.personKey);
    const aLabel = a.label ?? "";
    const bLabel = b.label ?? "";
    if (aLabel !== bLabel) return aLabel.localeCompare(bLabel);
    return a.start.getTime() - b.start.getTime();
  });

  const merged: NormalizedShift[] = [];
  for (const shift of sorted) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last.personKey === shift.personKey &&
      (last.label ?? "") === (shift.label ?? "") &&
      last.end.getTime() === shift.start.getTime()
    ) {
      last.end = shift.end;
    } else {
      merged.push({ ...shift });
    }
  }
  return merged;
}
