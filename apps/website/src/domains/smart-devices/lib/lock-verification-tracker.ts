/**
 * One row of the Remote-Control Verification tab (2026-09-30). Pure: joins
 * the existing verification/condition row (lock-verification.ts) with the
 * per-step evidence (lock-verification-evidence.ts). Display-only — never
 * an input to command eligibility.
 */
import {
  OPERATIONAL_HOLD_LABELS,
  type CurrentLockState,
  type OperationalHold,
} from "./lock-health";
import {
  deriveLockVerification,
  type LockVerificationRow,
} from "./lock-verification";
import {
  buildVerificationHistory,
  isOpsConfirmedViaAugustApp,
  latestOpsEvidenceByStep,
  opsReportedFailure,
  summarizeDirection,
  type CommandEvidence,
  type DirectionEvidence,
  type RecordedOpsEvidence,
  type VerificationHistoryItem,
} from "./lock-verification-evidence";
import {
  REMOTE_CONTROL_AVAILABILITY_LABELS,
  type RemoteControlAvailabilityCode,
} from "./remote-control-availability";

export interface VerificationTrackerRow extends LockVerificationRow {
  mapping: { mapped: boolean; ops: RecordedOpsEvidence | null };
  deviceStatus: {
    connectivity: string;
    lockState: CurrentLockState;
    ops: RecordedOpsEvidence | null;
  };
  remoteLock: DirectionEvidence;
  remoteUnlock: DirectionEvidence;
  /** An onsite August-app test passed — shown as a badge, never "Verified". */
  opsConfirmedViaAugustApp: boolean;
  /** Most recent evidence of any kind (drives "checked by / date / method / notes"). */
  lastEvidence: VerificationHistoryItem | null;
  history: VerificationHistoryItem[];
  /** The current hold or command block, in plain words; null when neither. */
  holdOrBlock: string | null;
  availability: { code: RemoteControlAvailabilityCode; label: string };
}

export function buildVerificationTrackerRow(input: {
  base: LockVerificationRow;
  firstVerifiedAt: string | null;
  operationalHold: OperationalHold | null;
  lastCommandOutcome: string | null;
  mapped: boolean;
  lockState: CurrentLockState;
  commands: readonly CommandEvidence[];
  ops: readonly RecordedOpsEvidence[];
  availability: RemoteControlAvailabilityCode;
}): VerificationTrackerRow {
  const latestOps = latestOpsEvidenceByStep(input.ops);
  const history = buildVerificationHistory(input.commands, input.ops);
  const hold = input.operationalHold;
  const blocked =
    input.lastCommandOutcome === "FAILED" ||
    input.lastCommandOutcome === "AMBIGUOUS";
  return {
    ...input.base,
    verification: deriveLockVerification({
      firstVerifiedAt: input.firstVerifiedAt,
      operationalHold: hold,
      lastCommandOutcome: input.lastCommandOutcome,
      opsReportedFailure: opsReportedFailure(latestOps),
    }),
    mapping: { mapped: input.mapped, ops: latestOps.MAPPING ?? null },
    deviceStatus: {
      connectivity: input.base.connectivity,
      lockState: input.lockState,
      ops: latestOps.DEVICE_STATUS ?? null,
    },
    remoteLock: summarizeDirection(
      input.commands,
      "LOCK",
      latestOps.REMOTE_LOCK ?? null,
    ),
    remoteUnlock: summarizeDirection(
      input.commands,
      "UNLOCK",
      latestOps.REMOTE_UNLOCK ?? null,
    ),
    opsConfirmedViaAugustApp: isOpsConfirmedViaAugustApp(latestOps),
    lastEvidence: history[0] ?? null,
    history,
    holdOrBlock: hold
      ? `${OPERATIONAL_HOLD_LABELS[hold.kind]}: ${hold.note}`
      : blocked
        ? `Last remote command ${input.lastCommandOutcome} — blocked until an in-person check and admin reset`
        : null,
    availability: {
      code: input.availability,
      label: REMOTE_CONTROL_AVAILABILITY_LABELS[input.availability],
    },
  };
}
