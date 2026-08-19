"use client";

import { Button } from "@stayw/ui";
import { useActionState } from "react";

import type { SyncActionState } from "../actions";

const INITIAL_STATE: SyncActionState = { status: "idle" };

/**
 * A synced=0 result is never shown as a plain, unqualified "success" — it's
 * always exactly one of three distinguishable states, never conflated:
 *   - synced=0, skipped=0: the provider itself returned zero devices.
 *   - synced=0, skipped>0: devices exist but none had a property mapping.
 *   - anything thrown: a separate "failure" status entirely (red, distinct
 *     branch below), never reaches this function at all.
 */
function successMessage(state: { synced: number; skipped: number }): string {
  if (state.synced > 0) {
    return `Synced ${state.synced} device${state.synced === 1 ? "" : "s"}${
      state.skipped > 0
        ? ` (${state.skipped} more discovered but skipped — no property mapping)`
        : ""
    }.`;
  }
  if (state.skipped > 0) {
    return `Synced 0 devices — ${state.skipped} discovered but skipped (no property mapping).`;
  }
  return "Provider returned 0 devices — nothing to sync.";
}

/** Real synced devices get green; either zero-synced case gets amber, not green — even the color shouldn't read as a generic identical "success" across all three. */
function successTone(state: { synced: number }): string {
  return state.synced > 0 ? "text-success-600" : "text-warning-600";
}

/**
 * Client component so the button can show a real pending state ("Syncing…")
 * and the action's actual result (success/failure/already-running) inline —
 * a plain server-action <form> can't do either without this. The action
 * itself never throws (see actions.ts) specifically so a sync failure
 * renders here instead of crashing to the page-level error boundary.
 */
export function SyncNowButton({
  connectionId,
  action,
}: {
  connectionId: string;
  action: (
    connectionId: string,
    prevState: SyncActionState,
    formData: FormData,
  ) => Promise<SyncActionState>;
}) {
  const [state, formAction, isPending] = useActionState(
    action.bind(null, connectionId),
    INITIAL_STATE,
  );

  return (
    <form action={formAction}>
      <Button
        type="submit"
        variant="primary"
        size="sm"
        className="w-full"
        disabled={isPending}
      >
        {isPending ? "Syncing…" : "Sync now"}
      </Button>

      {state.status === "success" && (
        <p className={`mt-1 text-xs ${successTone(state)}`}>
          {successMessage(state)}
        </p>
      )}
      {state.status === "failure" && (
        <p className="mt-1 text-xs text-error-500">
          Sync failed: {state.error}
        </p>
      )}
      {state.status === "already_running" && (
        <p className="mt-1 text-xs text-ink-muted">
          A sync is already in progress for this connection.
        </p>
      )}
    </form>
  );
}
