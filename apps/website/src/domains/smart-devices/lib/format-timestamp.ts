/**
 * Deterministic date+time formatting for operational "Last synced"/"Last
 * telemetry"/"Last refreshed" timestamps on /thermostats — explicit named
 * IANA timezone (America/Chicago, per Michelle's request — StayWhile's
 * operating timezone) and explicit en-US locale, so server-rendered HTML
 * and client-hydrated HTML are byte-for-byte identical regardless of which
 * timezone/locale the Vercel server or the viewer's browser happen to
 * default to. Stored DateTime values remain UTC in the database — only
 * this presentation layer changed.
 *
 * Ambient `toLocaleString()` (no explicit timeZone/locale) is exactly what
 * caused a real React error #418 hydration mismatch on this page — the
 * server renders in its own runtime's default timezone, the browser
 * re-renders in the viewer's local timezone (e.g. GMT+8), the two strings
 * differ, and React discards + regenerates the whole un-isolated hydration
 * unit client-side. `America/Chicago` is just as explicit/deterministic as
 * the `UTC` this replaces — it's a fixed named zone, not an ambient
 * default — so the hydration fix holds. Same class of bug, same fix
 * discipline already established by DashboardSummary.tsx's formatUtcDate()
 * for @db.Date columns — this is the DateTime (date *and* time-of-day)
 * equivalent, needed here because "how recently was this refreshed"
 * genuinely depends on the time component, not just the calendar day.
 *
 * The zone abbreviation (CDT/CST) is derived per-instant via
 * `Intl.DateTimeFormat`'s `timeZoneName`, never hard-coded — America/Chicago
 * observes DST, so a fixed "CDT" suffix would mislabel every winter instant
 * as daylight time. Deriving it from the actual date is what makes this
 * correct year-round instead of just during summer.
 */
export function formatTimestamp(date: Date | null): string {
  if (!date) return "—";
  const value = new Date(date);
  const formatted = value.toLocaleString("en-US", {
    timeZone: "America/Chicago",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  const zoneAbbreviation = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    timeZoneName: "short",
  })
    .formatToParts(value)
    .find((part) => part.type === "timeZoneName")?.value;
  return zoneAbbreviation ? `${formatted} ${zoneAbbreviation}` : formatted;
}
