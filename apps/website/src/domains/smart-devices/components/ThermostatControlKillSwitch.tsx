"use client";

import { ConfirmButton } from "@stayw/ui";
import { Power, ShieldOff } from "lucide-react";
import { useActionState } from "react";

import type { SetThermostatControlActionState } from "../actions";

const INITIAL_STATE: SetThermostatControlActionState = { status: "idle" };

/**
 * Global remote Nest thermostat-control kill switch banner (2026-09-27,
 * Nest Phase 1), default OFF. Everyone who can see /thermostats sees
 * whether remote control is ON or OFF; only an admin (`canToggle`, a global
 * thermostats:manage grant) gets the toggle. Real enforcement is
 * server-side: setThermostatControlEnabled() re-checks RBAC and audit-logs
 * every toggle, and sendNestThermostatCommand() refuses every command while
 * it's OFF.
 */
export function ThermostatControlKillSwitch({
  enabled,
  canToggle,
  action,
}: {
  enabled: boolean;
  canToggle: boolean;
  action?: (
    prevState: SetThermostatControlActionState,
    formData: FormData,
  ) => Promise<SetThermostatControlActionState>;
}) {
  const [state, formAction, isPending] = useActionState(
    action ?? (async () => INITIAL_STATE),
    INITIAL_STATE,
  );

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
        enabled
          ? "border-warning-500 bg-warning-50"
          : "border-border bg-surface"
      }`}
    >
      <div className="flex items-center gap-2 text-sm">
        {enabled ? (
          <Power className="h-4 w-4 text-warning-600" />
        ) : (
          <ShieldOff className="h-4 w-4 text-ink-muted" />
        )}
        <span
          className={enabled ? "font-semibold text-warning-700" : "text-ink"}
        >
          {enabled
            ? "Remote Nest thermostat control is ON. Admins can send setpoint, mode and fan commands."
            : "Remote Nest thermostat control is OFF. No command can be sent to any Nest thermostat (view only)."}
        </span>
      </div>
      {canToggle && action && (
        <form action={formAction} className="flex items-center gap-2">
          <input
            type="hidden"
            name="enabled"
            value={enabled ? "false" : "true"}
          />
          <ConfirmButton
            type="submit"
            size="sm"
            variant={enabled ? "danger" : "primary"}
            disabled={isPending}
            confirmMessage={
              enabled
                ? "Turn OFF remote thermostat control? No Nest command can be sent until it is turned back on."
                : "Turn ON remote thermostat control? Admins will be able to send real setpoint, mode and fan commands to mapped Nest thermostats."
            }
          >
            {isPending
              ? "Saving…"
              : enabled
                ? "Turn off remote control"
                : "Turn on remote control"}
          </ConfirmButton>
          {!isPending && state.status === "rejected" && (
            <span className="text-xs text-error-600">{state.reason}</span>
          )}
        </form>
      )}
    </div>
  );
}
