"use client";

import { Button } from "@stayw/ui";
import { useActionState } from "react";

import type { RefreshAugustSpotActionState } from "../actions";

const INITIAL_STATE: RefreshAugustSpotActionState = { status: "idle" };

/**
 * Never a plain "refreshed" for every outcome — a real provider failure,
 * a not-found row, or an invalid selection are each worded distinctly, same
 * discipline as RefreshLocksButton's describeOutcome(). "not_found"/
 * "invalid_selection" should never actually occur from a real click here
 * (the submitted id always comes from this exact rendered row), but are
 * still worded honestly rather than assumed unreachable.
 */
function describeOutcome(outcome: RefreshAugustSpotActionState): string {
  if (outcome.status !== "success") return "";
  switch (outcome.outcome.result) {
    case "success":
      return "Refreshed.";
    case "provider_failure":
      return `Provider error: ${outcome.outcome.error ?? "unknown error"}`;
    case "not_found":
      return "This device could no longer be found.";
    case "invalid_selection":
      return "This row isn't eligible for this action.";
  }
}

function summaryTone(outcome: RefreshAugustSpotActionState): string {
  if (outcome.status === "failure") return "text-error-500";
  if (outcome.status === "success" && outcome.outcome.result === "success") {
    return "text-success-600";
  }
  if (outcome.status === "success") return "text-warning-600";
  return "text-ink-muted";
}

/**
 * One row's "Refresh telemetry" control — reads current status/battery/
 * lock state/telemetry timestamp from August for exactly this one existing
 * SmartDevice row (see refreshAugustTelemetryForSelectedLocks(),
 * lock-spot-refresh.service.ts, for the exact read/write boundary). It
 * never changes a physical lock's state, never touches a mapping, and is
 * completely separate from both the whole-fleet "Refresh telemetry" button
 * above the table and /integrations' legacy "Sync Now." isPending both
 * disables this row's own button and swaps its label, preventing a
 * duplicate click on the same row from starting a second refresh while one
 * is already running — same mechanism RefreshLocksButton/
 * RefreshThermostatsButton already use, just scoped to one row instead of
 * the whole page.
 */
export function LockSpotRefreshButton({
  smartDeviceId,
  action,
}: {
  smartDeviceId: string;
  action: (
    prevState: RefreshAugustSpotActionState,
    formData: FormData,
  ) => Promise<RefreshAugustSpotActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-start gap-1">
      <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
      <Button type="submit" size="sm" variant="secondary" disabled={isPending}>
        {isPending ? "Refreshing…" : "Refresh telemetry"}
      </Button>

      {!isPending && state.status !== "idle" && (
        <p className={`text-xs ${summaryTone(state)}`}>
          {state.status === "failure"
            ? `Refresh failed: ${state.error}`
            : describeOutcome(state)}
        </p>
      )}
    </form>
  );
}
