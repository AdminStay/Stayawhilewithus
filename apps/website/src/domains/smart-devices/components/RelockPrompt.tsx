"use client";

import { Button } from "@stayw/ui";
import { Lock, Unlock } from "lucide-react";
import { useActionState } from "react";

import type { AugustLockCommandActionState } from "../actions";

const INITIAL_STATE: AugustLockCommandActionState = { status: "idle" };

function relockMessage(state: AugustLockCommandActionState): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "success":
      return `Locked — the door now reports "${state.lockState ?? "an unreported state"}".`;
    case "no_action":
      return `No command was sent — the door already reports "${state.lockState ?? "locked"}".`;
    case "already_running":
      return "Another command is already in progress for this lock — try again shortly.";
    case "rejected":
    case "failure":
    case "ambiguous":
      return state.reason;
  }
}

/**
 * Prominent "lock it again" prompt shown right after a confirmed UNLOCK
 * (2026-09-25, "enable all locks") so a door is never left unlocked after a
 * test. The "Lock the door now" button is itself the explicit confirmation:
 * one click sends exactly one LOCK for this same lock, through the same
 * sendAugustLockCommandAction path and every server-side safety check as any
 * other command. Its own single-button form, so there is no implicit-submit
 * ambiguity with any other control.
 *
 * `variant="row"` is the compact form LocksList shows in the row of any
 * controllable lock that currently reports unlocked. It is data-driven, so
 * it survives the page refresh that follows a command (which can unmount an
 * open dialog, e.g. when a first test succeeds and the row switches to the
 * routine controls).
 */
export function RelockPrompt({
  smartDeviceId,
  action,
  variant = "dialog",
}: {
  smartDeviceId: string;
  variant?: "dialog" | "row";
  action: (
    prevState: AugustLockCommandActionState,
    formData: FormData,
  ) => Promise<AugustLockCommandActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const relocked = state.status === "success" || state.status === "no_action";

  return (
    <div
      role="alert"
      className={`space-y-2 rounded-lg border-2 border-warning-500 bg-warning-50 ${variant === "row" ? "p-2" : "p-3"}`}
    >
      <p
        className={`flex items-center gap-1.5 font-semibold text-warning-600 ${variant === "row" ? "text-xs" : "text-sm"}`}
      >
        <Unlock className="h-4 w-4 shrink-0" />
        {relocked
          ? "Door locked again."
          : variant === "row"
            ? "Unlocked — lock it again when you're done."
            : "This door is now UNLOCKED. Lock it again when you're done."}
      </p>
      {!relocked && (
        <form action={formAction}>
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <input type="hidden" name="operation" value="LOCK" />
          <Button
            type="submit"
            variant="primary"
            size={variant === "row" ? "sm" : undefined}
            disabled={isPending}
          >
            <Lock className="h-3.5 w-3.5" />
            {isPending ? "Locking…" : "Lock the door now"}
          </Button>
        </form>
      )}
      {!isPending && state.status !== "idle" && (
        <p
          className={`text-xs ${relocked ? "text-success-600" : "text-error-500"}`}
          aria-live="polite"
        >
          {relockMessage(state)}
        </p>
      )}
    </div>
  );
}
