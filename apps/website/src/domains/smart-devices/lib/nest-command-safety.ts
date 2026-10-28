import type {
  NestDevice,
  NestThermostatCommand,
} from "@stayw/integrations/nest";

/**
 * Nest command safety rules (2026-10-28) — pure, no I/O. Applied by
 * sendNestThermostatCommand() to a FRESH Nest read, after
 * validateNestCommand()'s capability checks and before anything is sent:
 *
 *   - the thermostat must report itself ONLINE (Connectivity trait);
 *   - setpoints must stay inside 60–85 °F and move at most 5 °F from the
 *     thermostat's current setpoint — the same limits as Cielo
 *     (CIELO_SETPOINT_SAFETY);
 *   - a change to the value it already has is refused (its read-back
 *     could never tell us whether the command did anything).
 *
 * isNestCommandConfirmed() decides whether a read-back after the command
 * shows the requested state.
 */
export const NEST_SETPOINT_SAFETY = {
  minF: 60,
  maxF: 85,
  maxStepF: 5,
} as const;

/**
 * Requests are whole °F converted to Celsius; Nest stores Celsius with its
 * own rounding, so a read-back within half a degree °F counts as the
 * requested value.
 */
const CONFIRM_TOLERANCE_F = 0.5;
/** Float slack for comparisons of values converted between units. */
const EPSILON_F = 0.01;

export type NestCommandSafety =
  { allowed: true } | { allowed: false; reason: string };

/** Exact °F (no rounding) — temperature.ts rounds for display. */
function toF(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

function checkSetpoint(
  label: "heat" | "cool",
  requestedC: number,
  currentC: number | undefined,
): NestCommandSafety {
  const requestedF = toF(requestedC);
  if (
    requestedF < NEST_SETPOINT_SAFETY.minF - EPSILON_F ||
    requestedF > NEST_SETPOINT_SAFETY.maxF + EPSILON_F
  ) {
    return {
      allowed: false,
      reason: `Choose a temperature between ${NEST_SETPOINT_SAFETY.minF}°F and ${NEST_SETPOINT_SAFETY.maxF}°F.`,
    };
  }
  if (currentC === undefined || !Number.isFinite(currentC)) {
    return {
      allowed: false,
      reason: `Nest didn't report the current ${label} setpoint, so the change can't be checked. Nothing was sent.`,
    };
  }
  const currentF = toF(currentC);
  if (
    Math.abs(requestedF - currentF) >
    NEST_SETPOINT_SAFETY.maxStepF + EPSILON_F
  ) {
    return {
      allowed: false,
      reason: `Change the ${label} setpoint by at most ${NEST_SETPOINT_SAFETY.maxStepF}°F at a time (currently ${Math.round(currentF)}°F).`,
    };
  }
  return { allowed: true };
}

function isSameSetpoint(requestedC: number, currentC: number | undefined) {
  return (
    currentC !== undefined &&
    Math.abs(toF(requestedC) - toF(currentC)) < CONFIRM_TOLERANCE_F
  );
}

export function checkNestCommandSafety(
  command: NestThermostatCommand,
  device: NestDevice,
): NestCommandSafety {
  if (device.connectivity !== "ONLINE") {
    return {
      allowed: false,
      reason:
        device.connectivity === "OFFLINE"
          ? "Nest reports this thermostat offline right now. Nothing was sent."
          : "Nest didn't report whether this thermostat is online. Nothing was sent.",
    };
  }

  switch (command.type) {
    case "SET_HEAT": {
      const check = checkSetpoint(
        "heat",
        command.heatCelsius,
        device.heatCelsius,
      );
      if (!check.allowed) return check;
      if (isSameSetpoint(command.heatCelsius, device.heatCelsius)) {
        return {
          allowed: false,
          reason: `The heat setpoint is already ${Math.round(toF(command.heatCelsius))}°F.`,
        };
      }
      return { allowed: true };
    }
    case "SET_COOL": {
      const check = checkSetpoint(
        "cool",
        command.coolCelsius,
        device.coolCelsius,
      );
      if (!check.allowed) return check;
      if (isSameSetpoint(command.coolCelsius, device.coolCelsius)) {
        return {
          allowed: false,
          reason: `The cool setpoint is already ${Math.round(toF(command.coolCelsius))}°F.`,
        };
      }
      return { allowed: true };
    }
    case "SET_RANGE": {
      const heat = checkSetpoint(
        "heat",
        command.heatCelsius,
        device.heatCelsius,
      );
      if (!heat.allowed) return heat;
      const cool = checkSetpoint(
        "cool",
        command.coolCelsius,
        device.coolCelsius,
      );
      if (!cool.allowed) return cool;
      if (
        isSameSetpoint(command.heatCelsius, device.heatCelsius) &&
        isSameSetpoint(command.coolCelsius, device.coolCelsius)
      ) {
        return {
          allowed: false,
          reason: "The thermostat already has this heat/cool range.",
        };
      }
      return { allowed: true };
    }
    case "SET_MODE":
      if (device.thermostatMode === command.mode) {
        return {
          allowed: false,
          reason: `The thermostat is already in ${command.mode} mode.`,
        };
      }
      return { allowed: true };
    case "SET_FAN":
      return { allowed: true };
  }
}

function sameSetpointAsRequested(
  requestedC: number,
  readBackC: number | undefined,
): boolean {
  return (
    readBackC !== undefined &&
    Number.isFinite(readBackC) &&
    Math.abs(toF(requestedC) - toF(readBackC)) <= CONFIRM_TOLERANCE_F
  );
}

/** Whether a read-back after the command reports the requested state. */
export function isNestCommandConfirmed(
  command: NestThermostatCommand,
  device: NestDevice,
): boolean {
  switch (command.type) {
    case "SET_HEAT":
      return sameSetpointAsRequested(command.heatCelsius, device.heatCelsius);
    case "SET_COOL":
      return sameSetpointAsRequested(command.coolCelsius, device.coolCelsius);
    case "SET_RANGE":
      return (
        sameSetpointAsRequested(command.heatCelsius, device.heatCelsius) &&
        sameSetpointAsRequested(command.coolCelsius, device.coolCelsius)
      );
    case "SET_MODE":
      return device.thermostatMode === command.mode;
    case "SET_FAN":
      return device.fanTimerMode === command.timerMode;
  }
}
