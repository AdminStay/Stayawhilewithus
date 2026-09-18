import { createHash, randomUUID } from "node:crypto";

import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient, NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import type { CieloCredentials, CieloDevice } from "./types";

export type { CieloDevice } from "./types";

const BASE_URL = "https://api.smartcielo.com";

// Verified against bodyscape/cielo_home's const.py (an actively maintained,
// 2025-dated Home Assistant integration explicitly named "Cielo Home / Mr
// Cool devices integration"). Both app brands (Cielo Home and MRCOOL
// SmartHVAC) authenticate against this same backend — see this package's
// README for how that was confirmed and what's still worth double-checking
// on the account itself.
const IOS_X_API_KEY = "T90bwfODtWaIUreVJtroN3itKWquNnUGRYiYUsf0";
const WEB_X_API_KEY = "3iCWYuBqpY2g7yRq3yyTk1XCS4CMjt1n9ECCjdpd";
const IOS_USER_AGENT =
  "MRCOOL SmartHVAC/4.3.0 (com.smarthvac; build:2; iOS 26.5.0) Alamofire/5.9.1";

interface RawCieloLoginResponse {
  status: number;
  message: string;
  data?: {
    user: {
      accessToken: string;
      userId: string;
    };
  };
}

interface RawCieloLatEnv {
  temp?: number | string;
  humidity?: number | string;
}

interface RawCieloLatestAction {
  temp?: number | string;
  mode?: string;
  fanspeed?: string;
  power?: string | number;
  timestamp?: number | string;
}

interface RawCieloDevice {
  deviceName: string;
  macAddress: string;
  deviceStatus: number | string;
  /**
   * Confirmed live (Island Tides, 2026-09-07): isFaren=1 alongside
   * latEnv.temp=69 / latestAction.temp="72" — plausible Fahrenheit indoor
   * readings. Only this exact confirmed value is ever treated as "safe to
   * read temperature fields" — see isConfirmedFahrenheit() below for why
   * every other value fails closed instead of guessing a conversion.
   */
  isFaren?: number | string;
  latEnv?: RawCieloLatEnv;
  latestAction?: RawCieloLatestAction;
}

interface RawCieloDevicesResponse {
  status: number;
  message: string;
  data?: {
    listDevices: RawCieloDevice[];
  };
}

function deviceIsOnline(status: number | string): boolean {
  return status === 1 || String(status) === "on";
}

/**
 * Accepts both a real number and a numeric string (Cielo's API mixes both
 * — e.g. latestAction.temp was observed as the string "72") — never NaN,
 * never a fabricated 0. Empty/whitespace-only strings are explicitly
 * rejected before ever reaching `Number()` — `Number("")` and
 * `Number("   ")` both evaluate to `0` in JavaScript (a real language
 * quirk, not a `NaN`), which would otherwise silently turn a genuinely
 * blank/absent provider value into a fabricated `0` reading indistinguishable
 * from a real 0°F or 0% humidity.
 */
function parseNumeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Cielo reports per-device whether its temperature fields are Fahrenheit
 * via `isFaren` — confirmed live only for isFaren === 1 (see RawCieloDevice
 * above). Any other value (0, missing, anything else) has no observed
 * reference behavior in this codebase — there is no confirmed evidence of
 * what a non-Fahrenheit response even looks like from this API, so
 * temperature fields are omitted entirely for those devices rather than
 * guessing a conversion. This fails safe, not silently wrong; extend it
 * only when a real non-Fahrenheit account/device is actually observed.
 */
function isConfirmedFahrenheit(raw: RawCieloDevice): boolean {
  return raw.isFaren === 1 || raw.isFaren === "1";
}

/**
 * Cielo's timestamp fields are Unix epoch values, sometimes as strings —
 * defensively distinguishes seconds vs milliseconds by magnitude (a
 * millisecond epoch for any date after 2001 exceeds 1e12; a plausible
 * current-era second epoch does not) and converts to an ISO string, since
 * the existing generic getTelemetryUpdatedAt() reader
 * (apps/website/.../lib/thermostat-metadata.ts) requires a string, not a
 * raw number. Returns null on anything that doesn't parse to a valid
 * date — never fabricated.
 */
function parseCieloTimestamp(value: unknown): string | null {
  const numeric = parseNumeric(value);
  if (numeric === null || numeric <= 0) return null;
  const millis = numeric > 1e12 ? numeric : numeric * 1000;
  const date = new Date(millis);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/**
 * Parses one raw `/web/devices` entry into the safe, normalized
 * `CieloDevice` shape — same "only ever set a key the provider actually
 * reported" discipline as parseNestDevice()/AugustClient.getLockDetail().
 * Exported so client.test.ts can unit-test every field combination
 * directly, without needing to mock a full HTTP response per case.
 *
 * Deliberately uses `latestAction.timestamp` for telemetryUpdatedAt, never
 * `ontimestamp` (represents when the unit last powered on, not telemetry
 * freshness) or `statustimestamp` (appears status-specific, not general
 * action-state freshness) — confirmed by direct instruction after live
 * field observation, not guessed.
 */
export function parseCieloDevice(raw: RawCieloDevice): CieloDevice {
  const fahrenheitConfirmed = isConfirmedFahrenheit(raw);
  const currentTemperature = fahrenheitConfirmed
    ? parseNumeric(raw.latEnv?.temp)
    : null;
  const targetTemperature = fahrenheitConfirmed
    ? parseNumeric(raw.latestAction?.temp)
    : null;
  const humidity = parseNumeric(raw.latEnv?.humidity);
  const mode =
    typeof raw.latestAction?.mode === "string" ? raw.latestAction.mode : null;
  const fanSpeed =
    typeof raw.latestAction?.fanspeed === "string"
      ? raw.latestAction.fanspeed
      : null;
  const power =
    raw.latestAction?.power != null ? String(raw.latestAction.power) : null;
  const telemetryUpdatedAt = parseCieloTimestamp(raw.latestAction?.timestamp);

  return {
    id: raw.macAddress,
    name: raw.deviceName,
    online: deviceIsOnline(raw.deviceStatus),
    ...(currentTemperature !== null && { currentTemperature }),
    ...(targetTemperature !== null && { targetTemperature }),
    ...(mode !== null && { mode }),
    ...(fanSpeed !== null && { fanSpeed }),
    ...(humidity !== null && { humidity }),
    ...(power !== null && { power }),
    ...(telemetryUpdatedAt !== null && { telemetryUpdatedAt }),
  };
}

/**
 * Cielo integration client — real HTTP calls against the verified (if
 * unofficial — there is no public developer program) api.smartcielo.com
 * endpoints, ported from bodyscape/cielo_home's cielohome.py and
 * cielohomedevice.py. Read-only: does not implement AC control (StayWhile's
 * need is status visibility, not remote control). Stateless per call —
 * logs in fresh each time rather than caching a session, matching this
 * package's other real clients (OwnerrezClient, NotionClient); Cielo's
 * login has no interactive step, so this costs one extra HTTP call, not a
 * human's attention.
 */
export class CieloClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "CIELO" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;

  constructor(private readonly credentials: CieloCredentials) {
    this.http = new HttpClient({ baseUrl: BASE_URL });
  }

  private async login(): Promise<{ accessToken: string }> {
    const passwordHash = createHash("sha256")
      .update(this.credentials.password, "utf8")
      .digest("hex");

    const response = await this.http.request<RawCieloLoginResponse>(
      "/user/smarthvac/login/1",
      {
        method: "POST",
        headers: {
          accept: "*/*",
          "content-type": "application/json",
          "x-api-key": IOS_X_API_KEY,
          "user-agent": IOS_USER_AGENT,
        },
        body: JSON.stringify({
          user: {
            isDeviceCountRequired: 1,
            isSmartHVAC: 1,
            ipAddress: "",
            deviceTokenId: "N/A",
            mobileDeviceId: randomUUID()
              .replace(/-/g, "")
              .slice(0, 8)
              .toUpperCase(),
            deviceType: "iPhone17,1",
            appType: "iOS",
            userId: this.credentials.username,
            password: passwordHash,
            timeZone: "+00:00",
            mobileDeviceName: "iPhone",
            locale: "en",
            appVersion: "4.3.0",
          },
        }),
      },
    );

    if (response.status !== 200 || !response.data) {
      throw new Error(
        `Cielo login failed: ${response.message || "unknown error"}`,
      );
    }

    return { accessToken: response.data.user.accessToken };
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    await this.login();
    return { connected: true, connectedAt: new Date() };
  }

  async disconnect(): Promise<void> {
    // Stateless: no session is cached client-side to tear down.
  }

  async authenticate(): Promise<void> {
    await this.login();
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    try {
      await this.login();
      return { healthy: true, checkedAt: new Date() };
    } catch (err) {
      return {
        healthy: false,
        checkedAt: new Date(),
        details: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async validateCredentials(): Promise<{ valid: boolean; reason?: string }> {
    try {
      await this.login();
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /**
   * `GET /web/devices` — every thermostat/AC controller on the account,
   * with online/offline status plus (when the device confirms Fahrenheit
   * via `isFaren`) current/target temperature, mode, fan speed, humidity,
   * power state, and a telemetry timestamp — see parseCieloDevice() for
   * the exact per-field extraction/fail-safe rules. Still one plain GET,
   * no WebSocket, no `/web/sync/db/6` capability-metadata call.
   */
  async listDevices(): Promise<CieloDevice[]> {
    const { accessToken } = await this.login();

    const response = await this.http.request<RawCieloDevicesResponse>(
      "/web/devices?limit=420",
      {
        headers: {
          authorization: accessToken,
          "x-api-key": WEB_X_API_KEY,
        },
      },
    );

    if (response.status !== 200 || !response.data) {
      throw new Error(
        `Cielo device list failed: ${response.message || "unknown error"}`,
      );
    }

    return response.data.listDevices.map(parseCieloDevice);
  }

  /**
   * Fetches every device's status. Doesn't write to StayWhile's database
   * (packages/integrations never touches @stayw/database) — the caller
   * (smart-devices.service.ts) does the SmartDevice upsert. Only INBOUND is
   * meaningful: Cielo is the system of record for its own device state.
   */
  async sync(
    direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    if (direction !== "INBOUND") {
      throw new Error(
        "Cielo sync only supports INBOUND — it's the system of record for its own device state.",
      );
    }

    const devices = await this.listDevices();
    return { recordsProcessed: devices.length, direction };
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("Cielo", "receiveWebhook");
  }
}
