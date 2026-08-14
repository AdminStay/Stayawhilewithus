import type { SyncDirection } from "@stayw/database/enums";

import { HttpClient, NotImplementedError } from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import {
  AUGUST_BRAND_CONFIGS,
  type AugustCredentials,
  type AugustLock,
  type AugustLockDetail,
} from "./types";

export type { AugustBrand, AugustLock, AugustLockDetail } from "./types";
export { isAugustBrand } from "./types";

// Fixed values every August client (mobile app and this integration alike)
// sends regardless of brand — verified against yalexs's api_common.py (the
// actively maintained fork Home Assistant's official August/Yale
// integration now runs on; the originally-referenced py-august hasn't been
// pushed to since 2022-01-31 and its API key/User-Agent are stale, which is
// what caused a 404 on every request once August rotated their
// app-identification values server-side). Not August's public developer
// credentials (there isn't a public developer program) — these are the
// app-identification values the mobile client itself uses. Per-brand values
// (API key, host, header names) live in AUGUST_BRAND_CONFIGS (./types.ts),
// shared with scripts/login.ts so both stay in sync.
const AUGUST_COUNTRY = "US";
const AUGUST_USER_AGENT =
  "August/Luna-22.17.0 (Android; SDK 31; gphone64_arm64)";

function brandConfig(brand: AugustCredentials["brand"]) {
  const name = brand ?? "august";
  const config = AUGUST_BRAND_CONFIGS.find((c) => c.name === name);
  if (!config) {
    throw new Error(`Unknown August account brand: ${name}`);
  }
  return config;
}

interface RawAugustLockListEntry {
  LockName: string;
  HouseID: string;
}

interface RawAugustBridgeStatus {
  current?: string;
}

interface RawAugustBridge {
  operative: boolean;
  status?: RawAugustBridgeStatus;
}

interface RawAugustLockDetail {
  LockID: string;
  LockName: string;
  HouseID: string;
  battery: number;
  Bridge?: RawAugustBridge;
}

/** Verified against py-august's `LockDetail.bridge_is_online` (august/lock.py) — connectivity of the lock's WiFi Bridge/Connect hub, not locked/unlocked state. */
function bridgeIsOnline(bridge: RawAugustBridge | undefined): boolean {
  if (!bridge) return false;
  if (!bridge.status && bridge.operative) return true;
  return bridge.status?.current === "online";
}

/**
 * August integration client — real HTTP calls against the verified (if
 * unofficial — August has no public developer API) api-production.august.com
 * endpoints, ported from py-august's august/api_common.py and august/lock.py.
 * See this package's README for the one-time interactive login step this
 * client deliberately does NOT perform (see august/scripts/login.ts) —
 * `AugustCredentials.accessToken` must already exist before this client can
 * do anything. Read-only: does not implement lock/unlock (StayWhile's need
 * is status visibility, not remote control).
 */
export class AugustClient
  implements BaseIntegrationClient, SyncCapable, WebhookReceivable
{
  readonly provider = "AUGUST" as const;
  readonly capabilities = [
    "sync",
    "webhook",
  ] as const satisfies readonly IntegrationCapability[];

  private readonly http: HttpClient;

  constructor(private readonly credentials: AugustCredentials) {
    const brand = brandConfig(credentials.brand);
    this.http = new HttpClient({
      baseUrl: brand.baseUrl,
      headers: {
        "Accept-Version": "0.0.1",
        [brand.apiKeyHeader]: brand.apiKey,
        [brand.brandingHeader]: brand.branding,
        "x-august-country": AUGUST_COUNTRY,
        "Content-Type": "application/json; charset=UTF-8",
        "User-Agent": AUGUST_USER_AGENT,
        [brand.accessTokenHeader]: credentials.accessToken,
      },
    });
  }

  async connect(): Promise<{ connected: boolean; connectedAt: Date }> {
    await this.http.request<Record<string, RawAugustLockListEntry>>(
      "/users/locks/mine",
    );
    return { connected: true, connectedAt: new Date() };
  }

  async disconnect(): Promise<void> {
    // Stateless: nothing server-side to tear down, and the access token
    // isn't persisted by this client (it's supplied by the caller, backed
    // by the AUGUST_* env vars) — nothing to clear here either.
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
      await this.connect();
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
      await this.connect();
      return { valid: true };
    } catch (err) {
      return {
        valid: false,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  }

  /** `GET /users/locks/mine` — every lock the account has access to, without per-lock detail (battery/connectivity need a separate getLockDetail() call each). */
  async listLocks(): Promise<AugustLock[]> {
    const raw =
      await this.http.request<Record<string, RawAugustLockListEntry>>(
        "/users/locks/mine",
      );
    return Object.entries(raw).map(([id, data]) => ({
      id,
      name: data.LockName,
      houseId: data.HouseID,
    }));
  }

  /** `GET /locks/{lockId}` — battery level and bridge connectivity for one lock. */
  async getLockDetail(lockId: string): Promise<AugustLockDetail> {
    const raw = await this.http.request<RawAugustLockDetail>(
      `/locks/${encodeURIComponent(lockId)}`,
    );
    return {
      id: raw.LockID,
      name: raw.LockName,
      houseId: raw.HouseID,
      batteryLevel:
        typeof raw.battery === "number" ? Math.round(raw.battery * 100) : null,
      online: bridgeIsOnline(raw.Bridge),
    };
  }

  /**
   * Fetches every lock's full detail. Doesn't write to StayWhile's database
   * (packages/integrations never touches @stayw/database) — the caller
   * (smart-devices.service.ts) does the SmartDevice upsert. Only INBOUND is
   * meaningful: August is the system of record for its own lock state.
   */
  async sync(
    direction: SyncDirection,
  ): Promise<{ recordsProcessed: number; direction: SyncDirection }> {
    if (direction !== "INBOUND") {
      throw new Error(
        "August sync only supports INBOUND — it's the system of record for its own lock state.",
      );
    }

    const locks = await this.listLocks();
    return { recordsProcessed: locks.length, direction };
  }

  async receiveWebhook(
    _rawBody: string,
    _headers: Record<string, string>,
  ): Promise<{ accepted: boolean; entityType?: string; entityId?: string }> {
    throw new NotImplementedError("August", "receiveWebhook");
  }
}
