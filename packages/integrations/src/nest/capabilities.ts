// Deliberately isolated from client.ts: this file has zero imports beyond
// ./types, so it is safe to import from browser/client-component code
// (see NestThermostatControls.tsx) without dragging in NestClient's OAuth
// networking or ../core's node:crypto-dependent webhook verification —
// bundling those for the browser fails the build outright. Every function
// here is pure: no fetch, no credentials, no side effects.
import type {
  NestCommandValidation,
  NestControlAvailability,
  NestDevice,
  NestDeviceCapabilities,
  NestThermostatCommand,
  RawSdmDevice,
} from "./types";

/**
 * Explicit allowlist of SDM thermostat trait namespaces AND, within each,
 * the exact field names this integration ever persists — not just "gate
 * on the trait key," gate on every field inside it too. Every field name
 * below is confirmed against Google's own SDM trait reference docs
 * (developers.google.com/nest/device-access/traits/device/*) as of
 * 2026-08-21: Info -> only `customName` (a user-assigned nickname, not an
 * account identifier); Settings -> only `temperatureScale`; the rest are
 * documented thermostat telemetry/state. sanitizeTraits() below drops any
 * trait key not listed here, and within a kept trait, any field not
 * listed here — so even if Google adds a new field to an already-allowed
 * trait in the future (e.g. an owner/household field added to Info), it's
 * dropped by default rather than silently passed through.
 */
const ALLOWED_TRAIT_FIELDS: Record<string, ReadonlySet<string>> = {
  "sdm.devices.traits.Info": new Set(["customName"]),
  "sdm.devices.traits.Connectivity": new Set(["status"]),
  "sdm.devices.traits.Temperature": new Set(["ambientTemperatureCelsius"]),
  "sdm.devices.traits.Humidity": new Set(["ambientHumidityPercent"]),
  "sdm.devices.traits.ThermostatHvac": new Set(["status"]),
  "sdm.devices.traits.ThermostatMode": new Set(["mode", "availableModes"]),
  "sdm.devices.traits.ThermostatTemperatureSetpoint": new Set([
    "heatCelsius",
    "coolCelsius",
  ]),
  "sdm.devices.traits.ThermostatEco": new Set([
    "mode",
    "availableModes",
    "heatCelsius",
    "coolCelsius",
  ]),
  "sdm.devices.traits.Fan": new Set(["timerMode", "timerTimeout"]),
  "sdm.devices.traits.Settings": new Set(["temperatureScale"]),
};

/**
 * Drops any trait key not on the explicit allowlist above, and — within a
 * kept trait — any field not on that trait's own field allowlist. The
 * only gate between whatever Google's API actually returns and what this
 * integration ever stores in ProviderDevice.rawMetadata/SmartDevice.metadata.
 * Never sees or touches OAuth tokens/client secrets — those never reach
 * this function's input in the first place (see client.ts's
 * getAccessToken(), which never passes the token into device data at all).
 */
export function sanitizeTraits(
  traits: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  const safe: Record<string, Record<string, unknown>> = {};
  for (const [traitKey, traitValue] of Object.entries(traits)) {
    const allowedFields = ALLOWED_TRAIT_FIELDS[traitKey];
    if (!allowedFields) continue;

    const safeFields: Record<string, unknown> = {};
    for (const [fieldKey, fieldValue] of Object.entries(traitValue)) {
      if (allowedFields.has(fieldKey)) {
        safeFields[fieldKey] = fieldValue;
      }
    }
    safe[traitKey] = safeFields;
  }
  return safe;
}

/**
 * Reads only the traits a given device's response actually contains —
 * never defaults/fabricates a value for a trait that's absent, per the
 * standing "no fake data" rule. `rawTraits` is passed through unmodified
 * (after allowlist sanitization — see sanitizeTraits() above) alongside
 * these parsed convenience fields specifically so a future
 * capability-flag computation can check trait presence directly rather
 * than re-deriving it from these optional fields.
 */
export function parseNestDevice(raw: RawSdmDevice): NestDevice {
  const traits = sanitizeTraits(raw.traits ?? {});
  const externalDeviceId = raw.name.split("/").pop() ?? raw.name;

  const info = traits["sdm.devices.traits.Info"];
  const connectivity = traits["sdm.devices.traits.Connectivity"];
  const temperature = traits["sdm.devices.traits.Temperature"];
  const humidity = traits["sdm.devices.traits.Humidity"];
  const hvac = traits["sdm.devices.traits.ThermostatHvac"];
  const mode = traits["sdm.devices.traits.ThermostatMode"];
  const setpoint = traits["sdm.devices.traits.ThermostatTemperatureSetpoint"];
  const eco = traits["sdm.devices.traits.ThermostatEco"];
  const fan = traits["sdm.devices.traits.Fan"];

  return {
    externalDeviceId,
    resourceName: raw.name,
    deviceType: raw.type,
    ...(typeof info?.customName === "string" &&
      info.customName.length > 0 && { customName: info.customName }),
    ...(raw.parentRelations?.[0]?.displayName && {
      roomName: raw.parentRelations[0].displayName,
    }),
    ...(typeof connectivity?.status === "string" && {
      connectivity: connectivity.status as NestDevice["connectivity"],
    }),
    ...(typeof temperature?.ambientTemperatureCelsius === "number" && {
      ambientTemperatureCelsius: temperature.ambientTemperatureCelsius,
    }),
    ...(typeof humidity?.ambientHumidityPercent === "number" && {
      ambientHumidityPercent: humidity.ambientHumidityPercent,
    }),
    ...(typeof hvac?.status === "string" && { hvacStatus: hvac.status }),
    ...(typeof mode?.mode === "string" && { thermostatMode: mode.mode }),
    ...(Array.isArray(mode?.availableModes) && {
      availableThermostatModes: mode.availableModes as string[],
    }),
    ...(typeof setpoint?.heatCelsius === "number" && {
      heatCelsius: setpoint.heatCelsius,
    }),
    ...(typeof setpoint?.coolCelsius === "number" && {
      coolCelsius: setpoint.coolCelsius,
    }),
    ...(typeof eco?.mode === "string" && { ecoMode: eco.mode }),
    ...(typeof fan?.timerMode === "string" && {
      fanTimerMode: fan.timerMode,
    }),
    rawTraits: traits,
  };
}

/**
 * Read-only capability discovery — derives what a specific device's SDM
 * trait data says is actually possible right now. Never assumes uniform
 * capability across devices (per-device trait presence only) and never
 * sends any request — this only inspects the rawTraits a real discovery
 * call already captured. Per SDM's documented restriction, a mode is only
 * genuinely settable if it appears in ThermostatMode.availableModes — the
 * mere presence of the ThermostatTemperatureSetpoint trait does not, by
 * itself, tell you whether heat/cool/range specifically is supported.
 */
export function computeNestDeviceCapabilities(
  rawTraits: Record<string, Record<string, unknown>>,
): NestDeviceCapabilities {
  const mode = rawTraits["sdm.devices.traits.ThermostatMode"];
  const eco = rawTraits["sdm.devices.traits.ThermostatEco"];
  const fan = rawTraits["sdm.devices.traits.Fan"];

  const availableThermostatModes = Array.isArray(mode?.availableModes)
    ? (mode.availableModes as string[])
    : [];
  const hasEcoTrait = eco !== undefined;
  const ecoModeActive = eco?.mode === "MANUAL_ECO";
  const hasFanTrait = fan !== undefined;

  const restrictions: string[] = [];
  if (availableThermostatModes.length === 0) {
    restrictions.push(
      "No ThermostatMode.availableModes reported by this device — mode/setpoint capability is unknown, not assumed unsupported.",
    );
  }
  if (ecoModeActive) {
    restrictions.push(
      "Eco mode is currently active — per Google's SDM API, temperature setpoint commands are rejected while Eco mode is on.",
    );
  }

  return {
    supportsHeatSetpoint:
      availableThermostatModes.includes("HEAT") ||
      availableThermostatModes.includes("HEATCOOL"),
    supportsCoolSetpoint:
      availableThermostatModes.includes("COOL") ||
      availableThermostatModes.includes("HEATCOOL"),
    supportsHeatCoolRange: availableThermostatModes.includes("HEATCOOL"),
    availableThermostatModes,
    hasEcoTrait,
    ecoModeActive,
    hasFanTrait,
    restrictions,
  };
}

/**
 * Rejects NaN/Infinity outright, regardless of where a command originated
 * — the zod schema at the form boundary already guards this for normal UI
 * submissions, but validateNestCommand() is the authoritative server-side
 * gate and must not assume every caller went through that schema. No sane
 * numeric range is enforced here beyond finiteness: Google's SDM docs
 * don't document a min/max Celsius bound (confirmed 2026-08-21, not
 * guessed), so inventing one here would be a second, possibly-inconsistent
 * source of truth alongside the schema's own Fahrenheit sanity bound
 * (40-90°F, the unit admins actually interact with) — that bound lives
 * once, at the schema boundary, not duplicated here in Celsius.
 */
function validateFiniteTemperatures(
  command: NestThermostatCommand,
): NestCommandValidation | null {
  const values: number[] =
    command.type === "SET_HEAT"
      ? [command.heatCelsius]
      : command.type === "SET_COOL"
        ? [command.coolCelsius]
        : command.type === "SET_RANGE"
          ? [command.heatCelsius, command.coolCelsius]
          : [];

  if (values.some((v) => !Number.isFinite(v))) {
    return { allowed: false, reason: "Invalid temperature value." };
  }
  return null;
}

/**
 * The single gate between a requested command and whether it's allowed to
 * reach Google's API at all — used both server-side (as the actual
 * enforcement, immediately before executeNestThermostatCommand() in
 * client.ts) and to derive what the UI shows (getSupportedNestControls()),
 * so the two can never drift apart. Per Google's SDM docs, Eco mode
 * specifically blocks temperature *setpoint* commands
 * (SET_HEAT/SET_COOL/SET_RANGE) — mode changes and fan control are not
 * documented as Eco-blocked, so they aren't gated on it here.
 */
export function validateNestCommand(
  command: NestThermostatCommand,
  capabilities: NestDeviceCapabilities,
): NestCommandValidation {
  const nonFiniteCheck = validateFiniteTemperatures(command);
  if (nonFiniteCheck) return nonFiniteCheck;

  switch (command.type) {
    case "SET_HEAT":
      if (!capabilities.supportsHeatSetpoint) {
        return {
          allowed: false,
          reason: "This thermostat does not report heat-setpoint support.",
        };
      }
      break;
    case "SET_COOL":
      if (!capabilities.supportsCoolSetpoint) {
        return {
          allowed: false,
          reason: "This thermostat does not report cool-setpoint support.",
        };
      }
      break;
    case "SET_RANGE":
      if (!capabilities.supportsHeatCoolRange) {
        return {
          allowed: false,
          reason: "This thermostat does not report heat/cool range support.",
        };
      }
      // Google's own documented INVALID_ARGUMENT rule for SetRange: "Cool
      // value must be greater than heat value." No deadband minimum is
      // documented beyond strict inequality — not inventing one.
      if (command.coolCelsius <= command.heatCelsius) {
        return {
          allowed: false,
          reason: "Cool target must be higher than heat target.",
        };
      }
      break;
    case "SET_MODE":
      if (!capabilities.availableThermostatModes.includes(command.mode)) {
        return {
          allowed: false,
          reason: `This thermostat does not report ${command.mode} as an available mode.`,
        };
      }
      return { allowed: true };
    case "SET_FAN":
      if (!capabilities.hasFanTrait) {
        return {
          allowed: false,
          reason: "This thermostat does not report a fan trait.",
        };
      }
      return { allowed: true };
  }

  // Only setpoint commands (HEAT/COOL/RANGE) reach here — mode/fan already
  // returned above, since Eco doesn't block them per SDM's documented behavior.
  if (capabilities.ecoModeActive) {
    return {
      allowed: false,
      reason:
        "Eco mode is currently active on this thermostat — Nest rejects temperature setpoint changes while Eco mode is on.",
    };
  }

  return { allowed: true };
}

const VALID_THERMOSTAT_MODES = new Set(["HEAT", "COOL", "HEATCOOL", "OFF"]);

/**
 * UI-facing derivation of validateNestCommand() — same source data, same
 * rules, so a control is never shown that the server would then reject.
 */
export function getSupportedNestControls(
  capabilities: NestDeviceCapabilities,
): NestControlAvailability {
  return {
    canSetHeat:
      capabilities.supportsHeatSetpoint && !capabilities.ecoModeActive,
    canSetCool:
      capabilities.supportsCoolSetpoint && !capabilities.ecoModeActive,
    canSetRange:
      capabilities.supportsHeatCoolRange && !capabilities.ecoModeActive,
    availableModes: capabilities.availableThermostatModes.filter(
      (mode): mode is "HEAT" | "COOL" | "HEATCOOL" | "OFF" =>
        VALID_THERMOSTAT_MODES.has(mode),
    ),
    canUseFan: capabilities.hasFanTrait,
    blockedByEco: capabilities.ecoModeActive,
  };
}
