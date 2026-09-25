"use client";

import { Button, Dialog } from "@stayw/ui";
import { RotateCcw } from "lucide-react";
import { useActionState, useState } from "react";

import type { ResetAugustLockActionState } from "../actions";

const INITIAL_STATE: ResetAugustLockActionState = { status: "idle" };

/**
 * Admin "reset after physical check" for a lock blocked by a FAILED or
 * AMBIGUOUS outcome (2026-09-25). The admin records the state they saw at
 * the door and confirms they checked it in person. Sends no command, and
 * never marks the lock verified: afterwards it's "not yet verified" again
 * and needs the ordinary first-verification test. The server re-checks
 * admin RBAC, the blocked state, and the confirmation.
 */
export function AdminResetLockButton({
  smartDeviceId,
  lockName,
  propertyName,
  action,
}: {
  smartDeviceId: string;
  lockName: string;
  propertyName: string;
  action: (
    prevState: ResetAugustLockActionState,
    formData: FormData,
  ) => Promise<ResetAugustLockActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
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
        variant="secondary"
        onClick={() => setOpen(true)}
        title="Admin: clear this lock's block after checking the door in person."
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset after physical check
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        title="Reset after physical check"
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <p className="text-sm text-ink">
            <span className="font-medium">{propertyName}</span> — {lockName}
          </p>
          <p className="text-sm text-ink-muted">
            This clears the block from the last failed or uncertain command. No
            command is sent to the lock. The lock is NOT marked as verified; it
            will need a new verification test.
          </p>

          <fieldset className="space-y-1 text-sm" disabled={done}>
            <legend className="font-medium text-ink">
              What did you see at the door?
            </legend>
            <label className="flex items-center gap-2">
              <input type="radio" name="observedLockState" value="locked" />
              Locked
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="observedLockState" value="unlocked" />
              Unlocked
            </label>
          </fieldset>

          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              name="confirmedInPerson"
              className="mt-0.5"
              disabled={done}
            />
            I confirm the door&apos;s real state was checked in person.
          </label>

          <label className="block space-y-1 text-sm">
            <span className="text-ink-muted">Note (optional)</span>
            <input
              type="text"
              name="note"
              maxLength={500}
              disabled={done}
              className="w-full rounded-md border border-border px-2 py-1"
              placeholder="e.g. Kenny checked on site, 2pm"
            />
          </label>

          {!isPending && state.status !== "idle" && (
            <p
              className={`text-xs ${done ? "text-success-600" : "text-error-500"}`}
              aria-live="polite"
            >
              {done
                ? "Reset recorded. This lock can now be verified again with a new test."
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
                {isPending ? "Saving…" : "Record reset"}
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </>
  );
}
