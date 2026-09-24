"use client";

import { Button, Dialog } from "@stayw/ui";
import { Lock, ShieldAlert, Unlock } from "lucide-react";
import { useActionState, useState } from "react";

import type { AugustLockCommandActionState } from "../actions";

const INITIAL_STATE: AugustLockCommandActionState = { status: "idle" };

/**
 * Four real outcomes, deliberately worded so none can be mistaken for
 * another (2026-09-24 review):
 *
 *   - "success": the only case that reports a real, provider-confirmed
 *     lock state — never guessed, never shown for any other outcome.
 *   - "failure": a REAL command reached August and did not succeed
 *     (a genuine 403, a bridge timeout/busy/offline, etc. — see
 *     translateAugustCommandError()). Some of those underlying reasons say
 *     "try again shortly" on their own (a 423/408 is transient at the
 *     provider level), which would read as an invitation to immediately
 *     retry a device this workflow must now treat as permanently BLOCKED
 *     (the same computeFirstTestEligibility()/computeLockControlEligibility
 *     rule Majestic's real 403 is held to) — so this message leads with
 *     "did not succeed" / "BLOCKED" / "do not retry" first, with the raw
 *     safe reason folded in as supporting detail, never the other way
 *     around.
 *   - "rejected": StayWhile's OWN pre-flight refused before any real
 *     command reached the provider at all (capability/allowlist/etc.) —
 *     never phrased as a failure of the physical lock, and explicitly
 *     says the device stays eligible for a future test once the named
 *     cause is corrected — this is the one outcome computeFirstTestEligibility
 *     treats as non-blocking, and the copy here must not contradict that.
 *   - "already_running": nothing new was sent at all; explicitly says so,
 *     so it's never confused with either a success or a real failure.
 *
 * None of these ever claims or implies a physical state beyond what
 * "success" actually got confirmed by the provider.
 */
function resultMessage(state: AugustLockCommandActionState): string | null {
  switch (state.status) {
    case "idle":
      return null;
    case "success":
      return `Confirmed — this lock now reports "${state.lockState ?? "an unreported state"}". Routine Lock/Unlock controls are now available for it.`;
    case "rejected":
      return `This test was stopped before reaching the lock — no physical command was sent. Reason: ${state.reason} This device remains not-yet-verified; a future test may be attempted once this is corrected.`;
    case "already_running":
      return "No new command was sent — another command is already in progress for this lock. Wait for it to finish, then try again.";
    case "failure":
      return `This test did not succeed — a real command reached the lock and failed: ${state.reason} This device is now BLOCKED from further testing through this workflow. Do not retry; contact an admin.`;
  }
}

function resultTone(state: AugustLockCommandActionState): string {
  if (state.status === "success") return "text-success-600";
  if (state.status === "failure") return "text-error-500";
  // "rejected" (stopped before reaching the lock) and "already_running"
  // (nothing sent at all) are both distinct from a real physical failure —
  // a separate, less alarming tone keeps an operator from reading either
  // as "this lock is broken," which only a real FAILED outcome means.
  return "text-warning-600";
}

/**
 * The deliberately-separate "first verification test" workflow (2026-09-24)
 * — see computeFirstTestEligibility()'s own doc comment (august-commands
 * .service.ts) for why this exists: computeLockControlEligibility() only
 * ever shows ordinary Lock/Unlock as available once a real SUCCEEDED
 * outcome is already on record, which meant no not-yet-tested device could
 * ever earn that first outcome through the dashboard at all. This
 * component is that missing first rung — visually and textually distinct
 * from AugustLockControlButton (a dashed-border trigger, an explicit "this
 * is not routine control" dialog title, a physical-movement warning), so
 * an operator can never mistake a first live test for routine daily use.
 *
 * Submits through the exact same, completely unchanged
 * sendAugustLockCommandAction -> sendAugustLockCommand() path as ordinary
 * Lock/Unlock — every existing safety layer (mapping/enabled check,
 * property-scoped locks:manage RBAC, the advisory-lock duplicate-command
 * guard, the fresh live capability check, the server-side-only
 * AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS allowlist, the post-command
 * provider-confirmation read, and AuditLog recording) applies identically
 * and is not reimplemented here. This component adds no new command
 * backend — only a new, narrower trigger onto the old one.
 *
 * Never pre-selects LOCK or UNLOCK: both are separate, equally-weighted
 * submit buttons (`name="operation"`, distinct `value`s) inside one shared
 * form — the operator's own click, not a default, decides which value
 * `sendAugustLockCommandAction` ever receives. No allowlist/environment
 * value is read, held, or displayed anywhere in this file — eligibility to
 * even show this control comes from the caller's `FirstTestEligibility`
 * (safe, non-secret criteria only); the real allowlist stays a
 * server-side-only final gate that can still REJECT this exact same
 * attempt before any provider call, exactly as it always has.
 *
 * Once a real outcome is on record (success, failure, or a pre-flight
 * rejection), both operation buttons disappear — closing and reopening
 * this dialog (which re-reads the freshly-revalidated page's own
 * eligibility) is required for any further action, so a stale render can
 * never be used to silently retry a command that just failed or a test
 * that already succeeded.
 */
export function AugustFirstTestButton({
  smartDeviceId,
  lockName,
  propertyName,
  currentLockState,
  action,
}: {
  smartDeviceId: string;
  lockName: string;
  propertyName: string;
  /** Last known lock state from telemetry, or null — rendered as "UNKNOWN" verbatim, never guessed. */
  currentLockState: string | null;
  action: (
    prevState: AugustLockCommandActionState,
    formData: FormData,
  ) => Promise<AugustLockCommandActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const [open, setOpen] = useState(false);

  // A real, on-record outcome (of any kind) — not "already_running", which
  // means nothing was actually attempted yet.
  const decided =
    state.status === "success" ||
    state.status === "failure" ||
    state.status === "rejected";

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
        className="border-dashed"
        title="This lock has never been remotely controlled before — run a one-time verification test."
      >
        <ShieldAlert className="h-3.5 w-3.5" />
        Test controllability
      </Button>

      <Dialog
        open={open}
        onClose={handleClose}
        title="First verification test — not routine control"
      >
        <form action={formAction} className="space-y-4">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />

          <div className="space-y-2 text-sm text-ink">
            <p>
              <span className="font-medium">{propertyName}</span> — {lockName}
            </p>
            <p className="text-ink-muted">
              Current known state:{" "}
              <span className="font-medium text-ink">
                {currentLockState ?? "UNKNOWN"}
              </span>
            </p>
            <p className="text-warning-600">
              This lock has never been successfully remotely controlled before.
              Confirming an operation below sends a real command that will
              physically move this lock. Choose exactly one operation — nothing
              is sent until you do.
            </p>
          </div>

          {isPending && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              Sending test command…
            </p>
          )}
          {!isPending && state.status !== "idle" && (
            <p className={`text-xs ${resultTone(state)}`} aria-live="polite">
              {resultMessage(state)}
            </p>
          )}

          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isPending}
            >
              {decided ? "Close" : "Cancel"}
            </Button>
            {!decided && (
              <>
                <Button
                  type="submit"
                  name="operation"
                  value="LOCK"
                  variant="primary"
                  disabled={isPending}
                >
                  <Lock className="h-3.5 w-3.5" />
                  {isPending ? "Testing…" : "Confirm — test LOCK"}
                </Button>
                <Button
                  type="submit"
                  name="operation"
                  value="UNLOCK"
                  variant="danger"
                  disabled={isPending}
                >
                  <Unlock className="h-3.5 w-3.5" />
                  {isPending ? "Testing…" : "Confirm — test UNLOCK"}
                </Button>
              </>
            )}
          </div>
        </form>
      </Dialog>
    </>
  );
}
