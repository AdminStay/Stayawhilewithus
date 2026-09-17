import { zonedTimeToUtc } from "./timezone";

/**
 * StayWhile's confirmed operating timezone for the VA/team schedule —
 * confirmed by the user 2026-09-16 (the sheet itself states no timezone
 * anywhere; see README.md/HANDOFF.md Increment 97 for how that was
 * established). This is the ONLY place this module names the zone; every
 * other function here takes it as this constant, never a caller-supplied
 * default, so "what timezone is this schedule in" has exactly one answer
 * in the codebase. Intentionally the same zone already used for thermostat/
 * August "last refreshed" timestamps (see
 * smart-devices/lib/format-timestamp.ts) — one operating timezone for the
 * whole dashboard, not a per-feature choice.
 */
export const SCHEDULE_TIMEZONE = "America/Chicago";

/** A pure Y/M/D calendar date with no timezone attached — never a `Date` instant, so it can never be silently re-interpreted through the wrong zone. */
export interface CalendarDate {
  year: number;
  month: number; // 1–12
  day: number;
}

/** Which calendar date `instant` falls on in `timeZone` — e.g. 11:30 PM Jan 5 Chicago time is still "Jan 5" here even though its UTC instant is already Jan 6. */
export function getCalendarDateInZone(
  instant: Date,
  timeZone: string,
): CalendarDate {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { year: get("year"), month: get("month"), day: get("day") };
}

/**
 * `deltaDays` may be negative. UTC-noon-anchored on purpose (same technique
 * as sheet-schedule-parser.ts's computedWeekday()) — this is pure calendar
 * arithmetic on a Y/M/D triple, never an instant, so it must never be
 * affected by DST in any zone.
 */
export function addCalendarDays(
  date: CalendarDate,
  deltaDays: number,
): CalendarDate {
  const anchor = new Date(Date.UTC(date.year, date.month - 1, date.day, 12));
  anchor.setUTCDate(anchor.getUTCDate() + deltaDays);
  return {
    year: anchor.getUTCFullYear(),
    month: anchor.getUTCMonth() + 1,
    day: anchor.getUTCDate(),
  };
}

/**
 * The real [start, end) UTC instant window covering `date`'s full calendar
 * day IN `timeZone` — NOT a fixed 24h span. A day that contains a DST
 * transition is genuinely 23h (spring forward) or 25h (fall back) long;
 * computing this via zonedTimeToUtc() at both boundaries (rather than
 * `start + 24h`) is what makes shift-overlap filtering correct on those two
 * days a year instead of silently off by an hour.
 */
export function calendarDayWindowUtc(
  date: CalendarDate,
  timeZone: string,
): { start: Date; end: Date } {
  const start = zonedTimeToUtc({ ...date, hour: 0, minute: 0 }, timeZone);
  const end = zonedTimeToUtc(
    { ...addCalendarDays(date, 1), hour: 0, minute: 0 },
    timeZone,
  );
  return { start, end };
}

/** e.g. "Wed, Jan 15" — UTC-anchored formatting of a pure calendar date, same reasoning as addCalendarDays() above: this must never re-interpret the Y/M/D through a real zone offset. */
export function formatCalendarDateLabel(date: CalendarDate): string {
  const anchor = new Date(Date.UTC(date.year, date.month - 1, date.day));
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(anchor);
}

/** e.g. "6:00 AM" — the real Chicago wall-clock reading of `instant`, correct across CST/CDT since it's derived via Intl, never a fixed offset. */
export function formatChicagoTime(instant: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: SCHEDULE_TIMEZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(instant);
}

/** e.g. "6:00 AM – 2:00 PM". */
export function formatChicagoTimeRange(start: Date, end: Date): string {
  return `${formatChicagoTime(start)} – ${formatChicagoTime(end)}`;
}
