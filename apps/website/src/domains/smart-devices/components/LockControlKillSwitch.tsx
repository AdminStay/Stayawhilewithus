"use client";

import { ConfirmButton } from "@stayw/ui";
import { Power, ShieldOff } from "lucide-react";
import { useActionState } from "react";

import type { SetLockControlActionState } from "../actions";

const INITIAL_STATE: SetLockControlActionState = { status: "idle" };

/**
 * Global remote lock-control kill switch banner (2026-09-25). Everyone who
 * can see /locks sees whether remote control is ON or OFF; only an admin
 * (`canToggle`, a global locks:manage grant) gets the toggle. The real
 * enforcement is server-side: setLockControlEnabled() re-checks RBAC and
 * audit-logs every toggle, and sendAugustLockCommand() refuses every command
 * while it's OFF.
 */
export function LockControlKillSwitch({
  enabled,
  canToggle,
  action,
}: {
  enabled: boolean;
  canToggle: boolean;
  action?: (
    prevState: SetLockControlActionState,
    formData: FormData,
  ) => Promise<SetLockControlActionState>;
}) {
  const [state, formAction, isPending] = useActionState(
    action ?? (async () => INITIAL_STATE),
    INITIAL_STATE,
  );

  return (
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3 ${
        enabled
          ? "border-border bg-surface"
          : "border-2 border-error-500 bg-error-50"
      }`}
    >
      <div className="flex items-center gap-2 text-sm">
        {enabled ? (
          <Power className="h-4 w-4 text-success-600" />
        ) : (
          <ShieldOff className="h-4 w-4 text-error-600" />
        )}
        <span className={enabled ? "text-ink" : "font-semibold text-error-600"}>
          {enabled
            ? "Remote lock control is ON."
            : "Remote lock control is OFF. No commands can be sent to any lock."}
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
                ? "Turn OFF remote lock control? No lock or unlock command can be sent to any lock until it is turned back on."
                : "Turn ON remote lock control? Admins will be able to send lock and unlock commands to eligible locks."
            }
          >
            {isPending
              ? "Saving…"
              : enabled
                ? "Turn off remote control"
                : "Turn on remote control"}
          </ConfirmButton>
          {!isPending && state.status === "rejected" && (
            <span className="text-xs text-error-500" aria-live="polite">
              {state.reason}
            </span>
          )}
        </form>
      )}
    </div>
  );
}
