/**
 * Automatic OwnerRez reservation sync (2026-09-30) — pure rules shared by
 * the cron route, the sync service, the health notifier and the
 * /reservations status line. No I/O here, so every rule is unit-tested
 * directly.
 *
 * Schedule: Vercel Cron, hourly at minute OWNERREZ_AUTO_SYNC_CRON_MINUTE
 * (UTC — Vercel cron is always UTC). apps/website/vercel.json must carry the
 * same minute; a test pins the two together.
 */

export const OWNERREZ_AUTO_SYNC_CRON_MINUTE = 17;
export const OWNERREZ_AUTO_SYNC_SCHEDULE = `${OWNERREZ_AUTO_SYNC_CRON_MINUTE} * * * *`;

/** "Stale" = no complete (SUCCEEDED) sync for longer than this. */
export const OWNERREZ_SYNC_STALE_MS = 3 * 60 * 60 * 1000;
/** Consecutive FAILED runs that trigger the in-app alert. */
export const OWNERREZ_SYNC_ALERT_FAILURES = 3;

/** Kill switch: automatic runs happen only when this is exactly "true". */
export function isOwnerRezAutoSyncEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.OWNERREZ_AUTO_SYNC_ENABLED === "true";
}

/** The next scheduled invocation strictly after `now` (UTC hourly minute). */
export function nextOwnerRezAutoSyncRun(now: Date): Date {
  const next = new Date(now);
  next.setUTCSeconds(0, 0);
  next.setUTCMinutes(OWNERREZ_AUTO_SYNC_CRON_MINUTE);
  if (next.getTime() <= now.getTime()) {
    next.setUTCHours(next.getUTCHours() + 1);
  }
  return next;
}

export function isOwnerRezSyncStale(
  lastSyncedAt: Date | null,
  now: Date,
): boolean {
  if (!lastSyncedAt) return true;
  return now.getTime() - lastSyncedAt.getTime() > OWNERREZ_SYNC_STALE_MS;
}

export interface OwnerRezSyncLogLike {
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL";
  errorMessage: string | null;
}

/**
 * FAILED runs in a row, newest first. RUNNING rows are ignored, and so are
 * FAILED rows carrying the rate-limit marker (the request budget or a 429
 * stopped the run before anything was written — the same safe condition as
 * a PARTIAL run, not a failure). Any SUCCEEDED or PARTIAL run ends the streak.
 */
export function countConsecutiveOwnerRezFailures(
  logsNewestFirst: OwnerRezSyncLogLike[],
  deferredMarker: string,
): number {
  let count = 0;
  for (const log of logsNewestFirst) {
    if (log.status === "RUNNING") continue;
    if (log.status === "FAILED") {
      if (log.errorMessage?.startsWith(deferredMarker)) continue;
      count++;
      continue;
    }
    break;
  }
  return count;
}

export type OwnerRezSyncAlertReason = "consecutive_failures" | "stale";

/**
 * Whether the health check should alert. Normal PARTIAL runs, cooldown /
 * already-running skips and the known unmatched OwnerRez property never
 * alert on their own; only a failure streak or a stale last complete sync
 * does, and only once per incident (`alreadyAlerted`: an alert exists since
 * the last complete sync).
 */
export function decideOwnerRezSyncAlert(input: {
  consecutiveFailures: number;
  stale: boolean;
  alreadyAlerted: boolean;
}): OwnerRezSyncAlertReason | null {
  if (input.alreadyAlerted) return null;
  if (input.consecutiveFailures >= OWNERREZ_SYNC_ALERT_FAILURES) {
    return "consecutive_failures";
  }
  if (input.stale) return "stale";
  return null;
}

/**
 * Whether a reservation row already holds exactly what the sync would
 * write. Compares every field the sync owns; any missing/unknown value
 * counts as changed, so the fallback is always the proven update.
 */
export interface OwnerRezReservationComparable {
  propertyId: string;
  primaryGuestId: string;
  status: string;
  checkInDate: Date;
  checkOutDate: Date;
  adults: number;
  children: number;
  pets: number;
  /** Prisma Decimal or number — compared as a fixed 2-dp string. */
  totalAmount: { toString(): string } | number;
  cancelledAt: Date | null;
}

function sameTime(a: Date | null | undefined, b: Date | null | undefined) {
  if (a == null || b == null) return a == null && b == null;
  return new Date(a).getTime() === new Date(b).getTime();
}

function money(value: { toString(): string } | number | null | undefined) {
  if (value == null) return null;
  const n = Number(value.toString());
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

export function isOwnerRezReservationUnchanged(
  existing: Partial<OwnerRezReservationComparable> & {
    hasPrimaryGuestLink?: boolean;
  },
  next: OwnerRezReservationComparable,
): boolean {
  if (existing.hasPrimaryGuestLink !== true) return false;
  const existingMoney = money(existing.totalAmount);
  return (
    existing.propertyId === next.propertyId &&
    existing.primaryGuestId === next.primaryGuestId &&
    existing.status === next.status &&
    existing.checkInDate != null &&
    sameTime(existing.checkInDate, next.checkInDate) &&
    existing.checkOutDate != null &&
    sameTime(existing.checkOutDate, next.checkOutDate) &&
    existing.adults === next.adults &&
    existing.children === next.children &&
    existing.pets === next.pets &&
    existingMoney !== null &&
    existingMoney === money(next.totalAmount) &&
    existing.cancelledAt !== undefined &&
    sameTime(existing.cancelledAt, next.cancelledAt)
  );
}
