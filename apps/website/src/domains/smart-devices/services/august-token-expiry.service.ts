import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";

import {
  getAugustTokenExpiryStatus,
  type AugustTokenExpiry,
} from "../lib/august-token-expiry";

/**
 * The August login's expiry status for /integrations and /locks
 * (2026-10-21). Reads only the non-secret AUGUST_TOKEN_EXPIRES_AT setting —
 * never the token, install ID or any other credential — and never calls
 * August. Returns only the parsed status, never the raw value.
 */
export async function getAugustTokenExpiry(
  actor: AuthContext,
  permission: "integrations:read" | "smart_devices:read",
  now: Date = new Date(),
): Promise<AugustTokenExpiry> {
  await assertPermission(actor, permission);
  return getAugustTokenExpiryStatus(process.env.AUGUST_TOKEN_EXPIRES_AT, now);
}
