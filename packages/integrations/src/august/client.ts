import type { SyncDirection } from "@stayw/database/enums";

import {
  HttpClient,
  NotImplementedError,
  type HttpRequestCallOptions,
} from "../core";
import type {
  BaseIntegrationClient,
  IntegrationCapability,
  SyncCapable,
  WebhookReceivable,
} from "../core";

import {
  AUGUST_BRAND_CONFIGS,
  type AugustConnectivity,
  type AugustCredentials,
  type AugustLock,
  type AugustLockCapabilities,
  type AugustLockDetail,
} from "./types";

export type {
  AugustBrand,
  AugustConnectivity,
  AugustLock,
  AugustLockCapabilities,
  AugustLockDetail,
  AugustLockOperation,
} from "./types";
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

interface RawAugustLockStatus {
  status?: string;
  valid?: boolean;
  dateTime?: string;
}

interface RawAugustBatteryInfo {
  infoUpdatedDate?: string;
}

interface RawAugustLockDetail {
  LockID: string;
  LockName: string;
  HouseID: string;
  battery: number;
  Bridge?: RawAugustBridge;
  LockStatus?: RawAugustLockStatus;
  batteryInfo?: RawAugustBatteryInfo;
  SerialNumber?: string;
}

/**
 * `GET /devices/capabilities?serialNumber=...&topLevelHost=true` response
 * shape — verified against yalexs's capabilities.py. Only the fields this
 * client actually reads are typed; the real response has 20+ more `lock.*`
 * flags this integration has no use for yet.
 */
interface RawAugustLockCapabilities {
  lock?: {
    unlatch?: boolean;
  };
}

/**
 * Verified against py-august's `LockDetail.bridge_is_online` (august/lock.py)
 * for the Bridge-present case. The UNKNOWN branch is the fix for a real
 * production bug: a live field-by-field audit (2026-08-20) found that some
 * lock hardware/firmware generations never return a `Bridge` object at all
 * — not `operative: false`, structurally absent — while still sending
 * recent battery telemetry (see telemetryUpdatedAt on the same response).
 * Mapping "no Bridge" to OFFLINE was misclassifying working devices as
 * down. No Bridge means no reliable signal, not "confirmed offline."
 */
function deriveConnectivity(
  bridge: RawAugustBridge | undefined,
): AugustConnectivity {
  if (!bridge) return "UNKNOWN";
  if (!bridge.status && bridge.operative) return "ONLINE";
  return bridge.status?.current === "online" ? "ONLINE" : "OFFLINE";
}

/**
 * August's real API reports a negative fraction (observed: -1, which
 * becomes -100 once scaled to a percentage below) as its "no battery
 * reading available" sentinel — confirmed live against Production locks
 * with a dead/never-reported battery. A negative percentage isn't a
 * meaningful reading of any kind, so it's normalized to null (same
 * "unknown, not a fabricated value" convention as every other nullable
 * field on AugustLockDetail) rather than rendered literally.
 */
function parseBatteryLevel(battery: number | undefined): number | null {
  if (typeof battery !== "number") return null;
  const percent = Math.round(battery * 100);
  return percent < 0 ? null : percent;
}

/**
 * August integration client — real HTTP calls against the verified (if
 * unofficial — August has no public developer API) api-production.august.com
 * endpoints, ported from py-august's august/api_common.py and august/lock.py.
 * See this package's README for the one-time interactive login step this
 * client deliberately does NOT perform (see august/scripts/login.ts) —
 * `AugustCredentials.accessToken` must already exist before this client can
 * do anything.
 *
 * `lock()`/`unlock()`/`unlatch()`/`getLockCapabilities()` (2026-09-18) are
 * this client's only write/command methods — verified against yalexs's
 * actual source, not guessed (see AugustLockOperation/AugustLockCapabilities
 * in ./types.ts for the endpoint/response detail). This class itself never
 * decides whether a command is *allowed* — capability gating, RBAC,
 * mapping/enable checks, the Production test allowlist, and audit logging
 * all live one layer up, in
 * apps/website/src/domains/smart-devices/services/august-commands.service.ts
 * — the only caller of these methods anywhere in this app. PIN/access-code
 * operations remain entirely unimplemented (out of scope, and per the
 * existing capability audit, PIN create/edit/delete isn't even available in
 * August's own API).
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

  /**
   * `GET /locks/{lockId}` — battery level, connectivity, and (where the
   * provider gives a valid reading) lock state and a real-time seen
   * timestamp for one lock. See AugustLockDetail's doc comment (./types.ts)
   * for exactly what each field means and why several are nullable rather
   * than guessed.
   *
   * `callOptions` (2026-09-25): lets a caller with its own retry loop and
   * time budget — sendAugustLockCommand()'s confirmation polling — make a
   * single-attempt read (`{ maxRetries: 0 }`) so each poll is bounded by
   * one timeout. Omitted everywhere else, so default read retries apply.
   */
  async getLockDetail(
    lockId: string,
    callOptions: HttpRequestCallOptions = {},
  ): Promise<AugustLockDetail> {
    const raw = await this.http.request<RawAugustLockDetail>(
      `/locks/${encodeURIComponent(lockId)}`,
      {},
      callOptions,
    );
    const lockStatus = raw.LockStatus;
    const validLockStatus = lockStatus?.valid === true;
    return {
      id: raw.LockID,
      name: raw.LockName,
      houseId: raw.HouseID,
      batteryLevel: parseBatteryLevel(raw.battery),
      connectivity: deriveConnectivity(raw.Bridge),
      lockState: validLockStatus ? (lockStatus?.status ?? null) : null,
      telemetryUpdatedAt: raw.batteryInfo?.infoUpdatedDate ?? null,
      seenAt: validLockStatus ? (lockStatus?.dateTime ?? null) : null,
      serialNumber: raw.SerialNumber ?? null,
    };
  }

  /**
   * `GET /devices/capabilities?serialNumber=...&topLevelHost=true` —
   * verified against yalexs's capabilities.py. `unlatch` is the one flag
   * that genuinely varies by lock model; lock/unlock support is treated as
   * tied to the `lock` key being present at all (i.e. this is a real,
   * remotely-operable lock model) — see AugustLockCapabilities's own doc
   * comment (./types.ts) for why. Callers MUST call this with a fresh
   * `serialNumber` immediately before every command — never cache or reuse
   * a prior result, since a device's capabilities are provider-owned state
   * this client has no way to know is still current.
   */
  async getLockCapabilities(
    serialNumber: string,
  ): Promise<AugustLockCapabilities> {
    const raw = await this.http.request<RawAugustLockCapabilities>(
      `/devices/capabilities?serialNumber=${encodeURIComponent(serialNumber)}&topLevelHost=true`,
    );
    const hasLockCapabilities = raw.lock !== undefined;
    return {
      lock: hasLockCapabilities,
      unlock: hasLockCapabilities,
      unlatch: raw.lock?.unlatch === true,
    };
  }

  /**
   * `?type=async` (2026-09-25, Phase 2 of the Orion incident's root-cause
   * correction — chosen over simply raising the timeout; see the comparison
   * in HANDOFF/PR notes) — the async variant August's own API supports:
   * this PUT returns almost immediately once August has acknowledged
   * receipt, WITHOUT blocking on the physical operation actually
   * completing. This deliberately trades the old synchronous variant's
   * single long-blocking connection (a real risk of a serverless function's
   * own execution-time limit, on top of everything already wrong with a
   * single fixed timeout for a physical actuator) for a fast, low-risk
   * write plus a separate, bounded, already-safe series of ordinary reads
   * to confirm the result — see sendAugustLockCommand()'s
   * pollForConfirmedLockState() (august-commands.service.ts) for that
   * confirmation loop. Deliberately does NOT trust this acknowledgment
   * response's own body/status as proof of the resulting lock state, same
   * discipline as the old synchronous variant — the *meaning* of success
   * is established entirely by the follow-up read(s), never here. This
   * method only proves August acknowledged the request (a 4xx/5xx throws,
   * same as every other method on this client).
   *
   * `{ maxRetries: 0 }` (2026-09-25, Phase 1 of the same correction):
   * HttpClient's normal exponential-backoff retry-on-network-failure
   * behavior is exactly right for a read, but wrong for a physical write —
   * if this request times out or the connection aborts, we have no way to
   * know whether August/the bridge already received and is processing the
   * command, so silently retransmitting it could send a second real
   * physical command on top of a first one we never confirmed. With this
   * option, ANY failure here — a real HTTP error response or a
   * network-level abort/timeout — is thrown immediately after this single
   * attempt, never retried by this client; the resulting uncertainty is
   * exactly what sendAugustLockCommand()'s AMBIGUOUS classification exists
   * to represent honestly, one layer up. Every read method on this class
   * (getLockDetail, getLockCapabilities, listLocks, connect/healthCheck/
   * validateCredentials) is unaffected — none of them pass this option, so
   * they keep this client's normal configured retry behavior via
   * HttpClient's own default.
   *
   * `ignoreSuccessBody: true` (2026-09-25, the Coco Vista incident): the
   * async PUT answers 2xx with an EMPTY body. Parsing it as JSON threw
   * "Unexpected end of JSON input" after August had already accepted and
   * executed the command, so sendAugustLockCommand() recorded AMBIGUOUS and
   * never ran its confirmation polling. The body carries nothing this client
   * trusts anyway: a 2xx here means only "accepted", and success is decided
   * solely by the follow-up reads. Shared by lock(), unlock() and unlatch().
   */
  private async operate(
    lockId: string,
    segment: "lock" | "unlock" | "unlatch",
  ): Promise<void> {
    await this.http.request<unknown>(
      `/remoteoperate/${encodeURIComponent(lockId)}/${segment}?type=async`,
      { method: "PUT" },
      { maxRetries: 0, ignoreSuccessBody: true },
    );
  }

  /** `PUT /remoteoperate/{lockId}/lock` — see operate()'s doc comment. */
  async lock(lockId: string): Promise<void> {
    await this.operate(lockId, "lock");
  }

  /** `PUT /remoteoperate/{lockId}/unlock` — see operate()'s doc comment. */
  async unlock(lockId: string): Promise<void> {
    await this.operate(lockId, "unlock");
  }

  /**
   * `PUT /remoteoperate/{lockId}/unlatch` — see operate()'s doc comment.
   * Callers MUST confirm `AugustLockCapabilities.unlatch` via a fresh
   * getLockCapabilities() call before ever calling this — this method
   * itself performs no capability check, matching every other method on
   * this client (capability/authorization gating lives one layer up).
   */
  async unlatch(lockId: string): Promise<void> {
    await this.operate(lockId, "unlatch");
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
