/**
 * Remote-control verification vs current condition (2026-09-29, August Ops
 * verification visibility). Two independent, read-only axes for /locks:
 *
 *   A. Verification — historical evidence. A lock is VERIFIED once any
 *      recorded remote command on it SUCCEEDED (the lock physically moved;
 *      see getAugustLockVerificationHistory). It stays verified whatever
 *      happens later: a newer FAILED/AMBIGUOUS block, an admin reset, a
 *      hold, or degraded telemetry never erase it. Nothing else — ONLINE
 *      status, a good battery, a clean health reading — ever makes a lock
 *      verified. Unverified locks await the Ops team (Kenny, 2026-09-28:
 *      "The ops team will verify this part."), except locks an admin put
 *      out of service or excluded from testing.
 *
 *   B. Condition — current operational/safety state, from the same
 *      classifyLockHealth() flags as "Needs attention": on hold > command
 *      blocked > needs attention > healthy.
 *
 * Pure and display-only: never an input to command eligibility, and never
 * derived from a lock or property name.
 */
import {
  OPERATIONAL_HOLD_LABELS,
  type LockHealthFlag,
  type OperationalHold,
} from "./lock-health";

export type LockVerificationStatus =
  "VERIFIED" | "AWAITING_OPS" | "NOT_VERIFIED_ON_HOLD";

export const LOCK_VERIFICATION_LABELS: Record<LockVerificationStatus, string> =
  {
    VERIFIED: "Verified",
    AWAITING_OPS: "Awaiting Ops verification",
    NOT_VERIFIED_ON_HOLD: "Not verified (on hold)",
  };

export interface LockVerification {
  status: LockVerificationStatus;
  /** First recorded successful remote command (ISO), when verified. */
  verifiedAt: string | null;
}

export function deriveLockVerification(input: {
  /** From getAugustLockVerificationHistory(); null = no successful command ever recorded. */
  firstVerifiedAt: string | null;
  operationalHold: OperationalHold | null;
}): LockVerification {
  if (input.firstVerifiedAt) {
    return { status: "VERIFIED", verifiedAt: input.firstVerifiedAt };
  }
  const hold = input.operationalHold?.kind;
  if (hold === "OUT_OF_SERVICE" || hold === "EXCLUDED_FROM_TESTING") {
    return { status: "NOT_VERIFIED_ON_HOLD", verifiedAt: null };
  }
  return { status: "AWAITING_OPS", verifiedAt: null };
}

export type LockConditionStatus =
  "HEALTHY" | "NEEDS_ATTENTION" | "COMMAND_BLOCKED" | "ON_HOLD";

export const LOCK_CONDITION_LABELS: Record<LockConditionStatus, string> = {
  HEALTHY: "Healthy",
  NEEDS_ATTENTION: "Needs attention",
  COMMAND_BLOCKED: "Command blocked",
  ON_HOLD: "On hold",
};

export interface LockCondition {
  status: LockConditionStatus;
  /** Plain operational reasons, worst first — labels only, no technical detail. */
  reasons: string[];
}

export function deriveLockCondition(input: {
  flags: LockHealthFlag[];
  operationalHold: OperationalHold | null;
  /** Latest recorded command outcome (the one behind a COMMAND_BLOCKED flag). */
  lastCommandOutcome?: string | null;
}): LockCondition {
  const reasons: string[] = [];
  for (const flag of input.flags) {
    if (flag.code === "OPERATIONAL_HOLD" && input.operationalHold) {
      const hold = input.operationalHold;
      reasons.push(`${OPERATIONAL_HOLD_LABELS[hold.kind]}: ${hold.note}`);
    } else if (flag.code === "COMMAND_BLOCKED") {
      const what = input.lastCommandOutcome
        ? `Last remote command ${input.lastCommandOutcome}`
        : flag.label;
      reasons.push(
        `${what} — needs an in-person check and an admin reset before any remote command`,
      );
    } else {
      reasons.push(flag.label);
    }
  }
  const codes = new Set(input.flags.map((f) => f.code));
  const status: LockConditionStatus = codes.has("OPERATIONAL_HOLD")
    ? "ON_HOLD"
    : codes.has("COMMAND_BLOCKED")
      ? "COMMAND_BLOCKED"
      : input.flags.length > 0
        ? "NEEDS_ATTENTION"
        : "HEALTHY";
  return { status, reasons };
}

/** Door sensor, in Ops terms. Only August's "init" means calibration is needed. */
export function describeDoorCondition(
  doorState: string | null | undefined,
): string {
  const normalized = doorState?.trim().toLowerCase();
  if (normalized === "init") return "Calibration needed";
  if (normalized === "closed") return "Closed";
  if (normalized === "open") return "Open";
  return "Not reported";
}

export interface LockVerificationRow {
  smartDeviceId: string;
  propertyName: string;
  lockName: string;
  verification: LockVerification;
  condition: LockCondition;
  /** SmartDevice.status: ONLINE / OFFLINE / UNKNOWN / ERROR. */
  connectivity: string;
  batteryLevel: number | null;
  doorCondition: string;
}

/**
 * On the Ops checklist: every lock not yet verified, plus a verified lock
 * only when its current condition separately needs someone (anything but
 * HEALTHY).
 */
export function needsOpsFollowUp(row: LockVerificationRow): boolean {
  return (
    row.verification.status !== "VERIFIED" || row.condition.status !== "HEALTHY"
  );
}

const CONNECTIVITY_TEXT: Record<string, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Unknown",
  ERROR: "Error",
};

const CHECKLIST_GROUP_ORDER: Record<LockVerificationStatus, number> = {
  AWAITING_OPS: 0,
  NOT_VERIFIED_ON_HOLD: 1,
  VERIFIED: 2,
};

/**
 * Plain-text checklist for the Ops team. Only operational facts: property,
 * lock, verification, connectivity, battery, door/calibration, and the
 * hold/command-block reason. Never ids, PINs, access codes, guest data,
 * credentials or raw provider detail.
 */
export function buildOpsVerificationChecklist(
  rows: LockVerificationRow[],
  options: { generatedAt: string },
): string {
  const items = rows
    .filter(needsOpsFollowUp)
    .sort(
      (a, b) =>
        CHECKLIST_GROUP_ORDER[a.verification.status] -
          CHECKLIST_GROUP_ORDER[b.verification.status] ||
        a.propertyName.localeCompare(b.propertyName) ||
        a.lockName.localeCompare(b.lockName),
    );

  const lines = [
    "StayWhile — August lock Ops verification checklist",
    `Generated ${options.generatedAt}`,
    `Locks needing Ops verification or attention: ${items.length}`,
  ];
  items.forEach((row, index) => {
    const verification =
      row.verification.status === "VERIFIED"
        ? "Verified (current condition needs attention)"
        : LOCK_VERIFICATION_LABELS[row.verification.status];
    lines.push(
      "",
      `${index + 1}. ${row.propertyName} — ${row.lockName}`,
      `   Verification: ${verification}`,
      `   Status: ${CONNECTIVITY_TEXT[row.connectivity] ?? "Unknown"} · Battery: ${row.batteryLevel === null ? "not reported" : `${row.batteryLevel}%`} · Door: ${row.doorCondition}`,
      `   Condition: ${LOCK_CONDITION_LABELS[row.condition.status]}${row.condition.reasons.length > 0 ? ` — ${row.condition.reasons.join("; ")}` : ""}`,
    );
  });
  return lines.join("\n");
}
