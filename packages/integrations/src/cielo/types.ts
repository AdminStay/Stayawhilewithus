// Cielo's real cloud API (verified against the base URL/login endpoint used
// by a maintained open-source Home Assistant integration — see this
// package's README) authenticates with an account email/password, not a
// static API key — the various session/access/refresh tokens it actually
// calls the API with are all derived server-side from that login, not
// something a client pastes in once.
export interface CieloCredentials {
  /** Cielo Home / MRCOOL SmartHVAC account email. */
  username: string;
  password: string;
}

/**
 * One entry from `GET /web/devices`, normalized — verified against
 * bodyscape/cielo_home's `CieloHomeDevice.get_status()` (deviceStatus === 1
 * or "on" means reachable — a connectivity signal, not the AC's power
 * on/off state, which is a separate field this integration doesn't need).
 * `macAddress` is the device's stable unique ID (used as this integration's
 * unique_id too). Cielo devices are hardwired — there is no battery field.
 *
 * The telemetry fields below are all optional and only ever set when the
 * live response actually reported them — confirmed live 2026-09-07
 * (Island Tides) that `/web/devices` itself already returns rich
 * `latEnv`/`latestAction` state alongside the basic connectivity fields,
 * not just online/offline. See client.ts's parseCieloDevice() for the
 * exact extraction and fail-safe unit/timestamp handling.
 */
export interface CieloDevice {
  id: string;
  name: string;
  online: boolean;
  /** Only set when the device confirms Fahrenheit via `isFaren` — see parseCieloDevice(). */
  currentTemperature?: number;
  /** Only set when the device confirms Fahrenheit via `isFaren` — see parseCieloDevice(). */
  targetTemperature?: number;
  mode?: string;
  fanSpeed?: string;
  humidity?: number;
  power?: string;
  /** ISO string, converted from Cielo's raw Unix epoch `latestAction.timestamp` — never `ontimestamp`/`statustimestamp`, see parseCieloDevice(). */
  telemetryUpdatedAt?: string;
}
