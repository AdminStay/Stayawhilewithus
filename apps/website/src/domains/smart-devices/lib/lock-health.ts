/**
 * Daily lock-health monitoring (2026-09-25, Michelle's requirement).
 *
 * Pure functions only — no database, no provider calls. Two jobs:
 *
 *   1. buildLockHealthUpdate(): turn one fresh read-only August
 *      getLockDetail() result into (a) the lock's updated `metadata`,
 *      including a `lockHealth` snapshot, and (b) the transition events to
 *      record in SmartDeviceEvent. Used by every read-only August refresh
 *      path (automatic/"Refresh all" and per-lock spot refresh).
 *   2. classifyLockHealth(): turn a stored snapshot into deterministic
 *      "needs attention" flags for the dashboard and the daily digest.
 *
 * Nothing here can issue a command to a lock; it only interprets readings.
 */
import type { AugustLockDetail } from "@stayw/integrations/august";

/** Review-able starting thresholds (2026-09-25). The unlocked-duration threshold is deliberately NOT set yet: occupancy data must be considered first. */
export const LOCK_HEALTH_THRESHOLDS = {
  batteryCriticalPercent: 20,
  batteryWarningPercent: 30,
  batteryReadingStaleMs: 7 * 24 * 60 * 60 * 1000,
  /** Two consecutive refreshes reporting unknown. */
  persistentUnknownRefreshes: 2,
  /** Known → unknown transitions within 24h. */
  frequentUnknownCount: 3,
  bridgeOfflineEscalationMs: 12 * 60 * 60 * 1000,
  /** Two 6-hour refresh cycles. */
  lockTelemetryStaleMs: 12 * 60 * 60 * 1000,
  /** null = flag every valid unlocked lock, with how long it has been unlocked. */
  unlockedAttentionAfterMs: null as number | null,
} as const;

export type CurrentLockState = "locked" | "unlocked" | "unknown";

/** Stored at SmartDevice.metadata.lockHealth by the refresh paths. */
export interface LockHealthSnapshot {
  /** When StayWhile read this from August. */
  observedAt: string;
  /** Current state. "unknown" whenever August's reading isn't a valid locked/unlocked. */
  lockState: CurrentLockState;
  lockStatusValid: boolean;
  /** August's own LockStatus.dateTime. */
  lockStatusAt: string | null;
  unknownReason: string | null;
  doorState: string | null;
  connectivity: string;
  bridgePresent: boolean;
  bridgeLastOnline: string | null;
  bridgeLastOffline: string | null;
  wifiConnectionIssueCount: number | null;
  batteryLevel: number | null;
  batteryWarningState: string | null;
  /** August's battery report time (batteryInfo.infoUpdatedDate). */
  batteryReadingAt: string | null;
  /** Last valid locked/unlocked reading, kept separately so the current state is never overwritten by it. */
  lastValidLockState: "locked" | "unlocked" | null;
  lastValidLockStateAt: string | null;
  /** When the current lockState began; null when it began before monitoring started. */
  lockStateSince: string | null;
  consecutiveUnknownRefreshes: number;
}

export type LockHealthEventType =
  | "LOCK_STATE_CHANGED"
  | "CONNECTIVITY_CHANGED"
  | "DOOR_STATE_CHANGED"
  | "BATTERY_WARNING_CHANGED"
  | "WIFI_ISSUE_COUNT_INCREASED";

export interface LockHealthEvent {
  eventType: LockHealthEventType;
  payload: Record<string, string | number | null>;
  /** When StayWhile detected the change (the refresh's read time). */
  occurredAt: Date;
}

function readSnapshot(
  metadata: Record<string, unknown>,
): LockHealthSnapshot | null {
  const value = metadata.lockHealth;
  return value && typeof value === "object"
    ? (value as LockHealthSnapshot)
    : null;
}

export function getLockHealthSnapshot(
  metadata: unknown,
): LockHealthSnapshot | null {
  return metadata && typeof metadata === "object"
    ? readSnapshot(metadata as Record<string, unknown>)
    : null;
}

/**
 * Builds the metadata write and transition events for one fresh August
 * reading. Merges onto the existing metadata (keeps retiredAt and any other
 * non-telemetry key). Rules:
 *
 *   - `metadata.lockState` becomes the CURRENT state: "unknown" whenever
 *     August's reading isn't a valid locked/unlocked. An old locked/unlocked
 *     value is never kept for an invalid reading; it moves to
 *     `lockHealth.lastValidLockState` instead.
 *   - Battery level / battery report time keep their previous value when
 *     August omits them (unchanged behavior).
 *   - Events are emitted only for real changes against the previous
 *     snapshot, and none on the very first capture (no fake transitions).
 *
 * When the reading has no `health` block (older fixtures), falls back to the
 * previous merge behavior and records nothing new.
 */
export function buildLockHealthUpdate(
  existingMetadata: Record<string, unknown>,
  detail: AugustLockDetail,
  observedAt: Date,
): { metadata: Record<string, unknown>; events: LockHealthEvent[] } {
  const base: Record<string, unknown> = {
    ...existingMetadata,
    ...(detail.batteryLevel != null && { batteryLevel: detail.batteryLevel }),
    ...(detail.telemetryUpdatedAt != null && {
      telemetryUpdatedAt: detail.telemetryUpdatedAt,
    }),
  };

  const health = detail.health;
  if (!health) {
    return {
      metadata: {
        ...base,
        ...(detail.lockState != null && { lockState: detail.lockState }),
      },
      events: [],
    };
  }

  const observedIso = observedAt.toISOString();
  const raw = health.lockStatus?.toLowerCase() ?? null;
  const current: CurrentLockState =
    health.lockStatusValid && (raw === "locked" || raw === "unlocked")
      ? raw
      : "unknown";
  const previous = readSnapshot(existingMetadata);

  const stateChanged = previous !== null && previous.lockState !== current;
  const lockStateSince = previous
    ? stateChanged
      ? (health.lockStatusAt ?? observedIso)
      : previous.lockStateSince
    : null;

  const snapshot: LockHealthSnapshot = {
    observedAt: observedIso,
    lockState: current,
    lockStatusValid: health.lockStatusValid,
    lockStatusAt: health.lockStatusAt,
    unknownReason: health.unknownReason,
    doorState: health.doorState,
    connectivity: detail.connectivity,
    bridgePresent: health.bridgePresent,
    bridgeLastOnline: health.bridgeLastOnline,
    bridgeLastOffline: health.bridgeLastOffline,
    wifiConnectionIssueCount: health.wifiConnectionIssueCount,
    batteryLevel:
      detail.batteryLevel ??
      (typeof base.batteryLevel === "number" ? base.batteryLevel : null),
    batteryWarningState: health.batteryWarningState,
    batteryReadingAt:
      detail.telemetryUpdatedAt ??
      (typeof base.telemetryUpdatedAt === "string"
        ? base.telemetryUpdatedAt
        : null),
    lastValidLockState:
      current === "unknown" ? (previous?.lastValidLockState ?? null) : current,
    lastValidLockStateAt:
      current === "unknown"
        ? (previous?.lastValidLockStateAt ?? null)
        : (health.lockStatusAt ?? observedIso),
    lockStateSince,
    consecutiveUnknownRefreshes:
      current === "unknown"
        ? (previous?.consecutiveUnknownRefreshes ?? 0) + 1
        : 0,
  };

  const events: LockHealthEvent[] = [];
  if (previous) {
    const add = (
      eventType: LockHealthEventType,
      payload: Record<string, string | number | null>,
    ) => events.push({ eventType, payload, occurredAt: observedAt });

    if (previous.lockState !== current) {
      add("LOCK_STATE_CHANGED", {
        from: previous.lockState,
        to: current,
        unknownReason: health.unknownReason,
        providerStatusAt: health.lockStatusAt,
      });
    }
    if (previous.connectivity !== detail.connectivity) {
      add("CONNECTIVITY_CHANGED", {
        from: previous.connectivity,
        to: detail.connectivity,
        bridgeLastOnline: health.bridgeLastOnline,
        bridgeLastOffline: health.bridgeLastOffline,
      });
    }
    if (previous.doorState !== health.doorState) {
      add("DOOR_STATE_CHANGED", {
        from: previous.doorState,
        to: health.doorState,
      });
    }
    if (previous.batteryWarningState !== health.batteryWarningState) {
      add("BATTERY_WARNING_CHANGED", {
        from: previous.batteryWarningState,
        to: health.batteryWarningState,
      });
    }
    if (
      health.wifiConnectionIssueCount !== null &&
      previous.wifiConnectionIssueCount !== null &&
      health.wifiConnectionIssueCount > previous.wifiConnectionIssueCount
    ) {
      add("WIFI_ISSUE_COUNT_INCREASED", {
        from: previous.wifiConnectionIssueCount,
        to: health.wifiConnectionIssueCount,
      });
    }
  }

  return {
    metadata: { ...base, lockState: current, lockHealth: snapshot },
    events,
  };
}

/**
 * Admin-recorded operational hold (2026-09-26): a human decision that a lock
 * must not be remotely operated or tested, whatever its telemetry says —
 * e.g. Florisun's jam reported in the August app and a replacement ordered.
 * Recorded as AuditLog rows (action "smart_device.lock_operational_hold"),
 * never in SmartDevice.metadata, so no telemetry refresh can overwrite or
 * clear it; the newest row wins, and clearing is itself a new row
 * (lock-operational-hold.service.ts).
 */
export type OperationalHoldKind =
  "OUT_OF_SERVICE" | "ONSITE_INSPECTION_REQUIRED" | "EXCLUDED_FROM_TESTING";

export interface OperationalHold {
  kind: OperationalHoldKind;
  note: string;
  setAt: string;
  setByUserId: string;
}

export const OPERATIONAL_HOLD_LABELS: Record<OperationalHoldKind, string> = {
  OUT_OF_SERVICE: "Out of service",
  ONSITE_INSPECTION_REQUIRED: "Onsite inspection required",
  EXCLUDED_FROM_TESTING: "Excluded from testing",
};

/** Parses one hold AuditLog afterState: the active hold, or null for a "cleared" row / anything unrecognized. */
export function parseOperationalHold(
  afterState: unknown,
): OperationalHold | null {
  const value =
    afterState && typeof afterState === "object"
      ? (afterState as Record<string, unknown>).hold
      : null;
  if (!value || typeof value !== "object") return null;
  const hold = value as Partial<OperationalHold>;
  return hold.kind &&
    hold.kind in OPERATIONAL_HOLD_LABELS &&
    typeof hold.note === "string" &&
    typeof hold.setAt === "string"
    ? (hold as OperationalHold)
    : null;
}

export type LockHealthSeverity = "red" | "orange" | "yellow";

export type LockHealthFlagCode =
  | "OPERATIONAL_HOLD"
  | "COMMAND_BLOCKED"
  | "DOOR_OPEN_UNLOCKED"
  | "UNLOCKED"
  | "NO_BRIDGE"
  | "OFFLINE"
  | "UNKNOWN_STATE"
  | "POSSIBLE_LOCK_PROBLEM"
  | "LOW_BATTERY"
  | "DOOR_SENSOR_CALIBRATION_NEEDED"
  | "STALE_LOCK_TELEMETRY"
  | "STALE_BATTERY_TELEMETRY";

export interface LockHealthFlag {
  code: LockHealthFlagCode;
  severity: LockHealthSeverity;
  label: string;
  detail: string;
  /** Relevant timestamp for the reason, when known. */
  since: string | null;
}

export interface LockHealthInput {
  metadata: unknown;
  /** SmartDevice.status. */
  connectivity: string;
  now: Date;
  /** known → unknown transitions recorded in the last 24h. */
  recentUnknownTransitions: number;
  /** Latest recorded command outcome (getLatestAugustLockCommandOutcomes). */
  lastCommandOutcome?: string | null;
  /** Active admin hold (getActiveOperationalHolds), if any. */
  operationalHold?: OperationalHold | null;
}

/**
 * Door-sensor calibration (2026-09-28, Kenny: "show the need for calibration
 * on the dashboard for the locks that need them"). Only August's raw
 * `LockStatus.doorState` "init" — its reading for a DoorSense that has not
 * been calibrated — counts. "open"/"closed" are calibrated readings; null,
 * "unknown" or anything unrecognized is NOT reported as needing calibration
 * because August hasn't said so. Informational only: calibration is done
 * onsite in the August app, never remotely, and this never affects commands.
 */
const DOOR_SENSOR_CALIBRATION_STATES: ReadonlySet<string> = new Set(["init"]);

export const DOOR_SENSOR_CALIBRATION_LABEL = "⚠ Calibration needed";
export const DOOR_SENSOR_CALIBRATION_DETAIL =
  "Door sensor needs calibration in the August app.";

export function isDoorSensorCalibrationNeeded(
  doorState: string | null | undefined,
): boolean {
  return (
    typeof doorState === "string" &&
    DOOR_SENSOR_CALIBRATION_STATES.has(doorState.trim().toLowerCase())
  );
}

const POSSIBLE_PROBLEM_LABEL =
  "Possible lock problem — check August app or inspect onsite";

function ageMs(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : now.getTime() - t;
}

function formatHours(ms: number): string {
  const hours = Math.floor(ms / 3_600_000);
  return hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h`;
}

const SEVERITY_ORDER: Record<LockHealthSeverity, number> = {
  red: 0,
  orange: 1,
  yellow: 2,
};

/**
 * Deterministic flags for one lock. Never labels a lock "jammed": August's
 * API exposes no authoritative jam signal, so inferred problems are
 * reported as a possible lock problem to check in the app or on site.
 */
export function classifyLockHealth(input: LockHealthInput): LockHealthFlag[] {
  const t = LOCK_HEALTH_THRESHOLDS;
  const s = getLockHealthSnapshot(input.metadata);
  const flags: LockHealthFlag[] = [];
  const add = (flag: LockHealthFlag) => flags.push(flag);

  // Human decisions and command blocks come first and never depend on
  // telemetry: a healthy-looking reading can't hide them.
  const hold = input.operationalHold ?? null;
  if (hold) {
    add({
      code: "OPERATIONAL_HOLD",
      severity: "red",
      label: OPERATIONAL_HOLD_LABELS[hold.kind],
      detail: `${hold.note} Remote commands and testing are blocked until an admin clears this.`,
      since: hold.setAt,
    });
  }
  const outcome = input.lastCommandOutcome ?? null;
  if (outcome === "FAILED" || outcome === "AMBIGUOUS") {
    add({
      code: "COMMAND_BLOCKED",
      severity: "orange",
      label: `Command blocked (${outcome})`,
      detail:
        "Last remote command was " +
        outcome +
        ". Needs a truthful in-person check and an admin Reset after physical check before any further remote command.",
      since: null,
    });
  }

  if (!s) {
    add({
      code: "STALE_LOCK_TELEMETRY",
      severity: "yellow",
      label: "No health reading yet",
      detail: "Waiting for the next August refresh to record lock health.",
      since: null,
    });
    return flags.sort(
      (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
    );
  }

  const unlockedFor = ageMs(s.lockStateSince, input.now);
  if (s.lockState === "unlocked" && s.doorState === "open") {
    add({
      code: "DOOR_OPEN_UNLOCKED",
      severity: "red",
      label: "Door open and unlocked",
      detail:
        unlockedFor !== null
          ? `Unlocked for ${formatHours(unlockedFor)}.`
          : "Unlocked since before monitoring began.",
      since: s.lockStateSince,
    });
  } else if (
    s.lockState === "unlocked" &&
    (t.unlockedAttentionAfterMs === null ||
      unlockedFor === null ||
      unlockedFor >= t.unlockedAttentionAfterMs)
  ) {
    add({
      code: "UNLOCKED",
      severity: "red",
      label: "Unlocked",
      detail: `${unlockedFor !== null ? `Unlocked for ${formatHours(unlockedFor)}.` : "Unlocked since before monitoring began."} Occupancy is not considered yet.`,
      since: s.lockStateSince,
    });
  }

  const sinceOnline = ageMs(s.bridgeLastOnline, input.now);
  if (!s.bridgePresent) {
    add({
      code: "NO_BRIDGE",
      severity: "red",
      label: "No bridge",
      detail:
        "August reports no WiFi bridge for this lock, so there is no live status or remote control.",
      since: null,
    });
  } else if (input.connectivity === "OFFLINE" || s.connectivity === "OFFLINE") {
    add({
      code: "OFFLINE",
      severity: "red",
      label: "Bridge offline",
      detail:
        sinceOnline !== null
          ? `Last online ${formatHours(sinceOnline)} ago${sinceOnline > t.bridgeOfflineEscalationMs ? " (over 12 h)" : ""}.`
          : "No last-online time reported.",
      since: s.bridgeLastOnline,
    });
  }

  const persistentUnknown =
    s.lockState === "unknown" &&
    s.consecutiveUnknownRefreshes >= t.persistentUnknownRefreshes;
  const frequentUnknown =
    input.recentUnknownTransitions >= t.frequentUnknownCount;
  if (s.lockState === "unknown") {
    const parts = [
      s.unknownReason ? `Reason: ${s.unknownReason}.` : "No reason given.",
      persistentUnknown
        ? `Unknown for ${s.consecutiveUnknownRefreshes} refreshes in a row.`
        : null,
      s.lastValidLockState
        ? `Last valid state: ${s.lastValidLockState} at ${s.lastValidLockStateAt}.`
        : "No valid state recorded yet.",
    ].filter(Boolean);
    add({
      code: "UNKNOWN_STATE",
      severity: "orange",
      label: persistentUnknown ? "State unknown (persistent)" : "State unknown",
      detail: parts.join(" "),
      since: s.lockStateSince,
    });
  }

  const problemReasons = [
    s.lockState === "unknown" && s.unknownReason
      ? `August reported ${s.unknownReason}.`
      : null,
    persistentUnknown && s.bridgePresent && s.connectivity === "ONLINE"
      ? "State stays unknown while the bridge is online."
      : null,
    frequentUnknown
      ? `State went unknown ${input.recentUnknownTransitions} times in 24 h.`
      : null,
  ].filter(Boolean);
  if (problemReasons.length > 0) {
    add({
      code: "POSSIBLE_LOCK_PROBLEM",
      severity: "orange",
      label: POSSIBLE_PROBLEM_LABEL,
      detail: problemReasons.join(" "),
      since: null,
    });
  }

  const warning =
    s.batteryWarningState &&
    s.batteryWarningState !== "lock_state_battery_warning_none"
      ? s.batteryWarningState
      : null;
  if (
    warning ||
    (s.batteryLevel !== null && s.batteryLevel < t.batteryWarningPercent)
  ) {
    const critical =
      s.batteryLevel !== null && s.batteryLevel < t.batteryCriticalPercent;
    add({
      code: "LOW_BATTERY",
      severity: critical || warning ? "orange" : "yellow",
      label: critical ? "Battery critical" : "Battery low",
      detail: [
        s.batteryLevel !== null ? `${s.batteryLevel}%.` : null,
        warning ? `August warning: ${warning}.` : null,
      ]
        .filter(Boolean)
        .join(" "),
      since: s.batteryReadingAt,
    });
  }

  // Its own maintenance condition: never a door open/closed, offline or
  // lock-problem reading, and independent of the lock state.
  if (isDoorSensorCalibrationNeeded(s.doorState)) {
    add({
      code: "DOOR_SENSOR_CALIBRATION_NEEDED",
      severity: "yellow",
      label: DOOR_SENSOR_CALIBRATION_LABEL,
      detail: DOOR_SENSOR_CALIBRATION_DETAIL,
      since: null,
    });
  }

  const observedAge = ageMs(s.observedAt, input.now);
  const statusAge = ageMs(s.lockStatusAt, input.now);
  if (
    (observedAge !== null && observedAge > t.lockTelemetryStaleMs) ||
    (s.bridgePresent &&
      statusAge !== null &&
      statusAge > t.lockTelemetryStaleMs)
  ) {
    add({
      code: "STALE_LOCK_TELEMETRY",
      severity: "yellow",
      label: "Lock status stale",
      detail:
        observedAge !== null && observedAge > t.lockTelemetryStaleMs
          ? `Not refreshed for ${formatHours(observedAge)}.`
          : `August's lock status is ${formatHours(statusAge ?? 0)} old.`,
      since: s.lockStatusAt,
    });
  }

  const batteryAge = ageMs(s.batteryReadingAt, input.now);
  if (batteryAge !== null && batteryAge > t.batteryReadingStaleMs) {
    add({
      code: "STALE_BATTERY_TELEMETRY",
      severity: "yellow",
      label: "Battery reading stale",
      detail: `Battery last reported ${formatHours(batteryAge)} ago.`,
      since: s.batteryReadingAt,
    });
  }

  return flags.sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
