"use client";

import { Button } from "@stayw/ui";
import { RefreshCw } from "lucide-react";
import { useActionState } from "react";

import type { SyncOwnerRezReservationsActionState } from "../actions";

const INITIAL_STATE: SyncOwnerRezReservationsActionState = { status: "idle" };

function describeOutcome(
  state: Extract<SyncOwnerRezReservationsActionState, { status: "success" }>,
): string {
  const parts = [`${state.created} new`, `${state.updated} updated`];
  if (state.unmatchedProperty.length > 0) {
    parts.push(`${state.unmatchedProperty.length} unmatched property`);
  }
  if (state.unrecognizedStatus.length > 0) {
    parts.push(`${state.unrecognizedStatus.length} unrecognized status`);
  }
  if (state.guestErrors.length > 0) {
    parts.push(
      `${state.guestErrors.length} guest error${state.guestErrors.length === 1 ? "" : "s"}`,
    );
  }
  return `OwnerRez sync: ${parts.join(", ")}.`;
}

/**
 * The manual "Sync Now" control for real OwnerRez -> Reservation
 * synchronization — see syncOwnerRezReservationsAction /
 * ownerrez-reservation-sync.service.ts for the full read/write boundary.
 * Same isPending-disables-and-relabels convention as RefreshLocksButton, so
 * a duplicate click can't start a second overlapping sync (the service's
 * own advisory lock already prevents this too — this is UX, not the real
 * guard).
 */
export function SyncOwnerRezReservationsButton({
  action,
}: {
  action: (
    prevState: SyncOwnerRezReservationsActionState,
    formData: FormData,
  ) => Promise<SyncOwnerRezReservationsActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button
        type="submit"
        variant="secondary"
        size="sm"
        disabled={isPending}
        title="Fetches real OwnerRez bookings and creates/updates matching StayWhile reservations. Never writes back to OwnerRez."
      >
        <RefreshCw
          className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`}
        />
        {isPending ? "Syncing…" : "Sync OwnerRez"}
      </Button>

      {!isPending && state.status === "success" && (
        <p className="text-right text-xs text-ink-muted">
          {describeOutcome(state)}
        </p>
      )}

      {!isPending && state.status === "already_running" && (
        <p className="text-xs text-ink-muted">
          Another OwnerRez sync is already in progress — try again shortly.
        </p>
      )}

      {!isPending && state.status === "failure" && (
        <p className="text-xs text-error-500">Sync failed: {state.error}</p>
      )}
    </form>
  );
}
