"use client";

import { Button, Card } from "@stayw/ui";
import { useState } from "react";

import type { RefreshAugustBatchActionState } from "../actions";
import type { SpotRefreshOutcome } from "../services/lock-spot-refresh.service";

/**
 * Must match refreshAugustBatchSchema's max(5) (lock-spot-refresh.schema.ts)
 * exactly — that schema is the real enforcement point (server-side, applies
 * no matter what any client ever sends); this constant only decides how the
 * browser chunks a selection so every submitted group already satisfies it,
 * instead of relying on the server to reject an oversized one.
 */
const MAX_IDS_PER_BATCH = 5;

export interface BulkRefreshRow {
  id: string;
  propertyName: string;
  name: string;
  /**
   * Passed straight through from the same SmartDevice rows the page already
   * loaded for LocksList's own "Last synced" column (lock.updatedAt) — no
   * second query. Informational only: never used to filter, sort, or
   * pre-select a row, so an operator can't be nudged toward re-refreshing a
   * lock just because it looks stale.
   */
  lastSyncedAt: Date | null;
}

function formatLastSynced(date: Date | null): string {
  return date ? new Date(date).toLocaleString() : "—";
}

type GroupState =
  | { status: "pending"; ids: string[] }
  | { status: "running"; ids: string[] }
  | { status: "done"; ids: string[]; outcomes: SpotRefreshOutcome[] }
  | { status: "error"; ids: string[]; error: string };

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

function describeResult(result: SpotRefreshOutcome["result"]): string {
  switch (result) {
    case "success":
      return "Refreshed";
    case "provider_failure":
      return "Provider error";
    case "not_found":
      return "Not found";
    case "invalid_selection":
      return "Not eligible";
  }
}

function resultTone(result: SpotRefreshOutcome["result"]): string {
  if (result === "success") return "text-success-600";
  if (result === "provider_failure") return "text-error-500";
  return "text-warning-600";
}

/**
 * Operator-driven bulk refresh for /locks — lets the operator select several
 * eligible August locks and refresh them without clicking each row's own
 * LockSpotRefreshButton individually. Deliberately calls no new refresh
 * logic itself: every group submitted here goes through
 * refreshAugustTelemetryBatchAction (actions.ts), which calls the exact same
 * refreshAugustTelemetryForSelectedLocks() service every other refresh path
 * in this domain already uses.
 *
 * Groups are capped at MAX_IDS_PER_BATCH (5) client-side and run strictly
 * one at a time: a group is only submitted after the previous group's
 * server response has come back, and — deliberately, matching this app's
 * existing "pause and review" operating convention for a Production
 * fleet-wide action — the operator must click "Refresh next group" between
 * groups rather than every group firing automatically back-to-back. This
 * keeps each server invocation short (bounded to what
 * AUGUST_DETAIL_CONCURRENCY already proved safe) and lets the operator see
 * each group's real per-device results, including a 401/429/provider error
 * surfaced on that exact group, before deciding to continue.
 *
 * `rows` is expected to already be filtered to eligible August locks by the
 * caller (provider === "AUGUST", not demo) — this component doesn't
 * re-derive eligibility; a genuinely ineligible id submitted anyway would
 * still just come back invalid_selection from the service, never a write.
 *
 * Selection always starts empty (useState(new Set())) — nothing is
 * preselected, "Select all" included, so an operator who already refreshed
 * some of these locks by hand can't accidentally resubmit them without
 * deliberately choosing to. Each row also shows its current Last Synced
 * (from the page's existing SmartDevice load, no extra query) purely as a
 * reference for the operator — it is never read by this component's own
 * selection, filtering, or submission logic.
 */
export function LockBulkRefreshPanel({
  rows,
  action,
}: {
  rows: BulkRefreshRow[];
  action: (
    prevState: RefreshAugustBatchActionState,
    formData: FormData,
  ) => Promise<RefreshAugustBatchActionState>;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [groups, setGroups] = useState<GroupState[] | null>(null);
  const [runningIndex, setRunningIndex] = useState<number | null>(null);

  const rowById = new Map(rows.map((row) => [row.id, row]));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runGroupAt(index: number, base: GroupState[]) {
    const target = base[index];
    if (!target) return;

    setRunningIndex(index);
    setGroups(
      base.map((group, i) =>
        i === index ? { ...group, status: "running" as const } : group,
      ),
    );

    const formData = new FormData();
    for (const id of target.ids) formData.append("smartDeviceId", id);

    let outcome: GroupState;
    try {
      const result = await action({ status: "idle" }, formData);
      if (result.status === "success") {
        outcome = {
          status: "done",
          ids: target.ids,
          outcomes: result.outcomes,
        };
      } else if (result.status === "failure") {
        outcome = { status: "error", ids: target.ids, error: result.error };
      } else {
        // Structurally unreachable — the action never resolves back to
        // "idle" — but never assume an invariant blindly rather than widen
        // the type unsafely.
        outcome = {
          status: "error",
          ids: target.ids,
          error: "Unexpected idle response from the refresh action.",
        };
      }
    } catch (err) {
      // A group's own request failing outright (thrown, not a returned
      // failure state) must still be visible on this exact group, never
      // silently dropped or mistaken for the group having succeeded.
      outcome = {
        status: "error",
        ids: target.ids,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    setGroups((prev) => {
      const current = prev ?? base;
      return current.map((group, i) => (i === index ? outcome : group));
    });
    setRunningIndex(null);
  }

  function start() {
    const ids = rows.map((row) => row.id).filter((id) => selected.has(id));
    const built: GroupState[] = chunk(ids, MAX_IDS_PER_BATCH).map((ids) => ({
      status: "pending",
      ids,
    }));
    setGroups(built);
    void runGroupAt(0, built);
  }

  function reset() {
    setGroups(null);
    setSelected(new Set());
  }

  const startedCount = groups
    ? groups.filter((group) => group.status !== "pending").length
    : 0;
  const nextPendingIndex = startedCount;
  const allComplete =
    groups !== null && runningIndex === null && startedCount === groups.length;

  return (
    <Card>
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">
            Bulk refresh telemetry
          </h3>
          <p className="text-xs text-ink-muted">
            Select locks, then refresh in groups of at most {MAX_IDS_PER_BATCH}.
            Each group must finish — and you must confirm — before the next one
            starts.
          </p>
        </div>
        {!groups && (
          <div className="flex shrink-0 gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelected(new Set(rows.map((row) => row.id)))}
            >
              Select all
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setSelected(new Set())}
            >
              Select none
            </Button>
          </div>
        )}
      </div>

      {!groups && (
        <>
          <ul className="mb-4 max-h-64 space-y-1 overflow-y-auto text-sm">
            {rows.map((row) => (
              <li key={row.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`bulk-refresh-${row.id}`}
                  checked={selected.has(row.id)}
                  onChange={() => toggle(row.id)}
                />
                <label
                  htmlFor={`bulk-refresh-${row.id}`}
                  className="text-ink-muted"
                >
                  {row.propertyName} — {row.name}
                  {" — Last synced: "}
                  {formatLastSynced(row.lastSyncedAt)}
                </label>
              </li>
            ))}
          </ul>
          <Button size="sm" disabled={selected.size === 0} onClick={start}>
            {selected.size === 0
              ? "Start bulk refresh"
              : `Start bulk refresh (${selected.size} device${
                  selected.size === 1 ? "" : "s"
                }, ${Math.ceil(
                  selected.size / MAX_IDS_PER_BATCH,
                )} group${Math.ceil(selected.size / MAX_IDS_PER_BATCH) === 1 ? "" : "s"})`}
          </Button>
        </>
      )}

      {groups && (
        <div className="space-y-3">
          {groups.map((group, index) => (
            <div key={index} className="rounded-card border border-border p-3">
              <p className="text-xs font-medium text-ink">
                Group {index + 1} of {groups.length} — {group.ids.length} device
                {group.ids.length === 1 ? "" : "s"} —{" "}
                {group.status === "pending" && "Not started"}
                {group.status === "running" && "Refreshing…"}
                {group.status === "done" && "Complete"}
                {group.status === "error" && "Failed"}
              </p>

              {group.status === "done" && (
                <ul className="mt-2 space-y-1 text-xs">
                  {group.outcomes.map((outcome) => {
                    const row = rowById.get(outcome.smartDeviceId);
                    return (
                      <li
                        key={outcome.smartDeviceId}
                        className={resultTone(outcome.result)}
                      >
                        {row
                          ? `${row.propertyName} — ${row.name}`
                          : outcome.smartDeviceId}
                        {": "}
                        {describeResult(outcome.result)}
                        {outcome.error ? ` (${outcome.error})` : ""}
                      </li>
                    );
                  })}
                </ul>
              )}

              {group.status === "error" && (
                <p className="mt-2 text-xs text-error-500">
                  Group failed before any per-device result came back:{" "}
                  {group.error}
                </p>
              )}
            </div>
          ))}

          <div className="flex items-center gap-3">
            {runningIndex === null &&
              !allComplete &&
              nextPendingIndex < groups.length && (
                <Button
                  size="sm"
                  onClick={() => void runGroupAt(nextPendingIndex, groups)}
                >
                  Refresh next group ({nextPendingIndex + 1} of {groups.length})
                </Button>
              )}
            {allComplete && (
              <Button size="sm" variant="secondary" onClick={reset}>
                Start over
              </Button>
            )}
          </div>
        </div>
      )}
    </Card>
  );
}
