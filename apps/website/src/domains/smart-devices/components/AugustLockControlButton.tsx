"use client";

import { Button, Dialog } from "@stayw/ui";
import { useActionState, useState } from "react";

import type { AugustLockCommandActionState } from "../actions";

const INITIAL_STATE: AugustLockCommandActionState = { status: "idle" };

const OPERATION_LABEL = { LOCK: "Lock", UNLOCK: "Unlock" } as const;

function resultMessage(state: AugustLockCommandActionState): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "success":
      return `Confirmed — this lock now reports "${state.lockState ?? "an unreported state"}".`;
    case "rejected":
      return state.reason;
    case "already_running":
      return "Another command is already in progress for this lock — try again shortly.";
    case "failure":
      return state.reason;
  }
}

function resultTone(state: AugustLockCommandActionState): string {
  return state.status === "success" ? "text-success-600" : "text-error-500";
}

/**
 * One row's Lock/Unlock control — the confirm-before-send physical command
 * counterpart to LockSpotRefreshButton's read-only refresh above. Every
 * safety property required for this feature lives server-side
 * (sendAugustLockCommand, via the sendAugustLockCommandAction passed in) —
 * this component's own job is purely UX: never let a click send a command
 * without an explicit confirmation naming exactly which lock/property/
 * action, and never claim success before the server confirms it.
 *
 * The trigger button opens a confirmation dialog; the actual submit lives
 * inside that dialog, not on the trigger itself, so a single accidental
 * click can never send a physical command. The dialog stays open through
 * the pending/result states (closing is blocked by handleClose() while
 * `isPending`) so the operator always sees the real outcome before
 * dismissing it — this is not a toast that could go unnoticed.
 *
 * `smartDeviceId`/`operation` are the only two values submitted — both
 * come from this exact rendered row's own props, never a name the operator
 * could edit; targeting is entirely server-side from `smartDeviceId`
 * onward (see august-commands.service.ts), so there's no path here that
 * could substitute a different lock.
 */
export function AugustLockControlButton({
  smartDeviceId,
  operation,
  lockName,
  propertyName,
  action,
}: {
  smartDeviceId: string;
  operation: "LOCK" | "UNLOCK";
  lockName: string;
  propertyName: string;
  action: (
    prevState: AugustLockCommandActionState,
    formData: FormData,
  ) => Promise<AugustLockCommandActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [open, setOpen] = useState(false);
  const label = OPERATION_LABEL[operation];

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
      >
        {label}
      </Button>

      <Dialog open={open} onClose={handleClose} title={`${label} this lock?`}>
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <input type="hidden" name="operation" value={operation} />

          <p className="text-sm text-ink">
            {label} &ldquo;{lockName}&rdquo; at {propertyName}?
          </p>

          {isPending && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              Sending command…
            </p>
          )}
          {!isPending && state.status !== "idle" && (
            <p className={`text-xs ${resultTone(state)}`} aria-live="polite">
              {resultMessage(state)}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isPending}
            >
              {state.status === "success" ? "Close" : "Cancel"}
            </Button>
            {state.status !== "success" && (
              <Button
                type="submit"
                variant={operation === "UNLOCK" ? "danger" : "primary"}
                disabled={isPending}
              >
                {isPending ? `${label}ing…` : `Confirm ${label}`}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </>
  );
}
