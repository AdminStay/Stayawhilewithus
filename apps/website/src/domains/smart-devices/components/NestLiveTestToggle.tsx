"use client";

import { Button, ConfirmButton } from "@stayw/ui";
import { useActionState } from "react";

import type { SetNestLiveTestDeviceActionState } from "../actions";

const INITIAL_STATE: SetNestLiveTestDeviceActionState = { status: "idle" };

/**
 * Per-thermostat admin control for the Nest live-test list (2026-10-28).
 * Rendered only for an admin (global thermostats:manage). Real enforcement
 * is server-side: setNestLiveTestDevice() re-checks RBAC and eligibility,
 * and sendNestThermostatCommand() refuses any device not on the list.
 */
export function NestLiveTestToggle({
  smartDeviceId,
  deviceLabel,
  onList,
  action,
}: {
  smartDeviceId: string;
  /** "Property — device", for the confirmation message. */
  deviceLabel: string;
  onList: boolean;
  action: (
    prevState: SetNestLiveTestDeviceActionState,
    formData: FormData,
  ) => Promise<SetNestLiveTestDeviceActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);

  return (
    <form
      action={formAction}
      className="mt-1 flex flex-wrap items-center gap-2"
    >
      <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
      <input type="hidden" name="onList" value={onList ? "false" : "true"} />
      {onList ? (
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={isPending}
        >
          {isPending ? "Saving…" : "Remove from live test"}
        </Button>
      ) : (
        <ConfirmButton
          type="submit"
          size="sm"
          variant="secondary"
          disabled={isPending}
          confirmMessage={`Add ${deviceLabel} to the Nest live-test list? While remote control is ON, admins can change its setpoint (60–85°F, at most 5°F at a time). Mode and fan stay disabled.`}
        >
          {isPending ? "Saving…" : "Add to live test"}
        </ConfirmButton>
      )}
      {!isPending && state.status === "rejected" && (
        <span className="text-xs text-error-600">{state.reason}</span>
      )}
    </form>
  );
}
