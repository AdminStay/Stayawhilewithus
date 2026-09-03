import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient, NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import { parseNestDevice } from "./capabilities";
import type {
  NestCredentials,
  NestDevice,
  NestThermostatCommand,
  RawSdmDevice,
  RawSdmDeviceListResponse,
  RawSdmTokenResponse,
} from "./types";

export {
  computeNestDeviceCapabilities,
  getSupportedNestControls,
  parseNestDevice,
  sanitizeTraits,
  validateNestCommand,
} from "./capabilities";
export type {
  NestCommandValidation,
  NestControlAvailability,
  NestCredentials,
  NestDevice,
  NestDeviceCapabilities,
  NestThermostatCommand,
  NestThermostatMode,
} from "./types";

const SDM_BASE_URL = "https://smartdevicemanagement.googleapis.com/v1";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

/** Refresh a bit early so a request never races an about-to-expire token. */
const TOKEN_REFRESH_SKEW_MS = 60_000;

/**
 * Every field here is deliberately safe to log/display: an HTTP status, at
 * most Google's own two-field standard OAuth error shape (`error`/
 * `error_description` — see RFC 6749 §5.2), and booleans about the three
 * credential values — never the values themselves, never their lengths (no
 * demonstrated diagnostic need for lengths, per explicit instruction).
 * Built once, at the exact point a real Google response is in hand, so the
 * caller (thermostat-refresh.service.ts) never needs to touch the raw
 * Response or credentials itself to get a useful diagnostic.
 */
export interface NestOAuthDiagnostic {
  httpStatus: number;
  /** Google's own `error` field (e.g. "invalid_grant"), or null if the response body wasn't parseable JSON or didn't include one. */
  oauthError: string | null;
  /**
   * Google's own `error_description` field — sanitized before it ever
   * reaches this object (see sanitizeOAuthErrorDescription() below): capped
   * at 200 chars, and replaced entirely with a fixed redaction marker if it
   * happens to contain any of this request's own credential values. Null if
   * Google didn't report one. Even sanitized, this is still meant for
   * server-side structured logs only — the caller (thermostat-refresh.service.ts)
   * never surfaces it to a dashboard user, only `.message` (always generic).
   */
  oauthErrorDescription: string | null;
  clientIdPresent: boolean;
  clientSecretPresent: boolean;
  refreshTokenPresent: boolean;
  clientIdHasWhitespace: boolean;
  clientSecretHasWhitespace: boolean;
  refreshTokenHasWhitespace: boolean;
}

/**
 * Thrown only by getAccessToken() below on a failed token refresh. Carries
 * a generic, UI-safe `.message` (unchanged wording from before this
 * diagnostic was added, so existing callers/tests matching on it keep
 * working) plus a separate, structured `.diagnostic` — the caller decides
 * where each part goes (message to a VA-visible UI string, diagnostic to
 * server-side structured logs only). This class never itself logs
 * anything — this package has no logging side effects anywhere in its
 * client code, matching its existing convention.
 */
export class NestOAuthRefreshError extends Error {
  readonly diagnostic: NestOAuthDiagnostic;

  constructor(diagnostic: NestOAuthDiagnostic) {
    super(`Nest OAuth token refresh failed with ${diagnostic.httpStatus}`);
    this.name = "NestOAuthRefreshError";
    this.diagnostic = diagnostic;
  }
}

function hasLeadingOrTrailingWhitespace(value: string): boolean {
  return value !== value.trim();
}

/**
 * Only ever extracts Google's own two standard OAuth error-response fields
 * (RFC 6749 §5.2) — `error` and `error_description` — and only when each is
 * actually a string. Every other field Google's response might contain
 * (there shouldn't be any sensitive ones in an error response, but this
 * never assumes that) is deliberately never read, logged, or returned. A
 * non-JSON or unparseable body is treated the same as an absent one —
 * never captured as raw text, per the "never log a complete unfiltered
 * Google response" rule this exists to enforce.
 */
async function safeParseOAuthErrorBody(
  response: Response,
): Promise<Pick<NestOAuthDiagnostic, "oauthError" | "oauthErrorDescription">> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object") {
      const record = body as Record<string, unknown>;
      return {
        oauthError: typeof record.error === "string" ? record.error : null,
        oauthErrorDescription:
          typeof record.error_description === "string"
            ? record.error_description
            : null,
      };
    }
  } catch {
    // Non-JSON/unreadable body — deliberately not captured in any form.
  }
  return { oauthError: null, oauthErrorDescription: null };
}

/** Hard cap so a huge or malformed response body can never balloon a log line. */
const MAX_OAUTH_ERROR_DESCRIPTION_LENGTH = 200;
const REDACTED_OAUTH_ERROR_DESCRIPTION =
  "[redacted — response text unexpectedly matched a configured credential value]";

/**
 * `error_description` is documented (RFC 6749 §5.2) as a static,
 * human-readable explanation of the error type — Google's own real-world
 * values for this field are short, fixed strings like "Token has been
 * expired or revoked." or "Bad Request", never an echo of the request body
 * — and a refresh-token grant sends no user-controlled/session data at all
 * (no redirect_uri, no authorization code — those belong to a different
 * grant type this client doesn't use), so the only values that could
 * conceivably leak here are the three this specific request just sent:
 * client_id, client_secret, refresh_token.
 *
 * This code does not simply trust that documented behavior, though —
 * "documented" is not "guaranteed," and this is credential-adjacent data.
 * It actively checks the description against the exact credential values
 * this request used and redacts the entire description (never a partial/
 * best-effort scrub) if any of them appear, rather than assuming Google's
 * server-side behavior. Also bounds the length unconditionally, so even a
 * legitimate but unexpectedly large description can't produce an
 * oversized log line.
 */
function sanitizeOAuthErrorDescription(
  description: string | null,
  credentials: NestCredentials,
): string | null {
  if (!description) return null;

  const knownCredentialValues = [
    credentials.clientId,
    credentials.clientSecret,
    credentials.refreshToken,
  ].filter((value) => value.length > 0);
  if (knownCredentialValues.some((value) => description.includes(value))) {
    return REDACTED_OAUTH_ERROR_DESCRIPTION;
  }

  return description.length > MAX_OAUTH_ERROR_DESCRIPTION_LENGTH
    ? `${description.slice(0, MAX_OAUTH_ERROR_DESCRIPTION_LENGTH)}…`
    : description;
}

/**
 * Real Nest integration client via Google's Smart Device Management (SDM)
 * API. Read (listDevices) and write (thermostat commands) — every command
 * method below maps 1:1 to a documented SDM ExecuteCommand, and none of
 * them perform their own capability check (that's validateNestCommand()'s
 * job, enforced by the caller immediately before invoking these — see
 * apps/website's nest-commands.service.ts). See README.md for the
 * credential/registration requirements.
 *
 * Deliberately kept separate from capabilities.ts (pure functions, no
 * network/OAuth) — this file pulls in HttpClient and ../core's
 * node:crypto-dependent webhook verification, which must never be
 * bundled for the browser (see NestThermostatControls.tsx, which imports
 * only from capabilities.ts for exactly this reason).
 */
export class NestClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "NEST" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;
  private accessToken?: string;
  private accessTokenExpiresAt = 0;

  constructor(private readonly credentials: NestCredentials) {
    this.http = new HttpClient({ baseUrl: SDM_BASE_URL });
  }

  /**
   * OAuth refresh-token exchange — SDM access tokens are short-lived
   * (~1 hour); this app never has a browser session to re-authorize
   * interactively, so every real call goes through the stored long-lived
   * refresh token instead. Cached in-memory per client instance, refreshed
   * a minute before actual expiry.
   */
  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (
      this.accessToken &&
      now < this.accessTokenExpiresAt - TOKEN_REFRESH_SKEW_MS
    ) {
      return this.accessToken;
    }

    const response = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.credentials.clientId,
        client_secret: this.credentials.clientSecret,
        refresh_token: this.credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });

    if (!response.ok) {
      const { oauthError, oauthErrorDescription: rawOauthErrorDescription } =
        await safeParseOAuthErrorBody(response);
      throw new NestOAuthRefreshError({
        httpStatus: response.status,
        oauthError,
        oauthErrorDescription: sanitizeOAuthErrorDescription(
          rawOauthErrorDescription,
          this.credentials,
        ),
        clientIdPresent: Boolean(this.credentials.clientId),
        clientSecretPresent: Boolean(this.credentials.clientSecret),
        refreshTokenPresent: Boolean(this.credentials.refreshToken),
        clientIdHasWhitespace: hasLeadingOrTrailingWhitespace(
          this.credentials.clientId,
        ),
        clientSecretHasWhitespace: hasLeadingOrTrailingWhitespace(
          this.credentials.clientSecret,
        ),
        refreshTokenHasWhitespace: hasLeadingOrTrailingWhitespace(
          this.credentials.refreshToken,
        ),
      });
    }

    const data = (await response.json()) as RawSdmTokenResponse;
    this.accessToken = data.access_token;
    this.accessTokenExpiresAt = now + data.expires_in * 1000;
    return this.accessToken;
  }

  private async authHeaders(): Promise<Record<string, string>> {
    const token = await this.getAccessToken();
    return { Authorization: `Bearer ${token}` };
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    await this.listDevices();
    return { connected: true, connectedAt: new Date() };
  }

  async disconnect(): Promise<void> {
    // Stateless REST API over an OAuth refresh token — nothing persisted
    // client-side beyond the in-memory access-token cache, which simply
    // stops being used once this instance is discarded.
  }

  async authenticate(): Promise<void> {
    await this.connect();
  }

  async healthCheck(): Promise<{
    healthy: boolean;
    checkedAt: Date;
    details?: string;
  }> {
    try {
      await this.listDevices();
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
      await this.listDevices();
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async listDevices(): Promise<NestDevice[]> {
    const headers = await this.authHeaders();
    const data = await this.http.request<RawSdmDeviceListResponse>(
      `/enterprises/${this.credentials.projectId}/devices`,
      { headers },
    );
    return (data.devices ?? []).map(parseNestDevice);
  }

  /**
   * Single-device fetch — `GET /enterprises/{project}/devices/{id}`. Used
   * to refresh one device's real, current traits immediately before (and
   * immediately after) sending a command, rather than trusting whatever a
   * prior discovery run captured. Read-only, same as listDevices().
   */
  async getDevice(deviceId: string): Promise<NestDevice> {
    const headers = await this.authHeaders();
    const data = await this.http.request<RawSdmDevice>(
      `/enterprises/${this.credentials.projectId}/devices/${deviceId}`,
      { headers },
    );
    return parseNestDevice(data);
  }

  /**
   * Read-only: fetches real device data from Nest but does not write it
   * anywhere — discovery/staging is the caller's job (see
   * discoverNestDevices() in apps/website, which writes to ProviderDevice,
   * never directly to SmartDevice — no automatic property mapping here or
   * anywhere in this client).
   */
  async sync(
    direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    if (direction !== "INBOUND") {
      throw new Error(
        "Nest sync only supports INBOUND — it's the system of record for its own device state.",
      );
    }

    const devices = await this.listDevices();
    return { recordsProcessed: devices.length, direction };
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("Nest", "receiveWebhook");
  }

  /**
   * Raw SDM ExecuteCommand call — `POST .../devices/{id}:executeCommand`.
   * Private and untyped-params on purpose: every real caller goes through
   * one of the specific methods below, never this directly, so there's
   * exactly one place that can construct an arbitrary command string.
   */
  private async executeCommand(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
  ): Promise<void> {
    const headers = await this.authHeaders();
    await this.http.request<Record<string, never>>(
      `/enterprises/${this.credentials.projectId}/devices/${deviceId}:executeCommand`,
      {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ command, params }),
      },
    );
  }

  /** sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat */
  async setHeatSetpoint(deviceId: string, heatCelsius: number): Promise<void> {
    await this.executeCommand(
      deviceId,
      "sdm.devices.commands.ThermostatTemperatureSetpoint.SetHeat",
      { heatCelsius },
    );
  }

  /** sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool */
  async setCoolSetpoint(deviceId: string, coolCelsius: number): Promise<void> {
    await this.executeCommand(
      deviceId,
      "sdm.devices.commands.ThermostatTemperatureSetpoint.SetCool",
      { coolCelsius },
    );
  }

  /** sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange */
  async setHeatCoolRange(
    deviceId: string,
    heatCelsius: number,
    coolCelsius: number,
  ): Promise<void> {
    await this.executeCommand(
      deviceId,
      "sdm.devices.commands.ThermostatTemperatureSetpoint.SetRange",
      { heatCelsius, coolCelsius },
    );
  }

  /** sdm.devices.commands.ThermostatMode.SetMode */
  async setThermostatMode(
    deviceId: string,
    mode: "HEAT" | "COOL" | "HEATCOOL" | "OFF",
  ): Promise<void> {
    await this.executeCommand(
      deviceId,
      "sdm.devices.commands.ThermostatMode.SetMode",
      { mode },
    );
  }

  /** sdm.devices.commands.Fan.SetTimer — duration capped at SDM's documented 12h (43200s) max. */
  async setFanTimer(
    deviceId: string,
    timerMode: "ON" | "OFF",
    durationSeconds?: number,
  ): Promise<void> {
    await this.executeCommand(deviceId, "sdm.devices.commands.Fan.SetTimer", {
      timerMode,
      ...(durationSeconds != null && {
        duration: `${Math.min(durationSeconds, 43_200)}s`,
      }),
    });
  }
}

/**
 * Dispatches a validated NestThermostatCommand to the matching NestClient
 * method — the only place a NestThermostatCommand becomes an actual SDM
 * call. Callers must run validateNestCommand() first; this function does
 * not re-check capability, by design (single responsibility — this just
 * maps command -> API call).
 */
export async function executeNestThermostatCommand(
  client: Pick<
    NestClient,
    | "setHeatSetpoint"
    | "setCoolSetpoint"
    | "setHeatCoolRange"
    | "setThermostatMode"
    | "setFanTimer"
  >,
  externalDeviceId: string,
  command: NestThermostatCommand,
): Promise<void> {
  switch (command.type) {
    case "SET_HEAT":
      return client.setHeatSetpoint(externalDeviceId, command.heatCelsius);
    case "SET_COOL":
      return client.setCoolSetpoint(externalDeviceId, command.coolCelsius);
    case "SET_RANGE":
      return client.setHeatCoolRange(
        externalDeviceId,
        command.heatCelsius,
        command.coolCelsius,
      );
    case "SET_MODE":
      return client.setThermostatMode(externalDeviceId, command.mode);
    case "SET_FAN":
      return client.setFanTimer(
        externalDeviceId,
        command.timerMode,
        command.durationSeconds,
      );
  }
}
