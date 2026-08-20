"use client";

import {
  computeNestDeviceCapabilities,
  getSupportedNestControls,
} from "@stayw/integrations/nest/capabilities";
import { Button, Input, Select } from "@stayw/ui";
import { useActionState } from "react";

import {
  setNestCoolSetpointAction,
  setNestFanAction,
  setNestHeatCoolRangeAction,
  setNestHeatSetpointAction,
  setNestModeAction,
  type NestCommandActionState,
} from "../actions";

const INITIAL_STATE: NestCommandActionState = { status: "idle" };

function resultLine(
  state: NestCommandActionState,
): { text: string; className: string } | null {
  switch (state.status) {
    case "idle":
      return null;
    case "success":
      return { text: "Command sent.", className: "text-success-600" };
    case "rejected":
      return { text: state.reason, className: "text-warning-600" };
    case "already_running":
      return {
        text: "A command is already in progress for this device.",
        className: "text-warning-600",
      };
    case "failure":
      return { text: state.reason, className: "text-error-500" };
  }
}

function CommandResult({ state }: { state: NestCommandActionState }) {
  const line = resultLine(state);
  if (!line) return null;
  return <p className={`text-xs ${line.className}`}>{line.text}</p>;
}

/**
 * Every control here is gated by getSupportedNestControls() — the exact
 * same capability-derivation function the server re-checks immediately
 * before sending anything (see sendNestThermostatCommand /
 * validateNestCommand). A control that doesn't render here would be
 * rejected server-side too if somehow submitted anyway — this is UX, not
 * the actual security boundary.
 */
export function NestThermostatControls({
  smartDeviceId,
  rawTraits,
}: {
  smartDeviceId: string;
  rawTraits: Record<string, Record<string, unknown>>;
}) {
  const capabilities = computeNestDeviceCapabilities(rawTraits);
  const availability = getSupportedNestControls(capabilities);

  const [heatState, heatAction, heatPending] = useActionState(
    setNestHeatSetpointAction,
    INITIAL_STATE,
  );
  const [coolState, coolAction, coolPending] = useActionState(
    setNestCoolSetpointAction,
    INITIAL_STATE,
  );
  const [rangeState, rangeAction, rangePending] = useActionState(
    setNestHeatCoolRangeAction,
    INITIAL_STATE,
  );
  const [modeState, modeAction, modePending] = useActionState(
    setNestModeAction,
    INITIAL_STATE,
  );
  const [fanState, fanAction, fanPending] = useActionState(
    setNestFanAction,
    INITIAL_STATE,
  );

  const hasAnyControl =
    availability.canSetHeat ||
    availability.canSetCool ||
    availability.canSetRange ||
    availability.availableModes.length > 0 ||
    availability.canUseFan;

  if (!hasAnyControl) {
    return (
      <p className="text-xs text-ink-faint">
        No verified controls available for this device yet.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {availability.blockedByEco && (
        <p className="text-xs text-warning-600">
          Eco mode is active — Nest blocks temperature changes until it's turned
          off.
        </p>
      )}

      {availability.availableModes.length > 0 && (
        <form action={modeAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <Select name="mode" defaultValue="" required disabled={modePending}>
            <option value="" disabled>
              Set mode…
            </option>
            {availability.availableModes.map((mode) => (
              <option key={mode} value={mode}>
                {mode}
              </option>
            ))}
          </Select>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={modePending}
          >
            {modePending ? "Setting…" : "Apply"}
          </Button>
          <CommandResult state={modeState} />
        </form>
      )}

      {availability.canSetHeat && (
        <form action={heatAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <Input
            type="number"
            name="heatFahrenheit"
            min={40}
            max={90}
            placeholder="Heat °F"
            required
            disabled={heatPending}
            className="w-24"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={heatPending}
          >
            {heatPending ? "Setting…" : "Set heat"}
          </Button>
          <CommandResult state={heatState} />
        </form>
      )}

      {availability.canSetCool && (
        <form action={coolAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <Input
            type="number"
            name="coolFahrenheit"
            min={40}
            max={90}
            placeholder="Cool °F"
            required
            disabled={coolPending}
            className="w-24"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={coolPending}
          >
            {coolPending ? "Setting…" : "Set cool"}
          </Button>
          <CommandResult state={coolState} />
        </form>
      )}

      {availability.canSetRange && (
        <form
          action={rangeAction}
          className="flex flex-wrap items-center gap-2"
        >
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <Input
            type="number"
            name="heatFahrenheit"
            min={40}
            max={90}
            placeholder="Heat °F"
            required
            disabled={rangePending}
            className="w-24"
          />
          <Input
            type="number"
            name="coolFahrenheit"
            min={40}
            max={90}
            placeholder="Cool °F"
            required
            disabled={rangePending}
            className="w-24"
          />
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={rangePending}
          >
            {rangePending ? "Setting…" : "Set range"}
          </Button>
          <CommandResult state={rangeState} />
        </form>
      )}

      {availability.canUseFan && (
        <form action={fanAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="smartDeviceId" value={smartDeviceId} />
          <Select name="timerMode" defaultValue="ON" disabled={fanPending}>
            <option value="ON">Fan on</option>
            <option value="OFF">Fan off</option>
          </Select>
          <Button
            type="submit"
            size="sm"
            variant="secondary"
            disabled={fanPending}
          >
            {fanPending ? "Setting…" : "Apply"}
          </Button>
          <CommandResult state={fanState} />
        </form>
      )}
    </div>
  );
}
