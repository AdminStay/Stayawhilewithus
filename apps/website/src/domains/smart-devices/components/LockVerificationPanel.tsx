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
import { useState } from "react";

import { formatTimestamp } from "../lib/format-timestamp";
import {
  buildOpsVerificationChecklist,
  LOCK_CONDITION_LABELS,
  LOCK_VERIFICATION_LABELS,
  needsOpsFollowUp,
  type LockConditionStatus,
  type LockVerificationRow,
  type LockVerificationStatus,
} from "../lib/lock-verification";

const VERIFICATION_TONE: Record<LockVerificationStatus, Tone> = {
  VERIFIED: "success",
  AWAITING_OPS: "neutral",
  NOT_VERIFIED_ON_HOLD: "error",
};

const CONDITION_TONE: Record<LockConditionStatus, Tone> = {
  HEALTHY: "success",
  NEEDS_ATTENTION: "gold",
  COMMAND_BLOCKED: "warning",
  ON_HOLD: "error",
};

const CONNECTIVITY_TEXT: Record<string, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Unknown",
  ERROR: "Error",
};

const VERIFICATION_ORDER: LockVerificationStatus[] = [
  "VERIFIED",
  "AWAITING_OPS",
  "NOT_VERIFIED_ON_HOLD",
];
const CONDITION_ORDER: LockConditionStatus[] = [
  "HEALTHY",
  "NEEDS_ATTENTION",
  "COMMAND_BLOCKED",
  "ON_HOLD",
];

type VerificationFilter = "ALL" | "OPS_FOLLOW_UP" | LockVerificationStatus;
type ConditionFilter = "ALL" | LockConditionStatus;

/**
 * Remote-control verification + Ops checklist for /locks (2026-09-29).
 * Shows two separate things for every viewer: whether remote control was
 * ever verified (historical) and the lock's current condition. Read-only —
 * no controls, no requests; the checklist is copied from data the page
 * already rendered. Physical verification itself is done by the Ops team.
 */
export function LockVerificationPanel({
  rows,
  generatedAt,
}: {
  rows: LockVerificationRow[];
  /** ISO time the page data was read, printed on the checklist. */
  generatedAt: string;
}) {
  const [verificationFilter, setVerificationFilter] =
    useState<VerificationFilter>("ALL");
  const [conditionFilter, setConditionFilter] =
    useState<ConditionFilter>("ALL");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const verificationCounts = Object.fromEntries(
    VERIFICATION_ORDER.map((s) => [
      s,
      rows.filter((r) => r.verification.status === s).length,
    ]),
  ) as Record<LockVerificationStatus, number>;
  const conditionCounts = Object.fromEntries(
    CONDITION_ORDER.map((s) => [
      s,
      rows.filter((r) => r.condition.status === s).length,
    ]),
  ) as Record<LockConditionStatus, number>;
  const followUpCount = rows.filter(needsOpsFollowUp).length;

  const visible = rows
    .filter((r) =>
      verificationFilter === "ALL"
        ? true
        : verificationFilter === "OPS_FOLLOW_UP"
          ? needsOpsFollowUp(r)
          : r.verification.status === verificationFilter,
    )
    .filter(
      (r) =>
        conditionFilter === "ALL" || r.condition.status === conditionFilter,
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
        Verified means a remote command on this lock has succeeded before. It
        stays verified even if the lock&apos;s current condition changes, which
        is shown separately. Remaining physical verification is done by the Ops
        team.
      </p>

      <dl
        aria-label="Verification and condition counts"
        className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-xs"
      >
        {VERIFICATION_ORDER.map((s) => (
          <div key={s} className="flex gap-1">
            <dt className="text-ink-muted">{LOCK_VERIFICATION_LABELS[s]}</dt>
            <dd className="font-medium text-ink">{verificationCounts[s]}</dd>
          </div>
        ))}
        <span aria-hidden className="text-ink-faint">
          |
        </span>
        {CONDITION_ORDER.map((s) => (
          <div key={s} className="flex gap-1">
            <dt className="text-ink-muted">{LOCK_CONDITION_LABELS[s]}</dt>
            <dd className="font-medium text-ink">{conditionCounts[s]}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Select
          aria-label="Filter by verification"
          value={verificationFilter}
          onChange={(e) =>
            setVerificationFilter(e.target.value as VerificationFilter)
          }
          className="w-auto"
        >
          <option value="ALL">All verification</option>
          <option value="OPS_FOLLOW_UP">Needs Ops follow-up</option>
          {VERIFICATION_ORDER.map((s) => (
            <option key={s} value={s}>
              {LOCK_VERIFICATION_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by condition"
          value={conditionFilter}
          onChange={(e) =>
            setConditionFilter(e.target.value as ConditionFilter)
          }
          className="w-auto"
        >
          <option value="ALL">All conditions</option>
          {CONDITION_ORDER.map((s) => (
            <option key={s} value={s}>
              {LOCK_CONDITION_LABELS[s]}
            </option>
          ))}
        </Select>
        <span className="text-xs text-ink-muted">
          {visible.length} of {rows.length} locks
        </span>
      </div>

      <div className="mt-3">
        <Table>
          <TableHead>
            <TableHeaderCell className="w-[26%]">
              Property / Lock
            </TableHeaderCell>
            <TableHeaderCell className="w-[20%]">Verification</TableHeaderCell>
            <TableHeaderCell className="w-[30%]">
              Current condition
            </TableHeaderCell>
            <TableHeaderCell className="w-[8%]">Status</TableHeaderCell>
            <TableHeaderCell className="w-[8%]">Battery</TableHeaderCell>
            <TableHeaderCell className="w-[8%]">Door</TableHeaderCell>
          </TableHead>
          <TableBody>
            {visible.map((row) => (
              <TableRow key={row.smartDeviceId}>
                <TableCell className="max-w-0">
                  <div className="flex flex-col">
                    <span className="truncate font-medium text-ink">
                      {row.propertyName}
                    </span>
                    <span className="truncate text-xs text-ink-muted">
                      {row.lockName}
                    </span>
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <Badge tone={VERIFICATION_TONE[row.verification.status]}>
                      {LOCK_VERIFICATION_LABELS[row.verification.status]}
                    </Badge>
                    {row.verification.verifiedAt && (
                      <span className="text-[10px] text-ink-faint">
                        since{" "}
                        {formatTimestamp(new Date(row.verification.verifiedAt))}
                      </span>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  <div className="flex flex-col gap-0.5">
                    <Badge tone={CONDITION_TONE[row.condition.status]}>
                      {LOCK_CONDITION_LABELS[row.condition.status]}
                    </Badge>
                    {row.condition.reasons.map((reason) => (
                      <span key={reason} className="text-xs text-ink-muted">
                        {reason}
                      </span>
                    ))}
                  </div>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {CONNECTIVITY_TEXT[row.connectivity] ?? "Unknown"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {row.batteryLevel === null ? "—" : `${row.batteryLevel}%`}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {row.doorCondition}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </Card>
  );
}
