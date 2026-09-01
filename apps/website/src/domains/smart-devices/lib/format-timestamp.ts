/**
 * Deterministic date+time formatting for operational "Last synced"/"Last
 * telemetry"/"Last refreshed" timestamps on /thermostats — explicit UTC
 * timezone and explicit en-US locale, so server-rendered HTML and
 * client-hydrated HTML are byte-for-byte identical regardless of which
 * timezone/locale the Vercel server or the viewer's browser happen to
 * default to.
 *
 * Ambient `toLocaleString()` (no explicit timeZone/locale) is exactly what
 * caused a real React error #418 hydration mismatch on this page — the
 * server renders in its own runtime's default timezone, the browser
 * re-renders in the viewer's local timezone (e.g. GMT+8), the two strings
 * differ, and React discards + regenerates the whole un-isolated hydration
 * unit client-side. Same class of bug, same fix discipline already
 * established by DashboardSummary.tsx's formatUtcDate() for @db.Date
 * columns — this is the DateTime (date *and* time-of-day) equivalent,
 * needed here because "how recently was this refreshed" genuinely depends
 * on the time component, not just the calendar day.
 *
 * Always UTC, always explicitly labeled — a VA never has to guess which
 * timezone a timestamp is in, and it never depends on where the request
 * happened to render.
 */
export function formatTimestamp(date: Date | null): string {
  if (!date) return "—";
  const formatted = new Date(date).toLocaleString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
  return `${formatted} UTC`;
}
