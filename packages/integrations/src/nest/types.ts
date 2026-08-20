// Nest goes through Google's Smart Device Management (SDM) API, which uses
// OAuth 2.0 with a long-lived refresh token — not a single API key. See
// https://developers.google.com/nest/device-access/registration for how
// these four values are obtained (real StayWhile registration completed
// 2026-08-19 — see README.md).
export interface NestCredentials {
  clientId: string;
  clientSecret: string;
  projectId: string;
  refreshToken: string;
}

// Raw shapes below follow the SDM API's actual response structure
// (https://developers.google.com/nest/device-access/reference/rest/v1/enterprises.devices)
// — trait keys are optional because a real device only reports the traits
// it actually supports; nothing here should ever be defaulted/fabricated.
export interface RawSdmDevice {
  name: string; // full resource name: "enterprises/{project}/devices/{id}"
  type: string; // e.g. "sdm.devices.types.THERMOSTAT"
  traits?: Record<string, Record<string, unknown>>;
  parentRelations?: Array<{ parent: string; displayName?: string }>;
}

export interface RawSdmDeviceListResponse {
  devices?: RawSdmDevice[];
  nextPageToken?: string;
}

export interface RawSdmTokenResponse {
  access_token: string;
  expires_in: number;
  scope?: string;
  token_type?: string;
}

/**
 * Parsed, per-device thermostat data — every field here is only ever set
 * from a trait the SDM API actually returned for that specific device
 * (see parseNestDevice() in client.ts). `rawTraits` carries the complete,
 * unmodified trait map alongside the parsed convenience fields so a future
 * capability-flag computation (Phase C/D) can inspect exactly which traits
 * exist per device, rather than re-deriving that from the parsed fields.
 */
export interface NestDevice {
  externalDeviceId: string;
  resourceName: string;
  deviceType: string;
  customName?: string;
  roomName?: string;
  connectivity?: "ONLINE" | "OFFLINE";
  ambientTemperatureCelsius?: number;
  ambientHumidityPercent?: number;
  hvacStatus?: string;
  thermostatMode?: string;
  availableThermostatModes?: string[];
  heatCelsius?: number;
  coolCelsius?: number;
  ecoMode?: string;
  fanTimerMode?: string;
  rawTraits: Record<string, Record<string, unknown>>;
}

/**
 * Read-only capability summary derived from a device's actual trait
 * presence (see computeNestDeviceCapabilities() in client.ts) — never
 * assumed uniform across devices. This describes what the SDM API says is
 * possible for THIS specific device right now; it grants no ability to
 * execute a command by itself (no ExecuteCommand path exists in this
 * client yet — see README.md).
 */
export interface NestDeviceCapabilities {
  supportsHeatSetpoint: boolean;
  supportsCoolSetpoint: boolean;
  supportsHeatCoolRange: boolean;
  availableThermostatModes: string[];
  hasEcoTrait: boolean;
  ecoModeActive: boolean;
  hasFanTrait: boolean;
  /** Human-readable notes about why a capability that looks present might still be blocked right now (e.g. Eco mode). */
  restrictions: string[];
}

export type NestThermostatMode = "HEAT" | "COOL" | "HEATCOOL" | "OFF";

/**
 * Every real write this integration can send — deliberately a closed,
 * discriminated set (not a raw command string) so every call site is
 * exhaustively handled and no arbitrary SDM command can be constructed
 * from user input.
 */
export type NestThermostatCommand =
  | { type: "SET_HEAT"; heatCelsius: number }
  | { type: "SET_COOL"; coolCelsius: number }
  | { type: "SET_RANGE"; heatCelsius: number; coolCelsius: number }
  | { type: "SET_MODE"; mode: NestThermostatMode }
  | { type: "SET_FAN"; timerMode: "ON" | "OFF"; durationSeconds?: number };

export interface NestCommandValidation {
  allowed: boolean;
  reason?: string;
}

/** Read-only, UI-facing summary of which controls a specific device's real capabilities allow right now — the same source of truth validateNestCommand() enforces server-side, so the UI can never show a control the server would reject. */
export interface NestControlAvailability {
  canSetHeat: boolean;
  canSetCool: boolean;
  canSetRange: boolean;
  availableModes: NestThermostatMode[];
  canUseFan: boolean;
  blockedByEco: boolean;
}
