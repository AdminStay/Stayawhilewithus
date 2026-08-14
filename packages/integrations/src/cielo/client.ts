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

interface RawCieloDevice {
  deviceName: string;
  macAddress: string;
  deviceStatus: number | string;
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

  /** `GET /web/devices` — every thermostat/AC controller on the account, with online/offline status. */
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

    return response.data.listDevices.map((d) => ({
      id: d.macAddress,
      name: d.deviceName,
      online: deviceIsOnline(d.deviceStatus),
    }));
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
