"use client";

import { Button } from "@stayw/ui";
import { useActionState } from "react";

import type { DiscoverActionState } from "../actions";

const INITIAL_STATE: DiscoverActionState = { status: "idle" };

/**
 * Client component so the button can show a real pending state
 * ("Discovering…") and the action's actual result (success/failure)
 * inline — a plain server-action <form> can't do either without this. The
 * action itself never throws (see actions.ts's runDiscovery) specifically
 * so a discovery failure renders here instead of crashing to the page-level
 * error boundary. `isPending` both disables the button and swaps its label,
 * which is also what prevents a double submission — React's own
 * useActionState queues/ignores further submits while one is in flight, and
 * the disabled attribute stops a second click from reaching the form at
 * all. Reused for both Nest and August — this component has no
 * provider-specific logic at all, it just renders whatever
 * label/action/state it's given.
 */
export function DiscoverDevicesButton({
  label,
  action,
}: {
  label: string;
  action: (
    prevState: DiscoverActionState,
    formData: FormData,
  ) => Promise<DiscoverActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction}>
      <Button type="submit" variant="primary" size="sm" disabled={isPending}>
        {isPending ? "Discovering…" : label}
      </Button>

      {state.status === "success" && (
        <p className="mt-1 text-xs text-success-600">
          Discovered {state.discovered} device
          {state.discovered === 1 ? "" : "s"}.
        </p>
      )}
      {state.status === "failure" && (
        <p className="mt-1 text-xs text-error-500">
          Discovery failed: {state.error}
        </p>
      )}
    </form>
  );
}
