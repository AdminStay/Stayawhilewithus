"use client";

import {
  computeNestDeviceCapabilities,
  getSupportedNestControls,
} from "@stayw/integrations/nest/capabilities";
import { Button, Input, Select } from "@stayw/ui";
import { X } from "lucide-react";
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
  return <p className={`mt-1 text-xs ${line.className}`}>{line.text}</p>;
}

const KNOWN_THERMOSTAT_MODES = new Set(["HEAT", "COOL", "HEATCOOL", "OFF"]);

/**
 * The thermostat's own currently-active mode — read from the exact same
 * ThermostatMode trait computeNestDeviceCapabilities() already parses out
 * of this same rawTraits prop, never from the Mode <select> below (which
 * is uncontrolled and only read at form submission). This only changes
 * when the parent re-renders with a fresh sync/confirmation read, so a
 * newly chosen-but-not-yet-applied mode can never affect which temperature
 * control is shown. Returns null when the device hasn't reported a
 * recognized current mode at all — treated the same as OFF (no
 * temperature-setting control) rather than guessed.
 */
function getCurrentThermostatMode(
  rawTraits: Record<string, Record<string, unknown>>,
): "HEAT" | "COOL" | "HEATCOOL" | "OFF" | null {
  const mode = rawTraits["sdm.devices.traits.ThermostatMode"]?.mode;
  return typeof mode === "string" && KNOWN_THERMOSTAT_MODES.has(mode)
    ? (mode as "HEAT" | "COOL" | "HEATCOOL" | "OFF")
    : null;
}

/**
 * One row of the compact control grid: a short fixed-width label, the
 * control itself plus its own submit button (still its own independent
 * <form>/action/pending state — see the file header comment on why these
 * were deliberately NOT merged into a single combined submission), and any
 * result message beneath. Purely a layout helper — carries no command
 * logic of its own.
 */
function ControlRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[72px_1fr] items-start gap-x-3 py-1">
      <span className="pt-1.5 text-xs font-medium text-ink-muted">{label}</span>
      <div>{children}</div>
    </div>
  );
}

/**
 * Every control here is gated by getSupportedNestControls() — the exact
 * same capability-derivation function the server re-checks immediately
 * before sending anything (see sendNestThermostatCommand /
 * validateNestCommand). A control that doesn't render here would be
 * rejected server-side too if somehow submitted anyway — this is UX, not
 * the actual security boundary.
 *
 * DELIBERATELY FIVE INDEPENDENT FORMS/ACTIONS, still — not combined into
 * one "Apply Changes" submission. Each Nest SDM command type (SET_MODE,
 * SET_HEAT, SET_COOL, SET_RANGE, SET_FAN) is its own real, physical HTTP
 * call to Google's API inside sendNestThermostatCommand(), each with its
 * own advisory-lock duplicate-command guard, its own fresh
 * capability-refresh read immediately before sending, and its own
 * confirmation read immediately after. There is no existing mechanism to
 * send two of these as one atomic operation, and building one now would
 * mean either (a) a genuinely new combined server action/service path —
 * out of scope for a UI-only pass and a real new class of risk (a partial
 * failure — e.g. mode changes, setpoint doesn't — would leave the device in
 * an inconsistent state with no rollback), or (b) a single button silently
 * firing multiple independent real commands in sequence from one click —
 * a materially different, riskier interaction than today's "one click, one
 * command, one confirmation" model. Per explicit instruction, neither
 * tradeoff is worth a purely visual improvement — this redesign only
 * changes layout/grouping, never how many physical commands a click can
 * trigger.
 *
 * MODE-AWARE VISIBILITY, on top of the above (presentation only — see
 * getCurrentThermostatMode): Heat/Cool/Range still each gate on their own
 * getSupportedNestControls() flag exactly as before, AND now additionally
 * only render when the thermostat's own current mode matches (HEAT/COOL/
 * HEATCOOL respectively) — narrowing which single temperature control a
 * non-technical admin sees at once instead of exposing all three
 * simultaneously. Mode and Fan are unaffected by this narrowing. This adds
 * an AND condition to what already rendered; it never widens what would
 * otherwise show, never touches validateNestCommand/capabilities.ts, and
 * has no effect on what the server accepts.
 */
export function NestThermostatControls({
  smartDeviceId,
  rawTraits,
  currentTemperatureLabel,
  targetTemperatureLabel,
  modeLabel,
  humidityLabel,
  onClose,
}: {
  smartDeviceId: string;
  rawTraits: Record<string, Record<string, unknown>>;
  /** Pre-formatted, display-only — computed by the caller (ThermostatsList
   * already derives these exact strings for its own row cells), never
   * recomputed or re-derived here. Purely informational context alongside
   * the controls; changing/omitting these can never affect a command. */
  currentTemperatureLabel?: string;
  targetTemperatureLabel?: string;
  modeLabel?: string;
  humidityLabel?: string;
  /** Optional convenience so the panel can offer its own "Close" affordance in addition to the row-level toggle that renders this component at all. Purely local UI state in the parent — never touches command/mapping logic. */
  onClose?: () => void;
}) {
  const capabilities = computeNestDeviceCapabilities(rawTraits);
  const availability = getSupportedNestControls(capabilities);
  const currentMode = getCurrentThermostatMode(rawTraits);
  const showHeat = availability.canSetHeat && currentMode === "HEAT";
  const showCool = availability.canSetCool && currentMode === "COOL";
  const showRange = availability.canSetRange && currentMode === "HEATCOOL";

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
    showHeat ||
    showCool ||
    showRange ||
    availability.availableModes.length > 0 ||
    availability.canUseFan;

  const summaryItems = [
    currentTemperatureLabel && `Current ${currentTemperatureLabel}`,
    targetTemperatureLabel && `Target ${targetTemperatureLabel}`,
    modeLabel && `Mode ${modeLabel}`,
    humidityLabel && `Humidity ${humidityLabel}`,
  ].filter(Boolean);

  return (
    <div className="max-w-xl rounded-lg border border-border bg-surface p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        {summaryItems.length > 0 && (
          <p className="text-xs text-ink-muted">{summaryItems.join(" · ")}</p>
        )}
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Close controls"
            className="shrink-0 text-ink-faint transition-colors hover:text-ink"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {!hasAnyControl ? (
        <p className="text-xs text-ink-faint">
          No verified controls available for this device yet.
        </p>
      ) : (
        <div className="divide-y divide-border">
          {availability.blockedByEco && (
            <p className="py-1 text-xs text-warning-600">
              Eco mode is active — Nest blocks temperature changes until
              it&apos;s turned off.
            </p>
          )}

          {availability.availableModes.length > 0 && (
            <ControlRow label="Mode">
              <form
                action={modeAction}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="hidden"
                  name="smartDeviceId"
                  value={smartDeviceId}
                />
                <Select
                  name="mode"
                  defaultValue=""
                  required
                  disabled={modePending}
                  className="w-36"
                >
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
              </form>
              <CommandResult state={modeState} />
            </ControlRow>
          )}

          {showHeat && (
            <ControlRow label="Heat °F">
              <form
                action={heatAction}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="hidden"
                  name="smartDeviceId"
                  value={smartDeviceId}
                />
                <Input
                  type="number"
                  name="heatFahrenheit"
                  min={40}
                  max={90}
                  placeholder="°F"
                  required
                  disabled={heatPending}
                  className="w-20"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={heatPending}
                >
                  {heatPending ? "Setting…" : "Apply"}
                </Button>
              </form>
              <CommandResult state={heatState} />
            </ControlRow>
          )}

          {showCool && (
            <ControlRow label="Cool °F">
              <form
                action={coolAction}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="hidden"
                  name="smartDeviceId"
                  value={smartDeviceId}
                />
                <Input
                  type="number"
                  name="coolFahrenheit"
                  min={40}
                  max={90}
                  placeholder="°F"
                  required
                  disabled={coolPending}
                  className="w-20"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={coolPending}
                >
                  {coolPending ? "Setting…" : "Apply"}
                </Button>
              </form>
              <CommandResult state={coolState} />
            </ControlRow>
          )}

          {showRange && (
            <ControlRow label="Range °F">
              <form
                action={rangeAction}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="hidden"
                  name="smartDeviceId"
                  value={smartDeviceId}
                />
                <Input
                  type="number"
                  name="heatFahrenheit"
                  min={40}
                  max={90}
                  placeholder="Heat"
                  required
                  disabled={rangePending}
                  className="w-20"
                />
                <span className="text-ink-faint">–</span>
                <Input
                  type="number"
                  name="coolFahrenheit"
                  min={40}
                  max={90}
                  placeholder="Cool"
                  required
                  disabled={rangePending}
                  className="w-20"
                />
                <Button
                  type="submit"
                  size="sm"
                  variant="secondary"
                  disabled={rangePending}
                >
                  {rangePending ? "Setting…" : "Apply"}
                </Button>
              </form>
              <CommandResult state={rangeState} />
            </ControlRow>
          )}

          {availability.canUseFan && (
            <ControlRow label="Fan">
              <form
                action={fanAction}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="hidden"
                  name="smartDeviceId"
                  value={smartDeviceId}
                />
                <Select
                  name="timerMode"
                  defaultValue="ON"
                  disabled={fanPending}
                  className="w-28"
                >
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
              </form>
              <CommandResult state={fanState} />
            </ControlRow>
          )}
        </div>
      )}
    </div>
  );
}
