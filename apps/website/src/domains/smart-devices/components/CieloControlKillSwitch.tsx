"use client";

import { ConfirmButton } from "@stayw/ui";
import { Power, ShieldOff } from "lucide-react";
import { useActionState } from "react";

import type { SetCieloControlActionState } from "../actions";

const INITIAL_STATE: SetCieloControlActionState = { status: "idle" };

/**
 * Cielo-only remote thermostat-control switch (2026-09-30), default OFF,
 * separate from the Nest switch. Everyone on /thermostats sees whether it
 * is ON or OFF; only a global thermostats:manage holder gets the toggle.
 * Real enforcement is server-side (setCieloControlEnabled re-checks RBAC and
 * audits; sendCieloSetpointCommand refuses every command while OFF).
 */
export function CieloControlKillSwitch({
  enabled,
  canToggle,
  action,
}: {
  enabled: boolean;
  canToggle: boolean;
  action?: (
    prevState: SetCieloControlActionState,
    formData: FormData,
  ) => Promise<SetCieloControlActionState>;
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
            ? "Remote Cielo control is ON. Admins can change the setpoint of allowlisted Cielo thermostats (setpoint only)."
            : "Remote Cielo control is OFF. No command can be sent to any Cielo thermostat (view only)."}
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
                ? "Turn OFF remote Cielo control? No Cielo command can be sent until it is turned back on."
                : "Turn ON remote Cielo control? Admins will be able to change the real setpoint of allowlisted Cielo thermostats."
            }
          >
            {isPending
              ? "Saving…"
              : enabled
                ? "Turn off Cielo control"
                : "Turn on Cielo control"}
          </ConfirmButton>
          {!isPending && state.status === "rejected" && (
            <span className="text-xs text-error-600">{state.reason}</span>
          )}
        </form>
      )}
    </div>
  );
}
