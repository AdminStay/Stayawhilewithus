/**
 * The text an admin copies to send a cleaner by hand (Cleaner Phase 5.1 —
 * "Copy cleaner message"). Pure and side-effect free: building it sends
 * nothing, calls no provider and writes nothing.
 *
 * It accepts ONLY the five fields below, never a whole Property/Cleaner
 * row, so access codes, lock details, addresses, notes or phone numbers
 * can't end up in the text by accident.
 */
export interface CleanerMessageInput {
  propertyName: string;
  /** A `@db.Date` value (midnight UTC) — formatted in UTC so it never shifts a day. */
  scheduledDate: Date;
  scheduledStartTime: string | null;
  scheduledEndTime: string | null;
  cleaningType: string;
  cleanerName: string;
}

export const CLEANING_TYPE_LABELS: Record<string, string> = {
  TURNOVER: "Turnover cleaning",
  DEEP_CLEAN: "Deep clean",
  INSPECTION_CLEAN: "Inspection clean",
  MAINTENANCE_CLEAN: "Maintenance clean",
};

const DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function formatTime(start: string | null, end: string | null): string {
  if (start && end) return `${start}–${end}`;
  if (start) return `from ${start}`;
  if (end) return `by ${end}`;
  return "Time not set";
}

export function buildCleanerMessage(input: CleanerMessageInput): string {
  return [
    `Hi ${input.cleanerName}, cleaning scheduled:`,
    `Property: ${input.propertyName}`,
    `Date: ${DATE_FORMAT.format(new Date(input.scheduledDate))}`,
    `Time: ${formatTime(input.scheduledStartTime, input.scheduledEndTime)}`,
    `Type: ${CLEANING_TYPE_LABELS[input.cleaningType] ?? "Cleaning"}`,
    `Cleaner: ${input.cleanerName}`,
  ].join("\n");
}
