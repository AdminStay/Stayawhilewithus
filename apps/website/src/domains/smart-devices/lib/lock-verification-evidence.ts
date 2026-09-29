/**
 * Remote-Control Verification evidence (2026-09-30, three-way /locks
 * separation). Pure: turns append-only AuditLog rows into the per-lock,
 * per-step evidence the Verification tab shows. Two evidence sources, never
 * merged into each other:
 *
 *   1. StayWhile control path — recorded automatically by the command path
 *      ("smart_device.august_lock_command" rows: SUCCEEDED / FAILED /
 *      AMBIGUOUS, plus ADMIN_RESET after an in-person check). Only this
 *      source can make a lock "Verified" (deriveLockVerification).
 *   2. Ops evidence — recorded by an admin (`locks:manage`) as a new
 *      "smart_device.lock_verification_evidence" row: an onsite August-app
 *      test ("Ops-confirmed via August app" — NOT proof of the StayWhile
 *      path) or an onsite visual/device check (mapping / device status).
 *      Recording evidence never sends a command.
 *
 * Nothing is ever edited or deleted: a correction is a newer row, and the
 * newest Ops row per step is the current one. Evidence is never inferred
 * from a lock or property name, from ONLINE status, or from August's own
 * activity log.
 */

export const LOCK_VERIFICATION_EVIDENCE_ACTION =
  "smart_device.lock_verification_evidence";

export type VerificationStep =
  "MAPPING" | "DEVICE_STATUS" | "REMOTE_LOCK" | "REMOTE_UNLOCK";

export const VERIFICATION_STEP_LABELS: Record<VerificationStep, string> = {
  MAPPING: "Mapping",
  DEVICE_STATUS: "Device / status",
  REMOTE_LOCK: "Remote LOCK",
  REMOTE_UNLOCK: "Remote UNLOCK",
};

export type OpsEvidenceMethod = "AUGUST_APP_ONSITE" | "ONSITE_VISUAL";

export const OPS_EVIDENCE_METHOD_LABELS: Record<OpsEvidenceMethod, string> = {
  AUGUST_APP_ONSITE: "Ops-confirmed via August app",
  ONSITE_VISUAL: "Onsite visual/device check",
};

/**
 * Which Ops methods can evidence which step. A remote LOCK/UNLOCK can only
 * be confirmed by an onsite August-app test — a visual check can't show a
 * remote command worked.
 */
export const OPS_METHODS_BY_STEP: Record<
  VerificationStep,
  readonly OpsEvidenceMethod[]
> = {
  MAPPING: ["ONSITE_VISUAL", "AUGUST_APP_ONSITE"],
  DEVICE_STATUS: ["ONSITE_VISUAL", "AUGUST_APP_ONSITE"],
  REMOTE_LOCK: ["AUGUST_APP_ONSITE"],
  REMOTE_UNLOCK: ["AUGUST_APP_ONSITE"],
};

export type OpsEvidenceOutcome = "PASSED" | "FAILED" | "NOT_APPLICABLE";

export const OPS_EVIDENCE_OUTCOME_LABELS: Record<OpsEvidenceOutcome, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  NOT_APPLICABLE: "Not applicable",
};

/** Stored at AuditLog.afterState.evidence. */
export interface OpsEvidence {
  version: 1;
  step: VerificationStep;
  outcome: OpsEvidenceOutcome;
  method: OpsEvidenceMethod;
  /** Who did the check onsite (may not be a dashboard user). */
  performedBy: string;
  /** When the check was done (ISO). */
  performedAt: string;
  notes: string | null;
  /** Always false: recording evidence never sends a command. */
  commandSent: false;
}

export interface RecordedOpsEvidence extends OpsEvidence {
  recordedAt: string;
  /** Dashboard user who recorded it, when known. */
  recordedByName: string | null;
}

const STEPS = new Set<string>(Object.keys(VERIFICATION_STEP_LABELS));
const METHODS = new Set<string>(Object.keys(OPS_EVIDENCE_METHOD_LABELS));
const OUTCOMES = new Set<string>(Object.keys(OPS_EVIDENCE_OUTCOME_LABELS));

/** One Ops evidence AuditLog afterState → evidence, or null when unrecognized. */
export function parseOpsEvidence(afterState: unknown): OpsEvidence | null {
  const value =
    afterState && typeof afterState === "object"
      ? (afterState as Record<string, unknown>).evidence
      : null;
  if (!value || typeof value !== "object") return null;
  const e = value as Partial<OpsEvidence>;
  if (
    typeof e.step !== "string" ||
    !STEPS.has(e.step) ||
    typeof e.method !== "string" ||
    !METHODS.has(e.method) ||
    typeof e.outcome !== "string" ||
    !OUTCOMES.has(e.outcome) ||
    !OPS_METHODS_BY_STEP[e.step as VerificationStep].includes(
      e.method as OpsEvidenceMethod,
    ) ||
    typeof e.performedBy !== "string" ||
    typeof e.performedAt !== "string"
  ) {
    return null;
  }
  return {
    version: 1,
    step: e.step as VerificationStep,
    outcome: e.outcome as OpsEvidenceOutcome,
    method: e.method as OpsEvidenceMethod,
    performedBy: e.performedBy,
    performedAt: e.performedAt,
    notes: typeof e.notes === "string" && e.notes ? e.notes : null,
    commandSent: false,
  };
}

// ---------------------------------------------------------------------------
// StayWhile control-path evidence (command audit rows)
// ---------------------------------------------------------------------------

export type CommandDirection = "LOCK" | "UNLOCK";
export type CommandEvidenceResult =
  "SUCCEEDED" | "FAILED" | "AMBIGUOUS" | "ADMIN_RESET";

export interface CommandEvidence {
  /** For ADMIN_RESET: the direction of the FAILED/AMBIGUOUS attempt it resolved (null if none). */
  direction: CommandDirection | null;
  /** The raw operation (LOCK / UNLOCK / UNLATCH), null for ADMIN_RESET. */
  operation: string | null;
  result: CommandEvidenceResult;
  at: string;
  actorName: string | null;
  /** ADMIN_RESET: the state the admin saw at the door. */
  observedLockState: string | null;
  note: string | null;
}

export interface CommandAuditRow {
  afterState: unknown;
  metadata: unknown;
  occurredAt: Date | string;
  actorName: string | null;
}

const toIso = (d: Date | string) =>
  typeof d === "string" ? d : d.toISOString();

const directionOf = (operation: unknown): CommandDirection | null =>
  operation === "LOCK"
    ? "LOCK"
    : operation === "UNLOCK" || operation === "UNLATCH"
      ? "UNLOCK"
      : null;

/**
 * Command audit rows (any order) → evidence, oldest first. REJECTED and
 * NO_ACTION_ALREADY_IN_STATE rows are skipped: nothing moved and nothing
 * was learned about the control path. An ADMIN_RESET row carries no
 * operation, so it is attributed to the direction of the FAILED/AMBIGUOUS
 * attempt it resolved (the latest one before it).
 */
export function buildCommandEvidence(
  rows: readonly CommandAuditRow[],
): CommandEvidence[] {
  const sorted = [...rows].sort(
    (a, b) => Date.parse(toIso(a.occurredAt)) - Date.parse(toIso(b.occurredAt)),
  );
  const out: CommandEvidence[] = [];
  let lastProblemDirection: CommandDirection | null = null;
  for (const row of sorted) {
    const after = (row.afterState ?? {}) as Record<string, unknown>;
    const meta = (row.metadata ?? {}) as Record<string, unknown>;
    const result = after.result;
    const note = typeof meta.note === "string" ? meta.note : null;
    if (result === "ADMIN_RESET") {
      out.push({
        direction: lastProblemDirection,
        operation: null,
        result,
        at: toIso(row.occurredAt),
        actorName: row.actorName,
        observedLockState:
          typeof after.observedLockState === "string"
            ? after.observedLockState
            : null,
        note,
      });
      lastProblemDirection = null;
      continue;
    }
    if (result !== "SUCCEEDED" && result !== "FAILED" && result !== "AMBIGUOUS")
      continue;
    const direction = directionOf(after.operation);
    if (!direction) continue;
    if (result !== "SUCCEEDED") lastProblemDirection = direction;
    out.push({
      direction,
      operation: typeof after.operation === "string" ? after.operation : null,
      result,
      at: toIso(row.occurredAt),
      actorName: row.actorName,
      observedLockState: null,
      note: null,
    });
  }
  return out;
}

export type DirectionStatus =
  "PASSED" | "FAILED" | "AMBIGUOUS" | "RESET_AFTER_CHECK" | "NOT_TESTED";

export const DIRECTION_STATUS_LABELS: Record<DirectionStatus, string> = {
  PASSED: "Passed",
  FAILED: "Failed",
  AMBIGUOUS: "Ambiguous",
  RESET_AFTER_CHECK: "Not confirmed — reset after physical check",
  NOT_TESTED: "Not tested",
};

export interface DirectionEvidence {
  /** StayWhile control path, from command history only. */
  status: DirectionStatus;
  /** First successful StayWhile command in this direction. */
  firstPassed: CommandEvidence | null;
  /** Latest StayWhile evidence in this direction (may post-date a pass). */
  latest: CommandEvidence | null;
  /** Latest Ops evidence for this step (e.g. Ops-confirmed via August app). Never changes `status`. */
  ops: RecordedOpsEvidence | null;
}

/**
 * Per-direction StayWhile evidence. A pass is historical and permanent:
 * a later FAILED/AMBIGUOUS is reported as `latest`, never erasing it.
 */
export function summarizeDirection(
  evidence: readonly CommandEvidence[],
  direction: CommandDirection,
  ops: RecordedOpsEvidence | null,
): DirectionEvidence {
  const mine = evidence.filter((e) => e.direction === direction);
  const firstPassed = mine.find((e) => e.result === "SUCCEEDED") ?? null;
  const latest = mine.at(-1) ?? null;
  let status: DirectionStatus = "NOT_TESTED";
  if (firstPassed) status = "PASSED";
  else if (latest?.result === "ADMIN_RESET") status = "RESET_AFTER_CHECK";
  else if (latest?.result === "FAILED") status = "FAILED";
  else if (latest?.result === "AMBIGUOUS") status = "AMBIGUOUS";
  return { status, firstPassed, latest, ops };
}

/** Newest Ops evidence per step (append-only: the newest row is current). */
export function latestOpsEvidenceByStep(
  evidence: readonly RecordedOpsEvidence[],
): Partial<Record<VerificationStep, RecordedOpsEvidence>> {
  const out: Partial<Record<VerificationStep, RecordedOpsEvidence>> = {};
  for (const e of evidence) {
    const current = out[e.step];
    if (
      !current ||
      Date.parse(e.performedAt) > Date.parse(current.performedAt) ||
      (e.performedAt === current.performedAt &&
        Date.parse(e.recordedAt) > Date.parse(current.recordedAt))
    ) {
      out[e.step] = e;
    }
  }
  return out;
}

/** True when the current Ops evidence for any step is a failure. */
export function opsReportedFailure(
  latest: Partial<Record<VerificationStep, RecordedOpsEvidence>>,
): boolean {
  return Object.values(latest).some((e) => e?.outcome === "FAILED");
}

/** True when an onsite August-app test passed for LOCK or UNLOCK (a badge — never "Verified"). */
export function isOpsConfirmedViaAugustApp(
  latest: Partial<Record<VerificationStep, RecordedOpsEvidence>>,
): boolean {
  return (["REMOTE_LOCK", "REMOTE_UNLOCK"] as const).some(
    (step) =>
      latest[step]?.method === "AUGUST_APP_ONSITE" &&
      latest[step]?.outcome === "PASSED",
  );
}

/** One line of a lock's verification history, newest first in the UI. */
export interface VerificationHistoryItem {
  at: string;
  step: VerificationStep;
  source: "STAYWHILE_COMMAND" | "OPS";
  method: string;
  outcome: string;
  by: string | null;
  notes: string | null;
  recordedBy: string | null;
}

const COMMAND_OUTCOME_TEXT: Record<CommandEvidenceResult, string> = {
  SUCCEEDED: "Passed",
  FAILED: "Failed",
  AMBIGUOUS: "Ambiguous",
  ADMIN_RESET: "Reset after physical check",
};

export function buildVerificationHistory(
  commands: readonly CommandEvidence[],
  ops: readonly RecordedOpsEvidence[],
): VerificationHistoryItem[] {
  const items: VerificationHistoryItem[] = [];
  for (const c of commands) {
    if (!c.direction) continue;
    items.push({
      at: c.at,
      step: c.direction === "LOCK" ? "REMOTE_LOCK" : "REMOTE_UNLOCK",
      source: "STAYWHILE_COMMAND",
      method:
        c.result === "ADMIN_RESET"
          ? "Admin reset after physical check (no command sent)"
          : `StayWhile remote ${c.operation ?? c.direction} command`,
      outcome: COMMAND_OUTCOME_TEXT[c.result],
      by: c.actorName,
      notes:
        c.result === "ADMIN_RESET"
          ? [
              c.observedLockState
                ? `Door seen ${c.observedLockState} in person.`
                : null,
              c.note,
            ]
              .filter(Boolean)
              .join(" ") || null
          : null,
      recordedBy: null,
    });
  }
  for (const e of ops) {
    items.push({
      at: e.performedAt,
      step: e.step,
      source: "OPS",
      method: OPS_EVIDENCE_METHOD_LABELS[e.method],
      outcome: OPS_EVIDENCE_OUTCOME_LABELS[e.outcome],
      by: e.performedBy,
      notes: e.notes,
      recordedBy: e.recordedByName,
    });
  }
  return items.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}
