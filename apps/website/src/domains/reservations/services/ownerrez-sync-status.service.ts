import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma } from "@stayw/database";

import {
  countConsecutiveOwnerRezFailures,
  decideOwnerRezSyncAlert,
  isOwnerRezAutoSyncEnabled,
  isOwnerRezSyncStale,
  nextOwnerRezAutoSyncRun,
  type OwnerRezSyncAlertReason,
} from "@/domains/reservations/lib/ownerrez-auto-sync";
import {
  describeOwnerRezSyncFailure,
  parseOwnerRezSyncExceptions,
  type OwnerRezSyncExceptions,
} from "@/domains/reservations/lib/ownerrez-sync-outcome";
import {
  logOwnerRezReservationSync,
  OWNERREZ_DEFERRED_MARKER,
} from "@/domains/reservations/services/ownerrez-reservation-sync.service";
import { createNotificationsForGlobalRole } from "@/platform/notifications/create-notification";

/**
 * OwnerRez reservation-sync visibility + failure alerting (2026-09-30).
 * Read-only against the existing IntegrationConnection / IntegrationSyncLog /
 * AuditLog rows the sync already writes — no new table, no migration.
 */

/** Entity marker for alert Notifications (dedupe key, with the connection id). */
export const OWNERREZ_SYNC_ALERT_ENTITY = "OwnerRezReservationSync";
const RECENT_LOGS = 10;
const SYNC_AUDIT_ACTION = "reservation.ownerrez_synced";
/**
 * Matching a completed run to its audit entry (the only place its
 * skipped-booking counts are saved). The run sets its log's finishedAt and
 * then, in the same process, writes the entry with occurredAt — both
 * `new Date()` on the application clock, in that order — so the entry's
 * occurredAt is at or just after finishedAt (12–97 ms in Production,
 * 669 of 669 runs, checked 2026-10-28). The match is therefore:
 * occurredAt in [finishedAt, finishedAt + this window], earliest first.
 * - An earlier run's entry is older than finishedAt: the next run can only
 *   start after the earlier one closed its log, and a run takes seconds.
 * - A later run's entry would make that later run the latest log, which is
 *   what gets shown instead.
 * - No entry in the window (or one without counts) → counts unknown, which
 *   the status line shows as "not recorded", never as clean.
 * Not createdAt: that is a schema default, not guaranteed to come from the
 * same clock as finishedAt.
 */
export const OWNERREZ_RESULT_AUDIT_WINDOW_MS = 2 * 60 * 1000;

export interface OwnerRezSyncStatus {
  autoSyncEnabled: boolean;
  /** Last complete (SUCCEEDED) sync, manual or automatic. */
  lastCompleteSyncAt: Date | null;
  lastAttempt: {
    status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL";
    rateLimited: boolean;
    startedAt: Date;
    finishedAt: Date | null;
    recordsProcessed: number;
    /**
     * SUCCEEDED/PARTIAL only: the run's saved exception counts, or null
     * when the run has no readable audit entry (older records).
     */
    exceptions: OwnerRezSyncExceptions | null;
    /** FAILED only: a fixed, safe description — never the stored error text. */
    failureReason: string | null;
  } | null;
  /** Last completed run started by the scheduler (from its SYSTEM audit entry). */
  lastAutomaticRunAt: Date | null;
  /** Only when automatic sync is on. */
  nextExpectedRunAt: Date | null;
  stale: boolean;
  consecutiveFailures: number;
}

async function loadOwnerRezSyncState() {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: "OWNERREZ" },
    select: { id: true, lastSyncedAt: true },
  });
  if (!connection) return null;
  const logs = await prisma.integrationSyncLog.findMany({
    where: {
      integrationConnectionId: connection.id,
      entityType: "Reservation",
    },
    orderBy: { startedAt: "desc" },
    take: RECENT_LOGS,
    select: {
      status: true,
      errorMessage: true,
      startedAt: true,
      finishedAt: true,
      recordsProcessed: true,
    },
  });
  return { connection, logs };
}

export async function getOwnerRezSyncStatus(
  actor: AuthContext,
  now: Date = new Date(),
): Promise<OwnerRezSyncStatus | null> {
  await assertPermission(actor, "reservations:read");
  const state = await loadOwnerRezSyncState();
  if (!state) return null;
  const { connection, logs } = state;

  const lastAutomatic = await prisma.auditLog.findFirst({
    where: {
      action: SYNC_AUDIT_ACTION,
      entityType: "IntegrationConnection",
      entityId: connection.id,
      actorType: "SYSTEM",
    },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });

  const autoSyncEnabled = isOwnerRezAutoSyncEnabled();
  const latest = logs[0];

  // The latest completed run's own audit entry (see
  // OWNERREZ_RESULT_AUDIT_WINDOW_MS for why this window and order).
  let exceptions: OwnerRezSyncExceptions | null = null;
  if (
    latest?.finishedAt &&
    (latest.status === "SUCCEEDED" || latest.status === "PARTIAL")
  ) {
    const runAudit = await prisma.auditLog.findFirst({
      where: {
        action: SYNC_AUDIT_ACTION,
        entityType: "IntegrationConnection",
        entityId: connection.id,
        occurredAt: {
          gte: latest.finishedAt,
          lte: new Date(
            latest.finishedAt.getTime() + OWNERREZ_RESULT_AUDIT_WINDOW_MS,
          ),
        },
      },
      orderBy: { occurredAt: "asc" },
      select: { afterState: true },
    });
    exceptions = parseOwnerRezSyncExceptions(runAudit?.afterState ?? null);
  }

  return {
    autoSyncEnabled,
    lastCompleteSyncAt: connection.lastSyncedAt,
    lastAttempt: latest
      ? {
          status: latest.status,
          rateLimited:
            latest.errorMessage?.startsWith(OWNERREZ_DEFERRED_MARKER) ?? false,
          startedAt: latest.startedAt,
          finishedAt: latest.finishedAt,
          recordsProcessed: latest.recordsProcessed,
          exceptions,
          failureReason:
            latest.status === "FAILED"
              ? describeOwnerRezSyncFailure(
                  latest.errorMessage,
                  OWNERREZ_DEFERRED_MARKER,
                )
              : null,
        }
      : null,
    lastAutomaticRunAt: lastAutomatic?.createdAt ?? null,
    nextExpectedRunAt: autoSyncEnabled ? nextOwnerRezAutoSyncRun(now) : null,
    stale: isOwnerRezSyncStale(connection.lastSyncedAt, now),
    consecutiveFailures: countConsecutiveOwnerRezFailures(
      logs,
      OWNERREZ_DEFERRED_MARKER,
    ),
  };
}

const ALERT_TEXT: Record<
  OwnerRezSyncAlertReason,
  { title: string; body: string }
> = {
  consecutive_failures: {
    title: "OwnerRez automatic sync is failing",
    body: "The last 3 OwnerRez reservation syncs failed. New or changed OwnerRez bookings may be missing from StayWhile. Check Reservations → OwnerRez sync; the manual Sync OwnerRez button still works as a fallback.",
  },
  stale: {
    title: "OwnerRez reservations are out of date",
    body: "No complete OwnerRez reservation sync in over 3 hours. New or changed OwnerRez bookings may be missing from StayWhile. Check Reservations → OwnerRez sync; the manual Sync OwnerRez button still works as a fallback.",
  },
};

/**
 * Runs after every automatic attempt (never for manual runs). Creates one
 * in-app SYSTEM notification for each global admin when the sync has failed
 * 3 times in a row or has had no complete sync for over 3 hours — once per
 * incident: nothing more until a complete sync moves lastSyncedAt past the
 * existing alert. Never throws (monitoring must not break the sync).
 */
export async function checkOwnerRezSyncHealthAndAlert(
  now: Date = new Date(),
): Promise<OwnerRezSyncAlertReason | null> {
  try {
    const state = await loadOwnerRezSyncState();
    if (!state) return null;
    const { connection, logs } = state;

    const existingAlert = await prisma.notification.findFirst({
      where: {
        relatedEntityType: OWNERREZ_SYNC_ALERT_ENTITY,
        relatedEntityId: connection.id,
        ...(connection.lastSyncedAt
          ? { createdAt: { gt: connection.lastSyncedAt } }
          : {}),
      },
      select: { id: true },
    });

    const reason = decideOwnerRezSyncAlert({
      consecutiveFailures: countConsecutiveOwnerRezFailures(
        logs,
        OWNERREZ_DEFERRED_MARKER,
      ),
      stale: isOwnerRezSyncStale(connection.lastSyncedAt, now),
      alreadyAlerted: existingAlert !== null,
    });
    if (!reason) return null;

    const count = await createNotificationsForGlobalRole("admin", {
      type: "SYSTEM",
      channel: "IN_APP",
      title: ALERT_TEXT[reason].title,
      body: ALERT_TEXT[reason].body,
      relatedEntityType: OWNERREZ_SYNC_ALERT_ENTITY,
      relatedEntityId: connection.id,
    });
    logOwnerRezReservationSync("auto_sync_alert_created", {
      reason,
      recipients: count,
    });
    return reason;
  } catch (err) {
    logOwnerRezReservationSync("auto_sync_alert_failed", {
      error: err instanceof Error ? err.name : "unknown",
    });
    return null;
  }
}
