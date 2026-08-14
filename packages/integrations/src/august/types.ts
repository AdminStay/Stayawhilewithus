// August's real auth model (verified against py-august, the library
// Home Assistant's own August integration is built on — see this package's
// README) is not a static API key. First login needs a human to enter a
// 6-digit verification code sent to email/phone; the resulting `installId`
// can then be reused indefinitely to skip that step on later logins, and
// `accessToken` is what actually authorizes API calls (refreshed via a
// re-login using the same installId, not a separate refresh-token call).
// There is no way to obtain installId/accessToken without that one
// interactive step happening at least once, by a human, outside this app.
export interface AugustCredentials {
  /** Email or phone number used to log in — must match whichever the installId/accessToken pair below were issued for. */
  identifier: string;
  /** From a prior interactive (2FA) login. Reusing it is what lets later logins skip verification. */
  installId: string;
  /** From that same prior login. Not a long-lived static token — expect it to need periodic re-issuing via another login using the same installId. */
  accessToken: string;
  /**
   * Which account brand this login was issued under (see AUGUST_BRAND_CONFIGS
   * below). Determined automatically by scripts/login.ts, which tries every
   * known brand against the same credentials, and persisted as AUGUST_BRAND.
   * Defaults to "august" if absent, for backward compatibility with
   * credentials issued before this field existed.
   */
  brand?: AugustBrand;
}

/**
 * yalexs's const.py (`Brand` enum + `BRAND_CONFIG`) defines four account
 * brands. All four have historically shared the same August-made hardware
 * and mobile-app backend, but a given real account is only recognized under
 * ONE of these at a time — sending the wrong one's api key/host gets a
 * `{"code":"Forbidden","message":"API key is not valid"}` response (verified
 * against real-world reports of that exact error in
 * github.com/Yale-Libs/yalexs issues #99 and #150 — the same error text,
 * confirmed there to come specifically from an api-key/host mismatch, not a
 * bad password). "august" and "yale_access" are legacy August-app accounts
 * (no OAuth); "yale_august" and "yale_global" are accounts migrated to the
 * newer Yale ecosystem, which yalexs's own Brand enum documents as
 * "requires OAuth with Home Assistant" — this package's plain
 * identifier+password `/session` flow may not fully complete for those, but
 * trying it first is still the correct, low-risk diagnostic step (same
 * account, same one password entry, no extra exposure).
 */
export type AugustBrand =
  "august" | "yale_access" | "yale_august" | "yale_global";

export interface AugustBrandConfig {
  readonly name: AugustBrand;
  readonly baseUrl: string;
  readonly apiKeyHeader: string;
  readonly apiKey: string;
  readonly brandingHeader: string;
  readonly branding: string;
  readonly accessTokenHeader: string;
  readonly requiresOAuth: boolean;
}

/** Tried in this order by scripts/login.ts: yalexs's DEFAULT_BRAND ("august") first, then its sibling non-OAuth brand, then the two OAuth-flagged brands as a best-effort fallback. */
export const AUGUST_BRAND_CONFIGS: readonly AugustBrandConfig[] = [
  {
    name: "august",
    baseUrl: "https://api-production.august.com",
    apiKeyHeader: "x-august-api-key",
    apiKey: "d9984f29-07a6-816e-e1c9-44ec9d1be431",
    brandingHeader: "x-august-branding",
    branding: "august",
    accessTokenHeader: "x-august-access-token",
    requiresOAuth: false,
  },
  {
    name: "yale_access",
    baseUrl: "https://api-production.august.com",
    apiKeyHeader: "x-august-api-key",
    apiKey: "d9984f29-07a6-816e-e1c9-44ec9d1be431",
    brandingHeader: "x-august-branding",
    branding: "yale",
    accessTokenHeader: "x-august-access-token",
    requiresOAuth: false,
  },
  {
    name: "yale_august",
    baseUrl: "https://api-production.august.com",
    apiKeyHeader: "x-august-api-key",
    apiKey: "66814fd9-af2c-426c-9710-b37e7eadfb51",
    brandingHeader: "x-august-branding",
    branding: "august",
    accessTokenHeader: "x-august-access-token",
    requiresOAuth: true,
  },
  {
    name: "yale_global",
    baseUrl: "https://api.aaecosystem.com",
    apiKeyHeader: "x-api-key",
    apiKey: "d16a1029-d823-4b55-a4ce-a769a9b56f0e",
    brandingHeader: "x-branding",
    branding: "yale",
    accessTokenHeader: "x-access-token",
    requiresOAuth: true,
  },
] as const;

export function isAugustBrand(value: string): value is AugustBrand {
  return AUGUST_BRAND_CONFIGS.some((c) => c.name === value);
}

/**
 * One entry from `GET /users/locks/mine`, normalized — verified against
 * py-august's `Lock` class (august/lock.py: `LockName`, `HouseID` fields).
 */
export interface AugustLock {
  id: string;
  name: string;
  houseId: string;
}

/**
 * `GET /locks/{lockId}`, normalized — verified against py-august's
 * `LockDetail` class (august/lock.py). `battery` in the raw API response is
 * a 0–1 fraction; the client converts it to a 0–100 integer to match
 * SmartDevice.metadata.batteryLevel's existing convention (see
 * smart-devices.service.ts). `online` reflects the lock's WiFi
 * Bridge/Connect hub connectivity (py-august's `bridge_is_online`) — a
 * different concept from locked/unlocked, which this integration
 * deliberately does not report (StayWhile only needs connectivity +
 * battery, not lock state).
 */
export interface AugustLockDetail {
  id: string;
  name: string;
  houseId: string;
  batteryLevel: number | null;
  online: boolean;
}
