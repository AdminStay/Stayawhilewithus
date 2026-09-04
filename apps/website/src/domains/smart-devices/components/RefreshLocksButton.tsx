"use client";

import { Button } from "@stayw/ui";
import { useActionState } from "react";

import type { RefreshAugustActionState } from "../actions";
import { formatTimestamp } from "../lib/format-timestamp";

const INITIAL_STATE: RefreshAugustActionState = { status: "idle" };

/**
 * Never a plain, unqualified "success" across every outcome shape — a
 * refresh with zero eligible devices, a refresh where every device failed,
 * and a refresh where some devices failed are each worded distinctly, same
 * discipline as RefreshThermostatsButton's successMessage(). Deliberately
 * never mentions connectivity/online-offline here — that's each row's own
 * Connectivity column on /locks, never summarized or implied by this
 * button, so a batch of UNKNOWN-connectivity locks can never read as if
 * this message called them "offline."
 */
function describeOutcome(state: {
  refreshed: number;
  notReturnedByProvider: number;
}): string {
  const { refreshed, notReturnedByProvider } = state;
  if (refreshed === 0 && notReturnedByProvider === 0) {
    return "August: no enabled locks to refresh.";
  }
  if (notReturnedByProvider === 0) {
    return `August: ${refreshed} lock${refreshed === 1 ? "" : "s"} refreshed.`;
  }
  if (refreshed === 0) {
    return `August: 0 refreshed, ${notReturnedByProvider} could not be refreshed.`;
  }
  return `August: ${refreshed} refreshed, ${notReturnedByProvider} could not be refreshed.`;
}

function summaryTone(state: {
  refreshed: number;
  notReturnedByProvider: number;
}): string {
  if (state.notReturnedByProvider > 0 && state.refreshed === 0) {
    return "text-error-500";
  }
  if (state.notReturnedByProvider > 0) return "text-warning-600";
  return "text-success-600";
}

/**
 * The single "Refresh telemetry" control for /locks — reads current
 * status/battery/lock state/telemetry timestamp from August for locks
 * already enabled through the ProviderDevice Map -> Enable pipeline, and
 * writes it into StayWhile's database (see refreshAugustTelemetry(),
 * lock-refresh.service.ts, for the exact read/write boundary). It never
 * changes a physical lock's state, never creates or changes a device
 * mapping, and — critically — is a completely separate mechanism from
 * /integrations' existing August "Sync Now" (the legacy
 * AUGUST_PROPERTY_MAP-driven full sync): this button only ever calls
 * refreshAugustAction -> refreshAugustTelemetry(), never
 * syncAugustDevices() or discovery. The label and helper copy below say so
 * explicitly so a VA never confuses the two. isPending both disables the
 * button and swaps its label, preventing a duplicate click from starting a
 * second refresh while one is already running — same mechanism already
 * used by RefreshThermostatsButton/DiscoverDevicesButton/SyncNowButton.
 */
export function RefreshLocksButton({
  action,
}: {
  action: (
    prevState: RefreshAugustActionState,
    formData: FormData,
  ) => Promise<RefreshAugustActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="primary" size="sm" disabled={isPending}>
        {isPending ? "Refreshing…" : "Refresh telemetry"}
      </Button>
      <p className="text-xs text-ink-muted">
        Reads current status/battery/lock state for already-enabled August locks
        — not the same as August Sync Now.
      </p>

      {!isPending && state.status === "success" && (
        <div className={`text-right text-xs ${summaryTone(state)}`}>
          <p>{describeOutcome(state)}</p>
          <p className="text-ink-muted">
            Last refreshed: {formatTimestamp(new Date(state.refreshedAt))}
          </p>
        </div>
      )}

      {!isPending && state.status === "failure" && (
        <p className="text-xs text-error-500">Refresh failed: {state.error}</p>
      )}
    </form>
  );
}
