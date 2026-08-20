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
      throw new Error(
        `Nest OAuth token refresh failed with ${response.status}`,
      );
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
