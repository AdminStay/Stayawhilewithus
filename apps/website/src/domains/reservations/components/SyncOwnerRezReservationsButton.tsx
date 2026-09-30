"use client";

import { Button, Dialog } from "@stayw/ui";
import { Database } from "lucide-react";
import { useActionState, useState } from "react";

import type { SyncOwnerRezReservationsActionState } from "../actions";

const INITIAL_STATE: SyncOwnerRezReservationsActionState = { status: "idle" };

function describeOutcome(
  state: Extract<SyncOwnerRezReservationsActionState, { status: "success" }>,
): string {
  const parts = [`${state.created} new`, `${state.updated} updated`];
  // 2026-09-30: existing reservations already identical to OwnerRez are
  // no longer rewritten; shown only when there are any.
  if (state.unchanged > 0) parts.push(`${state.unchanged} unchanged`);
  if (state.unmatchedProperty.length > 0) {
    parts.push(`${state.unmatchedProperty.length} unmatched property`);
  }
  if (state.unrecognizedStatus.length > 0) {
    parts.push(`${state.unrecognizedStatus.length} unrecognized status`);
  }
  const nonGuest = Object.values(state.nonGuest).reduce((a, b) => a + b, 0);
  if (nonGuest > 0) {
    parts.push(`${nonGuest} non-guest skipped`);
  }
  if (state.guestErrors.length > 0) {
    parts.push(
      `${state.guestErrors.length} guest error${state.guestErrors.length === 1 ? "" : "s"}`,
    );
  }
  if (state.guestDeferred.length > 0) {
    parts.push(`${state.guestDeferred.length} deferred`);
  }
  return `OwnerRez sync: ${parts.join(", ")}.`;
}

function ctTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Outcome({ state }: { state: SyncOwnerRezReservationsActionState }) {
  if (state.status === "success") {
    return (
      <div className="space-y-1">
        <p className="text-xs text-ink-muted">{describeOutcome(state)}</p>
        {state.guestDeferred.length > 0 && state.deferredUntil && (
          <p className="text-xs text-warning-600">
            OwnerRez&apos;s request limit was reached, so{" "}
            {state.guestDeferred.length} booking
            {state.guestDeferred.length === 1 ? " was" : "s were"} deferred. Run
            the sync again after {ctTime(state.deferredUntil)} CT to finish
            them.
          </p>
        )}
      </div>
    );
  }
  if (state.status === "cooldown") {
    return (
      <p className="text-xs text-warning-600">
        Waiting for OwnerRez&apos;s request limit to reset — run the sync again
        after {ctTime(state.cooldownUntil)} CT.
      </p>
    );
  }
  if (state.status === "already_running") {
    return (
      <p className="text-xs text-ink-muted">
        Another OwnerRez sync is already in progress — try again shortly.
      </p>
    );
  }
  if (state.status === "failure") {
    return <p className="text-xs text-error-500">Sync failed: {state.error}</p>;
  }
  return null;
}

/**
 * "Sync OwnerRez" (2026-09-28): the real write sync, behind an explicit
 * confirmation. The first click only opens a dialog; Cancel, the close
 * button, Escape or a backdrop click do nothing. Only "Confirm Sync" submits
 * syncOwnerRezReservationsAction (which creates/updates Guests and
 * Reservations in StayWhile; OwnerRez itself is never modified). Confirm is
 * disabled while the sync runs and hidden after it finishes, so one opening
 * of the dialog can start at most one sync. The service's own advisory lock,
 * request budget and cooldown still apply.
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
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  function openDialog() {
    setSubmitted(false);
    setOpen(true);
  }

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <Button type="button" variant="primary" size="sm" onClick={openDialog}>
        <Database className="h-3.5 w-3.5" />
        Sync OwnerRez
      </Button>
      <p className="text-xs text-ink-muted">
        Writes Guests and Reservations into StayWhile. Asks you to confirm
        first.
      </p>
      {!open && <Outcome state={state} />}

      <Dialog open={open} onClose={handleClose} title="Sync OwnerRez">
        <form
          action={formAction}
          onSubmit={() => setSubmitted(true)}
          className="space-y-4"
        >
          <p className="text-sm text-ink">
            This will read reservation and guest information from OwnerRez and
            create or update Guests and Reservations in the StayWhile database.
          </p>
          <p className="text-sm text-ink">
            OwnerRez itself will not be modified.
          </p>

          {isPending && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              Syncing… this can take a few minutes.
            </p>
          )}
          {!isPending && submitted && (
            <div aria-live="polite">
              <Outcome state={state} />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isPending}
            >
              {submitted && !isPending ? "Close" : "Cancel"}
            </Button>
            {!submitted && (
              <Button type="submit" variant="primary" disabled={isPending}>
                <Database className="h-3.5 w-3.5" />
                Confirm Sync
              </Button>
            )}
            {submitted && isPending && (
              <Button type="button" variant="primary" disabled>
                Syncing…
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </div>
  );
}
