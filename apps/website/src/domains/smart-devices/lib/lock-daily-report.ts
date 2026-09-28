/**
 * Actionable daily lock report (2026-09-29, Michelle's daily monitoring
 * requirement; physical work delegated to Ops per Kenny). Pure: turns the
 * existing classifyLockHealth() flags into one Ops work list — what's wrong,
 * where, how serious, since when, and what Ops should do next.
 *
 * Actions are instructions for people only. Nothing here executes anything,
 * and no action tells Ops to use the dashboard's remote Lock/Unlock.
 *
 * Start time / "New": only flags whose timestamp marks when the condition
 * began are trusted (hold set, current lock state began, bridge last
 * online). Other timestamps are reading times (e.g. the battery report
 * time) and are shown as "last reading", never as a start and never as New.
 * There is no previous-day comparison and nothing is ever reported as
 * resolved: no daily history is stored.
 */
import {
  OPERATIONAL_HOLD_LABELS,
  type LockHealthFlag,
  type LockHealthFlagCode,
  type LockHealthSeverity,
  type OperationalHoldKind,
} from "./lock-health";

export interface LockReportRow {
  smartDeviceId: string;
  propertyName: string;
  lockName: string;
  flags: LockHealthFlag[];
}

/** Flags whose `since` is the moment the condition began. */
const START_TRUSTED_CODES: ReadonlySet<LockHealthFlagCode> = new Set([
  "OPERATIONAL_HOLD",
  "DOOR_OPEN_UNLOCKED",
  "UNLOCKED",
  "UNKNOWN_STATE",
  "OFFLINE",
]);

export const NEW_WITHIN_MS = 24 * 60 * 60 * 1000;

const HOLD_ACTIONS: Record<OperationalHoldKind, string> = {
  OUT_OF_SERVICE:
    "Leave out of service until the lock is repaired or replaced. No remote commands or testing.",
  EXCLUDED_FROM_TESTING:
    "No physical testing until an admin decides otherwise.",
  ONSITE_INSPECTION_REQUIRED:
    "Inspect onsite and report what you find to an admin.",
};

const HOLD_KIND_BY_LABEL = new Map(
  (
    Object.entries(OPERATIONAL_HOLD_LABELS) as Array<
      [OperationalHoldKind, string]
    >
  ).map(([kind, label]) => [label, kind]),
);

/** The recommended Ops next step for one flag. Display-only. */
export function getLockFlagAction(flag: LockHealthFlag): string {
  switch (flag.code) {
    case "OPERATIONAL_HOLD": {
      const kind = HOLD_KIND_BY_LABEL.get(flag.label);
      return kind
        ? HOLD_ACTIONS[kind]
        : "Follow the hold instructions; only an admin can clear it.";
    }
    case "COMMAND_BLOCKED":
      return "Perform the required in-person check and provide evidence before any admin reset.";
    case "DOOR_OPEN_UNLOCKED":
      return "Confirm the door is closed and the property is secure onsite.";
    case "UNLOCKED":
      return "Confirm the lock should be unlocked; secure it onsite if needed.";
    case "NO_BRIDGE":
      return "Confirm the bridge setup/assignment with Ops/admin.";
    case "OFFLINE":
      return "Check bridge power and Wi-Fi onsite.";
    case "UNKNOWN_STATE":
      return flag.label.includes("persistent")
        ? "Check lock/bridge connectivity onsite; do not remote-test until the state is stable."
        : "Watch the next refresh; if it stays unknown, check lock/bridge connectivity onsite. Do not remote-test until the state is stable.";
    case "POSSIBLE_LOCK_PROBLEM":
      return "Check the lock in the August app and inspect it onsite; do not remote-test.";
    case "LOW_BATTERY":
      return "Replace batteries onsite.";
    case "DOOR_SENSOR_CALIBRATION_NEEDED":
      return "Calibrate DoorSense in the August app onsite.";
    case "STALE_LOCK_TELEMETRY":
      return flag.label === "No health reading yet"
        ? "Wait for the next refresh; tell an admin if no reading appears."
        : "Check in the August app that the lock and bridge are online; tell an admin if the status stays stale.";
    case "STALE_BATTERY_TELEMETRY":
      return "Check the battery level in the August app; replace batteries onsite if low.";
  }
}

// Most urgent first within a severity: security, then human decisions,
// then connectivity, then maintenance.
const URGENCY: Record<LockHealthFlagCode, number> = {
  DOOR_OPEN_UNLOCKED: 0,
  UNLOCKED: 1,
  OPERATIONAL_HOLD: 2,
  COMMAND_BLOCKED: 3,
  OFFLINE: 4,
  NO_BRIDGE: 5,
  UNKNOWN_STATE: 6,
  POSSIBLE_LOCK_PROBLEM: 7,
  LOW_BATTERY: 8,
  DOOR_SENSOR_CALIBRATION_NEEDED: 9,
  STALE_LOCK_TELEMETRY: 10,
  STALE_BATTERY_TELEMETRY: 11,
};

const SEVERITY_ORDER: Record<LockHealthSeverity, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
};

export const SEVERITY_LABELS: Record<LockHealthSeverity, string> = {
  red: "Urgent",
  orange: "High",
  yellow: "Routine",
};

export interface LockReportItem {
  smartDeviceId: string;
  code: LockHealthFlagCode;
  propertyName: string;
  lockName: string;
  severity: LockHealthSeverity;
  problem: string;
  detail: string;
  /** When the condition began (trusted timestamps only), else null. */
  startedAt: string | null;
  /** A reading time that is NOT a start time (e.g. the battery report), else null. */
  lastReadingAt: string | null;
  /** "for 3 h" / "for 4 days" from startedAt, else null. */
  duration: string | null;
  /** Began within the last 24 h — only from a trusted start time. */
  isNew: boolean;
  action: string;
}

function formatDuration(ms: number): string {
  if (ms < 3_600_000) return `${Math.max(0, Math.floor(ms / 60_000))} min`;
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h`;
}

function toItem(
  row: LockReportRow,
  flag: LockHealthFlag,
  now: Date,
): LockReportItem {
  const sinceMs = flag.since ? Date.parse(flag.since) : Number.NaN;
  const valid = !Number.isNaN(sinceMs);
  const trusted = valid && START_TRUSTED_CODES.has(flag.code);
  const age = trusted ? now.getTime() - sinceMs : null;
  return {
    smartDeviceId: row.smartDeviceId,
    code: flag.code,
    propertyName: row.propertyName,
    lockName: row.lockName,
    severity: flag.severity,
    problem: flag.label,
    detail: flag.detail,
    startedAt: trusted ? flag.since : null,
    lastReadingAt: valid && !trusted ? flag.since : null,
    duration: age !== null && age >= 0 ? `for ${formatDuration(age)}` : null,
    isNew: age !== null && age >= 0 && age < NEW_WITHIN_MS,
    action: getLockFlagAction(flag),
  };
}

/**
 * The canonical "Needs attention" count for /locks: real August locks with
 * at least one lock-health flag (holds and command blocks included). The
 * same flags drive the report, so the numbers always agree.
 */
export function countLocksNeedingAttention(rows: LockReportRow[]): number {
  return rows.filter((r) => r.flags.length > 0).length;
}

export interface DailyLockReport {
  items: LockReportItem[];
  locksNeedingAttention: number;
  counts: Record<LockHealthSeverity, number>;
  newCount: number;
}

export function buildDailyLockReport(
  rows: LockReportRow[],
  now: Date,
): DailyLockReport {
  const items = rows
    .flatMap((row) => row.flags.map((flag) => toItem(row, flag, now)))
    .sort(
      (a, b) =>
        SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
        URGENCY[a.code] - URGENCY[b.code] ||
        a.propertyName.localeCompare(b.propertyName) ||
        a.lockName.localeCompare(b.lockName),
    );
  const counts: Record<LockHealthSeverity, number> = {
    red: 0,
    orange: 0,
    yellow: 0,
  };
  for (const item of items) counts[item.severity] += 1;
  return {
    items,
    locksNeedingAttention: countLocksNeedingAttention(rows),
    counts,
    newCount: items.filter((i) => i.isNew).length,
  };
}

/**
 * Plain text for pasting into Slack/Asana. Operational facts only — never
 * ids, PINs, access codes, guest data or credentials. `formatTime` renders
 * timestamps (the page passes the dashboard's Central-time formatter).
 */
export function formatDailyLockReportText(
  report: DailyLockReport,
  options: { generatedAt: string; formatTime: (iso: string) => string },
): string {
  const lines = [
    "StayWhile — Daily lock report",
    `Generated ${options.generatedAt}`,
    `Locks needing attention: ${report.locksNeedingAttention} · Items: ${report.items.length} (Urgent ${report.counts.red}, High ${report.counts.orange}, Routine ${report.counts.yellow}) · New in last 24 h: ${report.newCount}`,
  ];
  if (report.items.length === 0) {
    lines.push("", "No lock health problems right now.");
    return lines.join("\n");
  }
  let severity: LockHealthSeverity | null = null;
  let n = 0;
  for (const item of report.items) {
    if (item.severity !== severity) {
      severity = item.severity;
      lines.push("", `== ${SEVERITY_LABELS[severity].toUpperCase()} ==`);
    }
    n += 1;
    const when = item.startedAt
      ? `Since ${options.formatTime(item.startedAt)} (${item.duration ?? "just now"})`
      : item.lastReadingAt
        ? `Last reading ${options.formatTime(item.lastReadingAt)}`
        : null;
    lines.push(
      `${n}. ${item.isNew ? "[NEW] " : ""}${item.propertyName} — ${item.lockName}: ${item.problem}`,
      ...(item.detail ? [`   Detail: ${item.detail}`] : []),
      ...(when ? [`   ${when}`] : []),
      `   Action: ${item.action}`,
    );
  }
  return lines.join("\n");
}
