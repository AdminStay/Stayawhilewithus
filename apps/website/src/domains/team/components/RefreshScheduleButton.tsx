"use client";

import { Button } from "@stayw/ui";
import { useActionState } from "react";

import type { RefreshTeamScheduleActionState } from "../actions";

import { formatTimestamp } from "@/domains/smart-devices/lib/format-timestamp";

const INITIAL_STATE: RefreshTeamScheduleActionState = { status: "idle" };

/**
 * On-demand re-fetch of Michelle's schedule sheet — mirrors
 * RefreshThermostatsButton's exact isPending/disabled-during-submit
 * pattern, the one already proven to reliably submit on this dashboard.
 */
export function RefreshScheduleButton({
  action,
}: {
  action: (
    prevState: RefreshTeamScheduleActionState,
    formData: FormData,
  ) => Promise<RefreshTeamScheduleActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form action={formAction} className="flex flex-col items-end gap-1">
      <Button type="submit" variant="secondary" size="sm" disabled={isPending}>
        {isPending ? "Refreshing…" : "Refresh"}
      </Button>

      {!isPending && state.status === "success" && (
        <p className="text-right text-xs text-ink-muted">
          Last refreshed: {formatTimestamp(new Date(state.refreshedAt))}
        </p>
      )}

      {!isPending && state.status === "failure" && (
        <p className="text-xs text-error-500">Refresh failed: {state.error}</p>
      )}
    </form>
  );
}
