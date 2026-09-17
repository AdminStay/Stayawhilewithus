/**
 * Converts a wall-clock date/time in a specific IANA timezone to a real
 * UTC instant — dependency-free (uses the platform's built-in `Intl` tz
 * database, correctly DST-aware, rather than a hand-rolled or
 * fixed-offset approximation, which would be silently wrong twice a year
 * for any US timezone). No date/timezone library exists anywhere in this
 * monorepo yet (checked before writing this) — adding one is a real
 * dependency decision this pass didn't make unilaterally.
 *
 * The schedule source (Michelle's Google Sheet) states no timezone
 * anywhere — confirmed by inspection, not assumed absent. Every caller of
 * this function MUST supply `timeZone` explicitly; there is deliberately
 * no default, so a future caller can't silently assume UTC or the
 * server's own timezone.
 */
export interface WallClockComponents {
  year: number;
  /** 1–12, not 0-indexed. */
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function offsetMinutesAt(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);

  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return (asIfUtc - instant.getTime()) / 60_000;
}

/**
 * `components` is a wall-clock reading with no timezone attached (exactly
 * what the schedule source's date/time-slot text is) — this resolves it to
 * the one real UTC instant it means in `timeZone`. Two-pass: the offset at
 * a first guess can itself be wrong right at a DST transition, so it's
 * recomputed once against the adjusted instant, matching the standard
 * technique for this problem (not an approximation).
 */
export function zonedTimeToUtc(
  components: WallClockComponents,
  timeZone: string,
): Date {
  const guess = new Date(
    Date.UTC(
      components.year,
      components.month - 1,
      components.day,
      components.hour,
      components.minute,
    ),
  );
  const firstOffset = offsetMinutesAt(guess, timeZone);
  const adjusted = new Date(guess.getTime() - firstOffset * 60_000);
  const secondOffset = offsetMinutesAt(adjusted, timeZone);
  if (secondOffset === firstOffset) return adjusted;
  return new Date(guess.getTime() - secondOffset * 60_000);
}
