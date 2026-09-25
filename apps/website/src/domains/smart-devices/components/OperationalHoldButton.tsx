"use client";

import { Button, Dialog } from "@stayw/ui";
import { PauseCircle, PlayCircle } from "lucide-react";
import { useActionState, useState } from "react";

import type { OperationalHoldActionState } from "../actions";

const INITIAL_STATE: OperationalHoldActionState = { status: "idle" };

type HoldAction = (
  prevState: OperationalHoldActionState,
  formData: FormData,
) => Promise<OperationalHoldActionState>;

/**
 * Admin control to put a lock on hold (out of service / onsite inspection
 * required / excluded from testing) or clear an existing hold (2026-09-26).
 * Records an audit row only; never sends a command to the lock. A hold
 * blocks remote commands and testing server-side until it is cleared.
 */
export function OperationalHoldButton({
  smartDeviceId,
  lockName,
  propertyName,
  activeHoldLabel,
  setAction,
  clearAction,
}: {
  smartDeviceId: string;
  lockName: string;
  propertyName: string;
  /** Label of the active hold, or null when the lock has none. */
  activeHoldLabel: string | null;
  setAction: HoldAction;
  clearAction: HoldAction;
}) {
  const clearing = activeHoldLabel !== null;
  const [state, formAction, isPending] = useActionState(
    clearing ? clearAction : setAction,
    INITIAL_STATE,
  );
  const [open, setOpen] = useState(false);
  const done = state.status === "success";

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        onClick={() => setOpen(true)}
      >
        {clearing ? (
          <PlayCircle className="h-3.5 w-3.5" />
        ) : (
          <PauseCircle className="h-3.5 w-3.5" />
        )}
        {clearing ? "Clear hold" : "Hold"}
      </Button>
      <Dialog
        open={open}
        onClose={handleClose}
        title={clearing ? "Clear lock hold" : "Put lock on hold"}
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <p className="text-sm text-ink">
            <span className="font-medium">{propertyName}</span> — {lockName}
          </p>
          <p className="text-sm text-ink-muted">
            {clearing
              ? `Current hold: ${activeHoldLabel}. Clearing it allows remote commands and testing again (all other safety checks still apply). No command is sent.`
              : "A hold blocks remote commands and testing for this lock until an admin clears it. No command is sent."}
          </p>
          {!clearing && (
            <fieldset className="space-y-1 text-sm" disabled={done}>
              <legend className="font-medium text-ink">Hold type</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="kind" value="OUT_OF_SERVICE" /> Out of
                service
              </label>
              <label className="flex items-center gap-2">
                <input
                  type="radio"
                  name="kind"
                  value="ONSITE_INSPECTION_REQUIRED"
                />{" "}
                Onsite inspection required
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="kind" value="EXCLUDED_FROM_TESTING" />{" "}
                Excluded from testing
              </label>
            </fieldset>
          )}
          <label className="block space-y-1 text-sm">
            <span className="text-ink-muted">Reason (required)</span>
            <input
              type="text"
              name="note"
              maxLength={500}
              disabled={done}
              className="w-full rounded-md border border-border px-2 py-1"
              placeholder={
                clearing
                  ? "e.g. Lock replaced and checked on site"
                  : "e.g. Jammed per August app; replacement ordered"
              }
            />
          </label>
          {!isPending && state.status !== "idle" && (
            <p
              className={`text-xs ${done ? "text-success-600" : "text-error-500"}`}
              aria-live="polite"
            >
              {done
                ? clearing
                  ? "Hold cleared."
                  : "Hold recorded."
                : state.reason}
            </p>
          )}
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isPending}
            >
              {done ? "Close" : "Cancel"}
            </Button>
            {!done && (
              <Button type="submit" variant="primary" disabled={isPending}>
                {isPending
                  ? "Saving…"
                  : clearing
                    ? "Clear hold"
                    : "Record hold"}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </>
  );
}
