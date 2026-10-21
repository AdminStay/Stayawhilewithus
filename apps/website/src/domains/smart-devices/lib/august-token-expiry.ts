/**
 * August login expiry warning (2026-10-21).
 *
 * August's access token lasts about 30 days and the app cannot ask August
 * when it expires, so the expiry time is set by hand in the NON-secret
 * setting AUGUST_TOKEN_EXPIRES_AT — the `expiresAt` the login script
 * prints. Missing or invalid → "not configured"; a date is never guessed.
 *
 * The raw setting value is never echoed anywhere (UI, logs, errors): if a
 * token were pasted into it by mistake, it would still not be shown. Only a
 * parsed, re-formatted date ever leaves this file.
 *
 * No imports, so server and client components can both use it.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The warning starts this long before the login expires. */
export const AUGUST_TOKEN_EXPIRY_WARNING_MS = 7 * DAY_MS;

/** "Renew by" is this long before expiry, leaving time to update Vercel and redeploy. */
export const AUGUST_TOKEN_RENEWAL_BUFFER_MS = 1 * DAY_MS;

export const AUGUST_TOKEN_RENEWAL_STEPS =
  "Renew the August login with the August login script, update AUGUST_ACCESS_TOKEN and AUGUST_TOKEN_EXPIRES_AT in the August settings in Vercel, and redeploy.";

export const AUGUST_TOKEN_EXPIRY_NOT_CONFIGURED_MESSAGE =
  "August login expiry date not configured. Set AUGUST_TOKEN_EXPIRES_AT in Vercel to the expiry time the August login script prints (e.g. 2026-11-19T11:32:00Z) to get a warning before the login expires.";

export type AugustTokenExpiry =
  | { state: "not_configured"; reason: "missing" | "invalid" }
  | { state: "ok"; expiresAt: string; renewBy: string; warnFrom: string }
  | {
      state: "expiring_soon";
      expiresAt: string;
      renewBy: string;
      /** Milliseconds until expiry at evaluation time (> 0). */
      msLeft: number;
    }
  | { state: "expired"; expiresAt: string };

/**
 * Strict ISO 8601 date-time with an explicit time zone ("Z" or ±hh:mm),
 * e.g. 2026-11-19T11:32:08.123Z. A date without a time zone is ambiguous
 * and rejected.
 */
const ISO_WITH_ZONE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?(Z|[+-](\d{2}):(\d{2}))$/;

/** Parses the setting, or returns null when it isn't a real, zoned date-time. */
export function parseAugustTokenExpiresAt(
  raw: string | undefined | null,
): Date | null {
  const value = raw?.trim();
  if (!value) return null;
  const m = ISO_WITH_ZONE.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s, zone, zh, zm] = m;
  const year = Number(y);
  const month = Number(mo);
  const day = Number(d);
  // Date.parse rolls impossible dates over (2026-02-30 → March 2), so the
  // calendar fields are checked here first.
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth) return null;
  if (Number(h) > 23 || Number(mi) > 59 || Number(s ?? 0) > 59) return null;
  if (zone !== "Z" && (Number(zh) > 23 || Number(zm) > 59)) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms) : null;
}

/** Where the August login stands at `now`, from the raw setting value. */
export function getAugustTokenExpiryStatus(
  raw: string | undefined | null,
  now: Date,
): AugustTokenExpiry {
  if (!raw?.trim()) return { state: "not_configured", reason: "missing" };
  const expires = parseAugustTokenExpiresAt(raw);
  if (!expires) return { state: "not_configured", reason: "invalid" };

  const expiresMs = expires.getTime();
  const msLeft = expiresMs - now.getTime();
  const expiresAt = expires.toISOString();
  if (msLeft <= 0) return { state: "expired", expiresAt };

  const renewBy = new Date(
    expiresMs - AUGUST_TOKEN_RENEWAL_BUFFER_MS,
  ).toISOString();
  if (msLeft <= AUGUST_TOKEN_EXPIRY_WARNING_MS) {
    return { state: "expiring_soon", expiresAt, renewBy, msLeft };
  }
  return {
    state: "ok",
    expiresAt,
    renewBy,
    warnFrom: new Date(
      expiresMs - AUGUST_TOKEN_EXPIRY_WARNING_MS,
    ).toISOString(),
  };
}

/** e.g. "Nov 19, 2026, 11:32 UTC" — always UTC, so server and browser agree. */
export function formatAugustExpiryTime(iso: string): string {
  return `${new Date(iso).toLocaleString("en-US", {
    timeZone: "UTC",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  })} UTC`;
}

function formatTimeLeft(msLeft: number): string {
  if (msLeft < DAY_MS) {
    const hours = Math.floor(msLeft / (60 * 60 * 1000));
    if (hours < 1) return "in under an hour";
    return hours === 1 ? "in about 1 hour" : `in about ${hours} hours`;
  }
  const days = Math.floor(msLeft / DAY_MS);
  return days === 1 ? "in 1 day" : `in ${days} days`;
}

/** The text and tone to show for a status. */
export function describeAugustTokenExpiry(status: AugustTokenExpiry): {
  tone: "neutral" | "warning" | "error";
  text: string;
} {
  switch (status.state) {
    case "not_configured":
      return {
        tone: "neutral",
        text:
          status.reason === "invalid"
            ? `${AUGUST_TOKEN_EXPIRY_NOT_CONFIGURED_MESSAGE} The current value isn't a valid date-time with a time zone.`
            : AUGUST_TOKEN_EXPIRY_NOT_CONFIGURED_MESSAGE,
      };
    case "ok":
      return {
        tone: "neutral",
        text: `August login expires ${formatAugustExpiryTime(status.expiresAt)}. A renewal warning will appear from ${formatAugustExpiryTime(status.warnFrom)}.`,
      };
    case "expiring_soon":
      return {
        tone: "warning",
        text: `August login expires ${formatTimeLeft(status.msLeft)} (${formatAugustExpiryTime(status.expiresAt)}). Renew by ${formatAugustExpiryTime(status.renewBy)}: ${AUGUST_TOKEN_RENEWAL_STEPS}`,
      };
    case "expired":
      return {
        tone: "error",
        text: `August login expired ${formatAugustExpiryTime(status.expiresAt)}. August refuses the old login after this time, so lock readings stop updating until it's renewed. ${AUGUST_TOKEN_RENEWAL_STEPS} If you already renewed it, update AUGUST_TOKEN_EXPIRES_AT too.`,
      };
  }
}
