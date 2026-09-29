"use client";

import {
  Badge,
  Button,
  Card,
  Select,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type Tone,
} from "@stayw/ui";
import { ClipboardCheck } from "lucide-react";
import { Fragment, useState } from "react";

import { formatTimestamp } from "../lib/format-timestamp";
import {
  buildOpsVerificationChecklist,
  LOCK_VERIFICATION_LABELS,
  needsOpsFollowUp,
  type LockVerificationStatus,
} from "../lib/lock-verification";
import {
  DIRECTION_STATUS_LABELS,
  OPS_EVIDENCE_METHOD_LABELS,
  OPS_EVIDENCE_OUTCOME_LABELS,
  VERIFICATION_STEP_LABELS,
  type DirectionEvidence,
  type DirectionStatus,
  type RecordedOpsEvidence,
} from "../lib/lock-verification-evidence";
import type { VerificationTrackerRow } from "../lib/lock-verification-tracker";

import {
  RecordVerificationEvidenceButton,
  type RecordEvidenceAction,
} from "./RecordVerificationEvidenceButton";

const VERIFICATION_TONE: Record<LockVerificationStatus, Tone> = {
  VERIFIED: "success",
  AWAITING_OPS: "neutral",
  NOT_VERIFIED_ON_HOLD: "error",
  NOT_VERIFIED_NEEDS_ATTENTION: "warning",
};

const DIRECTION_TONE: Record<DirectionStatus, Tone> = {
  PASSED: "success",
  FAILED: "error",
  AMBIGUOUS: "warning",
  RESET_AFTER_CHECK: "gold",
  NOT_TESTED: "neutral",
};

const VERIFICATION_ORDER: LockVerificationStatus[] = [
  "VERIFIED",
  "NOT_VERIFIED_NEEDS_ATTENTION",
  "AWAITING_OPS",
  "NOT_VERIFIED_ON_HOLD",
];

const CONNECTIVITY_TEXT: Record<string, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Connectivity unknown",
  ERROR: "Error",
};

const LOCK_STATE_TEXT: Record<string, string> = {
  locked: "Locked",
  unlocked: "Unlocked",
  unknown: "State unknown",
};

type Filter = "ALL" | "OPS_FOLLOW_UP" | LockVerificationStatus;

const when = (iso: string | null | undefined) =>
  iso ? formatTimestamp(new Date(iso)) : "—";

function OpsLine({ ops }: { ops: RecordedOpsEvidence | null }) {
  if (!ops) return null;
  const tone: Tone =
    ops.outcome === "PASSED"
      ? "success"
      : ops.outcome === "FAILED"
        ? "error"
        : "neutral";
  return (
    <span className="flex flex-col gap-0.5">
      <Badge tone={tone} className="text-[10px]">
        {ops.method === "AUGUST_APP_ONSITE" && ops.outcome === "PASSED"
          ? "Ops-confirmed via August app"
          : `Ops: ${OPS_EVIDENCE_OUTCOME_LABELS[ops.outcome]} (${OPS_EVIDENCE_METHOD_LABELS[ops.method]})`}
      </Badge>
      <span className="text-[10px] text-ink-faint">
        {ops.performedBy} · {when(ops.performedAt)}
      </span>
    </span>
  );
}

function DirectionCell({ evidence }: { evidence: DirectionEvidence }) {
  const { status, firstPassed, latest } = evidence;
  const laterProblem =
    firstPassed &&
    latest &&
    latest !== firstPassed &&
    latest.result !== "SUCCEEDED";
  return (
    <div className="flex flex-col gap-1">
      <Badge tone={DIRECTION_TONE[status]} className="text-[10px]">
        StayWhile: {DIRECTION_STATUS_LABELS[status]}
      </Badge>
      {firstPassed ? (
        <span className="text-[10px] text-ink-faint">
          {when(firstPassed.at)}
          {firstPassed.actorName ? ` · ${firstPassed.actorName}` : ""}
        </span>
      ) : (
        latest && (
          <span className="text-[10px] text-ink-faint">
            {when(latest.at)}
            {latest.actorName ? ` · ${latest.actorName}` : ""}
          </span>
        )
      )}
      {laterProblem && (
        <span className="text-[10px] text-ink-muted">
          Later:{" "}
          {latest.result === "ADMIN_RESET"
            ? "reset after physical check"
            : latest.result}{" "}
          {when(latest.at)}
        </span>
      )}
      <OpsLine ops={evidence.ops} />
    </div>
  );
}

/**
 * Remote-Control Verification tab (2026-09-30). Per lock: mapping, device
 * status, remote LOCK and remote UNLOCK evidence (each direction shown
 * honestly on its own), the overall status, the latest evidence, the
 * current hold/block and a full history. "Verified" needs one successful
 * StayWhile remote command in either direction — not both — and is never
 * downgraded. Ops evidence is recorded append-only by admins; nothing here
 * sends a command.
 */
export function LockVerificationTracker({
  rows,
  generatedAt,
  recordAction,
}: {
  rows: VerificationTrackerRow[];
  generatedAt: string;
  /** Present only for locks:manage holders (UX gate; the server re-checks). */
  recordAction?: RecordEvidenceAction;
}) {
  const [filter, setFilter] = useState<Filter>("ALL");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const counts = Object.fromEntries(
    VERIFICATION_ORDER.map((s) => [
      s,
      rows.filter((r) => r.verification.status === s).length,
    ]),
  ) as Record<LockVerificationStatus, number>;
  const opsConfirmedCount = rows.filter(
    (r) => r.opsConfirmedViaAugustApp,
  ).length;
  const followUpCount = rows.filter(needsOpsFollowUp).length;

  const visible = rows
    .filter((r) =>
      filter === "ALL"
        ? true
        : filter === "OPS_FOLLOW_UP"
          ? needsOpsFollowUp(r)
          : r.verification.status === filter,
    )
    .sort(
      (a, b) =>
        a.propertyName.localeCompare(b.propertyName) ||
        a.lockName.localeCompare(b.lockName),
    );

  async function handleCopy() {
    const text = buildOpsVerificationChecklist(rows, {
      generatedAt: formatTimestamp(new Date(generatedAt)),
    });
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <ClipboardCheck className="h-4 w-4 text-ink-muted" />
          <h2 className="text-sm font-semibold text-ink">
            Remote-control verification
          </h2>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleCopy}
          >
            Copy Ops verification checklist ({followUpCount})
          </Button>
          {copyState === "copied" && (
            <span className="text-xs text-success-600">Copied.</span>
          )}
          {copyState === "failed" && (
            <span className="text-xs text-error-500">
              Couldn&apos;t copy — try selecting the table instead.
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        Verified means a StayWhile remote command on this lock succeeded at
        least once (LOCK or UNLOCK — not necessarily both). It is never
        downgraded; each direction&apos;s own evidence is shown separately. An
        onsite August-app test is shown as &ldquo;Ops-confirmed via August
        app&rdquo; and does not by itself verify StayWhile&apos;s remote
        control. Recording evidence never sends a command.
      </p>

      <dl
        aria-label="Verification counts"
        className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs"
      >
        {VERIFICATION_ORDER.map((s) => (
          <div key={s} className="flex gap-1">
            <dt className="text-ink-muted">{LOCK_VERIFICATION_LABELS[s]}</dt>
            <dd className="font-medium text-ink">{counts[s]}</dd>
          </div>
        ))}
        <div className="flex gap-1">
          <dt className="text-ink-muted">Ops-confirmed via August app</dt>
          <dd className="font-medium text-ink">{opsConfirmedCount}</dd>
        </div>
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by verification"
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          className="w-auto"
        >
          <option value="ALL">All locks</option>
          <option value="OPS_FOLLOW_UP">Needs Ops follow-up</option>
          {VERIFICATION_ORDER.map((s) => (
            <option key={s} value={s}>
              {LOCK_VERIFICATION_LABELS[s]}
            </option>
          ))}
        </Select>
        <span className="text-xs text-ink-muted">
          {visible.length} of {rows.length} locks
        </span>
      </div>

      <div className="mt-3 overflow-x-auto">
        <Table>
          <TableHead>
            <TableHeaderCell>Property / Lock</TableHeaderCell>
            <TableHeaderCell>Mapping</TableHeaderCell>
            <TableHeaderCell>Device / status</TableHeaderCell>
            <TableHeaderCell>Remote LOCK</TableHeaderCell>
            <TableHeaderCell>Remote UNLOCK</TableHeaderCell>
            <TableHeaderCell>Overall</TableHeaderCell>
            <TableHeaderCell>Latest evidence</TableHeaderCell>
            <TableHeaderCell>Hold / block · Remote control</TableHeaderCell>
            <TableHeaderCell>
              <span className="sr-only">Actions</span>
            </TableHeaderCell>
          </TableHead>
          <TableBody>
            {visible.map((row) => {
              const isOpen = expanded === row.smartDeviceId;
              const last = row.lastEvidence;
              return (
                <Fragment key={row.smartDeviceId}>
                  <TableRow>
                    <TableCell>
                      <div className="flex flex-col">
                        <span className="font-medium text-ink">
                          {row.propertyName}
                        </span>
                        <span className="text-xs text-ink-muted">
                          {row.lockName}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs">
                        <span
                          className={
                            row.mapping.mapped ? "text-ink" : "text-error-500"
                          }
                        >
                          {row.mapping.mapped ? "Mapped" : "Not mapped"}
                        </span>
                        <OpsLine ops={row.mapping.ops} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs">
                        <span className="text-ink">
                          {CONNECTIVITY_TEXT[row.deviceStatus.connectivity] ??
                            "Connectivity unknown"}
                        </span>
                        <span className="text-ink-muted">
                          {LOCK_STATE_TEXT[row.deviceStatus.lockState] ??
                            "State unknown"}
                        </span>
                        <OpsLine ops={row.deviceStatus.ops} />
                      </div>
                    </TableCell>
                    <TableCell>
                      <DirectionCell evidence={row.remoteLock} />
                    </TableCell>
                    <TableCell>
                      <DirectionCell evidence={row.remoteUnlock} />
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-0.5">
                        <Badge
                          tone={VERIFICATION_TONE[row.verification.status]}
                        >
                          {LOCK_VERIFICATION_LABELS[row.verification.status]}
                        </Badge>
                        {row.verification.verifiedAt && (
                          <span className="text-[10px] text-ink-faint">
                            since {when(row.verification.verifiedAt)}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      {last ? (
                        <div className="flex flex-col text-xs">
                          <span className="text-ink">
                            {VERIFICATION_STEP_LABELS[last.step]}:{" "}
                            {last.outcome}
                          </span>
                          <span className="text-ink-muted">
                            {last.by ?? "Unknown user"} · {when(last.at)}
                          </span>
                          <span className="text-[10px] text-ink-faint">
                            {last.method}
                          </span>
                          {last.notes && (
                            <span className="text-[10px] text-ink-muted">
                              {last.notes}
                            </span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-ink-faint">
                          No evidence yet
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col gap-1 text-xs">
                        {row.holdOrBlock ? (
                          <span className="text-error-500">
                            {row.holdOrBlock}
                          </span>
                        ) : (
                          <span className="text-ink-faint">
                            No hold or block
                          </span>
                        )}
                        <span
                          className={
                            row.availability.code === "AVAILABLE"
                              ? "text-success-600"
                              : "text-ink-muted"
                          }
                        >
                          Remote control: {row.availability.label}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          aria-expanded={isOpen}
                          onClick={() =>
                            setExpanded(isOpen ? null : row.smartDeviceId)
                          }
                        >
                          History ({row.history.length})
                        </Button>
                        {recordAction && (
                          <RecordVerificationEvidenceButton
                            smartDeviceId={row.smartDeviceId}
                            lockName={row.lockName}
                            propertyName={row.propertyName}
                            action={recordAction}
                          />
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {isOpen && (
                    <TableRow>
                      <TableCell colSpan={9}>
                        {row.history.length === 0 ? (
                          <p className="text-xs text-ink-faint">
                            No verification evidence recorded for this lock.
                          </p>
                        ) : (
                          <ol
                            aria-label={`Verification history for ${row.propertyName} — ${row.lockName}`}
                            className="space-y-1 text-xs"
                          >
                            {row.history.map((item, i) => (
                              <li
                                key={`${item.at}-${i}`}
                                className="flex flex-wrap gap-x-2"
                              >
                                <span className="text-ink-faint">
                                  {when(item.at)}
                                </span>
                                <span className="font-medium text-ink">
                                  {VERIFICATION_STEP_LABELS[item.step]}:{" "}
                                  {item.outcome}
                                </span>
                                <span className="text-ink-muted">
                                  {item.method}
                                </span>
                                <span className="text-ink-muted">
                                  by {item.by ?? "unknown user"}
                                  {item.recordedBy
                                    ? ` (recorded by ${item.recordedBy})`
                                    : ""}
                                </span>
                                {item.notes && (
                                  <span className="text-ink-muted">
                                    — {item.notes}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ol>
                        )}
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
