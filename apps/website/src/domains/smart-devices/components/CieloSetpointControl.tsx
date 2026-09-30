"use client";

import { Button, Dialog, Input } from "@stayw/ui";
import { Thermometer } from "lucide-react";
import { useActionState, useState } from "react";

import type { CieloSetpointActionState } from "../actions";

const INITIAL_STATE: CieloSetpointActionState = { status: "idle" };

// Mirrors CIELO_SETPOINT_SAFETY (packages/integrations/src/cielo/control.ts).
// UX only — the server re-checks everything against a fresh Cielo read.
const MIN_F = 60;
const MAX_F = 85;
const MAX_STEP_F = 5;

export function cieloInputBounds(currentTargetF: number | null): {
  min: number;
  max: number;
} {
  if (currentTargetF === null) return { min: MIN_F, max: MAX_F };
  return {
    min: Math.max(MIN_F, Math.round(currentTargetF) - MAX_STEP_F),
    max: Math.min(MAX_F, Math.round(currentTargetF) + MAX_STEP_F),
  };
}

function Outcome({ state }: { state: CieloSetpointActionState }) {
  switch (state.status) {
    case "idle":
      return null;
    case "succeeded":
      return (
        <p className="text-xs text-success-600">
          Confirmed by Cielo: setpoint is now {state.confirmedTargetF}°F.
        </p>
      );
    case "ambiguous":
      return (
        <p className="text-xs text-warning-600">
          Not confirmed. {state.reason}
        </p>
      );
    case "failed":
      return <p className="text-xs text-error-500">{state.reason}</p>;
    case "rejected":
    case "invalid":
      return <p className="text-xs text-warning-600">{state.reason}</p>;
    case "already_running":
      return (
        <p className="text-xs text-warning-600">
          A command is already in progress for this thermostat.
        </p>
      );
  }
}

/**
 * Cielo setpoint control (2026-09-30, first version — setpoint only). The
 * first click only opens a confirmation dialog naming the property, the
 * thermostat and the exact change; only "Confirm and send" submits. One
 * opening of the dialog sends at most one command. Rendered only for
 * allowlisted Cielo thermostats, for users with thermostats:manage on the
 * property, while the Cielo switch is ON — all re-checked server-side.
 */
export function CieloSetpointControl({
  smartDeviceId,
  propertyName,
  deviceName,
  currentTargetF,
  action,
}: {
  smartDeviceId: string;
  propertyName: string;
  deviceName: string;
  currentTargetF: number | null;
  action: (
    prevState: CieloSetpointActionState,
    formData: FormData,
  ) => Promise<CieloSetpointActionState>;
}) {
  const [state, formAction, isPending] = useActionState(action, INITIAL_STATE);
  const bounds = cieloInputBounds(currentTargetF);
  const [target, setTarget] = useState<string>(
    currentTargetF !== null ? String(Math.round(currentTargetF)) : "",
  );
  const [open, setOpen] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const targetNumber = Number(target);
  const targetValid =
    target.trim() !== "" &&
    Number.isInteger(targetNumber) &&
    targetNumber >= bounds.min &&
    targetNumber <= bounds.max &&
    targetNumber !== currentTargetF;

  function handleClose() {
    if (isPending) return;
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Input
          type="number"
          aria-label={`New setpoint for ${deviceName} (°F)`}
          className="w-20"
          min={bounds.min}
          max={bounds.max}
          step={1}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={!targetValid}
          onClick={() => {
            setSubmitted(false);
            setOpen(true);
          }}
        >
          <Thermometer className="h-3.5 w-3.5" />
          Set temperature…
        </Button>
      </div>
      <p className="text-[11px] text-ink-faint">
        {bounds.min}–{bounds.max}°F · at most {MAX_STEP_F}°F from the current
        setpoint
      </p>
      {!open && <Outcome state={state} />}

      <Dialog
        open={open}
        onClose={handleClose}
        title="Change a real thermostat"
      >
        <form
          action={formAction}
          onSubmit={() => setSubmitted(true)}
          className="space-y-4"
        >
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <input type="hidden" name="targetTemperatureF" value={target} />
          <p className="text-sm text-ink">
            This sends a real command to the Cielo thermostat{" "}
            <strong>{deviceName}</strong> at <strong>{propertyName}</strong>.
          </p>
          <p className="text-sm text-ink">
            Setpoint: <strong>{currentTargetF ?? "unknown"}°F</strong> →{" "}
            <strong>{target}°F</strong>. Nothing else (power, mode, fan) is
            changed.
          </p>
          <p className="text-xs text-ink-muted">
            StayWhile re-reads the thermostat from Cielo first and refuses the
            change if it is offline, off, not in heat/cool/auto, or outside the
            safe range. The result is only reported as confirmed when Cielo
            itself reports the new setpoint.
          </p>

          {isPending && (
            <p className="text-xs text-ink-muted" aria-live="polite">
              Sending and waiting for Cielo to confirm…
            </p>
          )}
          {!isPending && submitted && (
            <div aria-live="polite">
              <Outcome state={state} />
            </div>
          )}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={handleClose}
              disabled={isPending}
            >
              {submitted && !isPending ? "Close" : "Cancel"}
            </Button>
            {!submitted && (
              <Button type="submit" variant="primary" disabled={isPending}>
                Confirm and send
              </Button>
            )}
            {submitted && isPending && (
              <Button type="button" variant="primary" disabled>
                Sending…
              </Button>
            )}
          </div>
        </form>
      </Dialog>
    </div>
  );
}
