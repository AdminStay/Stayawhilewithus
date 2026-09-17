import type { NormalizedShift } from "./availability";
import { zonedTimeToUtc } from "./timezone";

/**
 * Parses Michelle's real VA/team schedule Google Sheet's actual layout —
 * confirmed by directly downloading and inspecting the live, publicly
 * (unauthenticated) readable CSV export, not guessed at. The real
 * structure is a CALENDAR GRID, not a list of shift rows:
 *
 *   ,"March 3, 2025",,,"March 4, 2025",,, ...      <- date header row
 *   ,Monday,,,Tuesday,,, ...                          <- day-name row
 *   ,Operations,MOD,EA,Operations,MOD,EA, ...         <- role-label row
 *   6:00-7:00 AM,Veronica,Veronica,-,Henry,,-, ...     <- one row per hourly time slot
 *   ...
 *   (blank separator row(s), then the next week's 3-row header repeats)
 *
 * Column 0 is always the time-slot label. Every subsequent column belongs
 * to a (day, role) pair — day groups are detected from the date row
 * itself (wherever a cell matches a date pattern starts a new group),
 * not hardcoded to "7 days x 3 roles", so a week with a different shape
 * doesn't silently misalign. Two tabs exist in the real workbook: "2025"
 * (this one — despite the name, its real date range runs from March 3,
 * 2025 through at least October 4, 2026, confirmed) and "August 2026
 * Draft" (confirmed completely empty — 0 bytes on export).
 *
 * Real, observed data-quality issues this parser deliberately does NOT
 * silently paper over — see the parallel doc comments below and this
 * domain's README.md for the full list.
 */

export interface ScheduleCell {
  /** Exact original cell text, only outer-whitespace-trimmed — never further "cleaned," so a caller can always see what was really there. */
  rawText: string;
  /**
   * Individual person names in this cell, trimmed. The real sheet uses
   * TWO different delimiters for "more than one person in this slot" —
   * both "/" (e.g. "Henry/Pam") and "|" (e.g. "April | Mark | Nel") occur,
   * inconsistently, in the same tab. Both are treated as valid separators
   * rather than picking one and silently losing the other's data —
   * flagged as a real inconsistency, not resolved by guessing which one
   * is "correct."
   */
  personTokens: string[];
  /**
   * A parenthetical note found in the cell, e.g. "(project)" or "(Mark
   * training)" — real examples from the source. Preserved, never
   * discarded, and never treated as a person name.
   */
  note: string | null;
  /** True when the raw cell was "-" specifically (an explicit "nobody"), as distinct from a genuinely blank cell — the source uses both, inconsistently, and this parser does not assume they mean the same thing even though both currently collapse to "no shift" for availability purposes. See README.md. */
  wasExplicitDash: boolean;
}

export interface ScheduleSlot {
  year: number;
  month: number; // 1–12
  day: number;
  /** The day name exactly as printed in the sheet (e.g. "Wednesday") — compared against the calendar-computed weekday; a mismatch is reported as a warning, never silently trusted or silently corrected. */
  dayNameInSheet: string;
  /** The role-column label exactly as printed for this slot's column (e.g. "Operations", "MOD", "EA", or the observed one-off variant "EA/Projects") — never normalized to a fixed enum, since the source itself isn't consistent about it. */
  roleLabel: string;
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
  timeLabelRaw: string;
  cell: ScheduleCell;
}

export type ScheduleParseWarningType =
  | "UNPARSEABLE_DATE"
  | "UNPARSEABLE_TIME_LABEL"
  | "DAY_NAME_MISMATCH"
  | "MISSING_ROLE_LABEL";

export interface ScheduleParseWarning {
  type: ScheduleParseWarningType;
  /** Human-readable, never includes a person's name or any schedule content beyond the date/time-slot text needed to locate the problem. */
  detail: string;
}

export interface ScheduleParseResult {
  slots: ScheduleSlot[];
  warnings: ScheduleParseWarning[];
}

const DATE_PATTERN = /^([A-Za-z]+)\s+(\d{1,2}),?\s*(\d{4})$/;
const MONTH_NAMES = [
  "january",
  "february",
  "march",
  "april",
  "may",
  "june",
  "july",
  "august",
  "september",
  "october",
  "november",
  "december",
];

function parseDateCell(
  text: string,
): { year: number; month: number; day: number } | null {
  const match = DATE_PATTERN.exec(text.trim());
  if (!match) return null;
  const monthIndex = MONTH_NAMES.indexOf(match[1]!.toLowerCase());
  if (monthIndex === -1) return null;
  return {
    year: Number(match[3]),
    month: monthIndex + 1,
    day: Number(match[2]),
  };
}

// Tolerates the real source's inconsistent spacing around the dash
// ("6:00-7:00 AM" vs "11:00 AM - 12:00 PM") and a period suffix appearing
// on only the second time when both share it ("6:00-7:00 AM" means both
// times are AM, not that the first has no period).
const TIME_RANGE_PATTERN =
  /^(\d{1,2}):(\d{2})\s*(AM|PM)?\s*-\s*(\d{1,2}):(\d{2})\s*(AM|PM)$/i;

function to24Hour(hour12: number, period: "AM" | "PM"): number {
  if (period === "AM") return hour12 === 12 ? 0 : hour12;
  return hour12 === 12 ? 12 : hour12 + 12;
}

function parseTimeRange(text: string): {
  startHour: number;
  startMinute: number;
  endHour: number;
  endMinute: number;
} | null {
  const match = TIME_RANGE_PATTERN.exec(text.trim());
  if (!match) return null;
  const [, sh, sm, sPeriodRaw, eh, em, ePeriodRaw] = match;
  const ePeriod = ePeriodRaw!.toUpperCase() as "AM" | "PM";
  // If the start time had no AM/PM of its own, it shares the end time's
  // period UNLESS the start hour is numerically greater than the end hour
  // (e.g. "11:00 PM-12:00 AM" genuinely crosses midnight) — real example
  // from the source.
  const startHour12 = Number(sh);
  const endHour12 = Number(eh);
  const sPeriod =
    (sPeriodRaw?.toUpperCase() as "AM" | "PM" | undefined) ??
    (startHour12 > endHour12 && ePeriod === "AM" ? "PM" : ePeriod);

  return {
    startHour: to24Hour(startHour12, sPeriod),
    startMinute: Number(sm),
    endHour: to24Hour(endHour12, ePeriod),
    endMinute: Number(em),
  };
}

function parseCell(rawText: string): ScheduleCell {
  const trimmed = rawText.trim();
  const noteMatch = /\(([^)]*)\)/.exec(trimmed);
  const withoutNote = trimmed.replace(/\([^)]*\)/g, "").trim();
  const wasExplicitDash = withoutNote === "-";

  const personTokens =
    wasExplicitDash || withoutNote === ""
      ? []
      : withoutNote
          .split(/[/|]/)
          .map((t) => t.trim())
          .filter((t) => t.length > 0);

  return {
    rawText,
    personTokens,
    note: noteMatch ? noteMatch[1]!.trim() : null,
    wasExplicitDash,
  };
}

const WEEKDAY_NAMES = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

function computedWeekday(year: number, month: number, day: number): string {
  // UTC-anchored on purpose — this is a pure calendar-date computation
  // (which weekday does this Y/M/D fall on), not an instant, so it must
  // never be affected by the server's own local timezone.
  const dow = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return WEEKDAY_NAMES[dow]!;
}

/**
 * `rows` is already-split CSV rows (see csv.ts) — this function does no
 * fetching and no CSV parsing itself, so it's testable with small literal
 * arrays. Never throws on malformed input; unparseable dates/times are
 * skipped with a warning (UNKNOWN is preferable to a wrong guess), never
 * silently defaulted.
 */
export function parseScheduleGrid(
  rows: readonly string[][],
): ScheduleParseResult {
  const slots: ScheduleSlot[] = [];
  const warnings: ScheduleParseWarning[] = [];

  let i = 0;
  while (i < rows.length) {
    const dateRow = rows[i]!;
    const dayGroups: {
      startCol: number;
      date: { year: number; month: number; day: number };
    }[] = [];
    for (let col = 1; col < dateRow.length; col++) {
      const parsed = parseDateCell(dateRow[col] ?? "");
      if (parsed) dayGroups.push({ startCol: col, date: parsed });
    }

    if (dayGroups.length === 0) {
      // Not a date-header row (blank separator, or end of sheet) — advance one row at a time rather than assuming block size.
      i++;
      continue;
    }

    const dayNameRow = rows[i + 1] ?? [];
    const roleLabelRow = rows[i + 2] ?? [];

    // Column width of each day group — the gap to the next group's start
    // column (or to the end of the row for the last group). Detected, not
    // hardcoded to 3, so a differently-shaped week doesn't silently
    // misalign.
    const groupsWithWidth = dayGroups.map((g, idx) => ({
      ...g,
      width:
        idx + 1 < dayGroups.length
          ? dayGroups[idx + 1]!.startCol - g.startCol
          : Math.max(dateRow.length, roleLabelRow.length) - g.startCol,
    }));

    // Time-slot rows: everything after the 3 header rows, until a row
    // that's entirely blank (the real separator between weeks) or another
    // date-header row.
    let j = i + 3;
    while (j < rows.length) {
      const row = rows[j]!;
      const isBlank = row.every((c) => (c ?? "").trim() === "");
      if (isBlank) break;
      const isNextHeader = row
        .slice(1)
        .some((c) => parseDateCell(c ?? "") !== null);
      if (isNextHeader) break;

      const timeLabelRaw = (row[0] ?? "").trim();
      const timeRange = timeLabelRaw ? parseTimeRange(timeLabelRaw) : null;
      if (timeLabelRaw && !timeRange) {
        warnings.push({
          type: "UNPARSEABLE_TIME_LABEL",
          detail: `Row ${j + 1}: could not parse time-slot label "${timeLabelRaw}"`,
        });
      }

      if (timeRange) {
        for (const group of groupsWithWidth) {
          const dayNameInSheet = (dayNameRow[group.startCol] ?? "").trim();
          const expectedWeekday = computedWeekday(
            group.date.year,
            group.date.month,
            group.date.day,
          );
          if (
            dayNameInSheet &&
            dayNameInSheet.toLowerCase() !== expectedWeekday
          ) {
            warnings.push({
              type: "DAY_NAME_MISMATCH",
              detail: `${group.date.year}-${group.date.month}-${group.date.day}: sheet says "${dayNameInSheet}", calendar says "${expectedWeekday}"`,
            });
          }

          for (let c = group.startCol; c < group.startCol + group.width; c++) {
            const roleLabel = (roleLabelRow[c] ?? "").trim();
            const rawText = row[c] ?? "";
            if (!roleLabel) {
              // No role label to attribute this column to — skip rather
              // than guess, but only worth a warning if there was
              // actually a scheduled person here; an empty role label
              // over an empty cell is just normal grid padding.
              if (rawText.trim() !== "" && rawText.trim() !== "-") {
                warnings.push({
                  type: "MISSING_ROLE_LABEL",
                  detail: `${group.date.year}-${group.date.month}-${group.date.day} ${timeLabelRaw}: a scheduled entry exists in column ${c + 1} but its role-label header is blank`,
                });
              }
              continue;
            }
            slots.push({
              year: group.date.year,
              month: group.date.month,
              day: group.date.day,
              dayNameInSheet,
              roleLabel,
              startHour: timeRange.startHour,
              startMinute: timeRange.startMinute,
              endHour: timeRange.endHour,
              endMinute: timeRange.endMinute,
              timeLabelRaw,
              cell: parseCell(rawText),
            });
          }
        }
      }

      j++;
    }

    i = j;
  }

  return { slots, warnings };
}

/**
 * Converts already-parsed sheet slots into the source-agnostic
 * `NormalizedShift[]` shape `availability.ts`'s `deriveAvailability()`
 * consumes. `personKey` here is the RAW, trimmed source name token
 * exactly as it appeared in the sheet — deliberately NOT resolved to a
 * StayWhile `User.id` at this stage (that's `resolveTeamMember()`'s job,
 * applied separately when building what the UI actually displays), so
 * availability can be derived per real source identity before anyone
 * decides which of those identities map to a confirmed StayWhile person.
 *
 * `timeZone` is required, with no default — see timezone.ts's own doc
 * comment for why. A slot whose end time is not after its start time on
 * the same calendar day (e.g. the real "11:00 PM-12:00 AM" slot) is
 * treated as crossing midnight, adding 24h to the end instant, rather
 * than silently producing an inverted/zero-length shift.
 */
export function toNormalizedShifts(
  slots: readonly ScheduleSlot[],
  timeZone: string,
): NormalizedShift[] {
  const shifts: NormalizedShift[] = [];

  for (const slot of slots) {
    const start = zonedTimeToUtc(
      {
        year: slot.year,
        month: slot.month,
        day: slot.day,
        hour: slot.startHour,
        minute: slot.startMinute,
      },
      timeZone,
    );
    let end = zonedTimeToUtc(
      {
        year: slot.year,
        month: slot.month,
        day: slot.day,
        hour: slot.endHour,
        minute: slot.endMinute,
      },
      timeZone,
    );
    if (end.getTime() <= start.getTime()) {
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }

    for (const personToken of slot.cell.personTokens) {
      shifts.push({
        personKey: personToken,
        start,
        end,
        label: slot.roleLabel,
      });
    }
  }

  return shifts;
}
