import "server-only";

import { prisma } from "@stayw/database";

import type { NormalizedShift } from "./availability";
import type { ScheduleParseWarning } from "./sheet-schedule-parser";

/**
 * Durable storage for the schedule pipeline's last-known-good result —
 * reuses this codebase's EXISTING `IntegrationConnection`/
 * `IntegrationSyncLog` pattern (the same one August/Cielo/OwnerRez "Sync
 * Now" already uses via `beginDeviceSync()`/`finishDeviceSync()` in
 * integrations.service.ts) rather than inventing a new table. No new model
 * was added — only two additive enum values
 * (`IntegrationProvider.GOOGLE_SHEETS`, `IntegrationAuthType.NONE`, see
 * migration `20260917113152_add_google_sheets_integration_provider`).
 *
 * Deliberately actor-agnostic: unlike `beginDeviceSync()`, none of these
 * functions take an `AuthContext` or call `assertPermission()`. A real
 * automatic/scheduled refresh has no signed-in user performing it — RBAC
 * only makes sense at the true entry points (the manual-refresh action,
 * which already asserts `team:update` before calling into this module; a
 * future cron/job entry point would assert nothing, since it isn't a user
 * request). Putting a permission check inside this module would make it
 * impossible to ever call from a non-request context.
 */

const PROVIDER = "GOOGLE_SHEETS" as const;

/**
 * How much of the real schedule (which spans 18+ months in the live sheet)
 * gets persisted per sync — NOT the whole thing. The dashboard/`/team` only
 * ever need "yesterday" (for midnight-crossing WORKING_NOW checks) through
 * about a week and a half out (covers Today/Tomorrow/Week with margin).
 * Persisting the full 18-month history would bloat this single JSONB
 * column for zero operational benefit — nothing in this codebase ever
 * queries schedule data further out than `ScheduleRange` ("week") allows.
 */
const WINDOW_BEFORE_MS = 2 * 24 * 60 * 60 * 1000;
const WINDOW_AFTER_MS = 10 * 24 * 60 * 60 * 1000;

interface SerializedShift {
  personKey: string;
  start: string;
  end: string;
  label?: string;
}

interface ScheduleMetadata {
  shifts: SerializedShift[];
  warnings: ScheduleParseWarning[];
  fetchedAt: string;
}

export interface DurableScheduleSnapshot {
  shifts: NormalizedShift[];
  warnings: ScheduleParseWarning[];
  fetchedAt: Date;
}

/** Idempotent — same upsert-by-unique-provider idiom as `ensureConnectionRows()` in integrations.service.ts, scoped to just this one provider rather than the whole catalog. */
async function ensureConnection(): Promise<{ id: string }> {
  return prisma.integrationConnection.upsert({
    where: { provider: PROVIDER },
    create: {
      provider: PROVIDER,
      displayName: "VA/Team Schedule (Google Sheet)",
      authType: "NONE",
      status: "PENDING",
    },
    update: {},
    select: { id: true },
  });
}

/** Reads the last-known-good snapshot straight from the database — survives a server restart/redeploy, unlike a module-scoped variable. Returns null only when no sync has ever succeeded. */
export async function readDurableSnapshot(): Promise<DurableScheduleSnapshot | null> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: PROVIDER },
    select: { metadata: true, lastSyncedAt: true },
  });
  if (!connection?.lastSyncedAt) return null;

  const metadata = connection.metadata as unknown as ScheduleMetadata | null;
  if (!metadata?.shifts) return null;

  return {
    shifts: metadata.shifts.map((s) => ({
      personKey: s.personKey,
      start: new Date(s.start),
      end: new Date(s.end),
      label: s.label,
    })),
    warnings: metadata.warnings ?? [],
    fetchedAt: connection.lastSyncedAt,
  };
}

/** Windows shifts to the range this module actually needs to keep persisted (see WINDOW_BEFORE_MS/WINDOW_AFTER_MS above) before writing — applied here, in the one write path, so every caller benefits without repeating the logic. */
function windowShifts(
  shifts: readonly NormalizedShift[],
  now: Date,
): NormalizedShift[] {
  const windowStart = now.getTime() - WINDOW_BEFORE_MS;
  const windowEnd = now.getTime() + WINDOW_AFTER_MS;
  return shifts.filter(
    (s) => s.end.getTime() > windowStart && s.start.getTime() < windowEnd,
  );
}

/**
 * Writes a new last-known-good snapshot — called ONLY after a fetch AND a
 * successful, non-empty parse (see schedule.service.ts's refreshSnapshot()).
 * Bumps `lastSyncedAt` and flips `status` to CONNECTED; never called on a
 * failed or empty-parse attempt, which is what makes "never replace good
 * data with a failed fetch" durable rather than just an in-memory habit.
 */
export async function writeDurableSnapshot(
  shifts: readonly NormalizedShift[],
  warnings: readonly ScheduleParseWarning[],
  fetchedAt: Date,
): Promise<void> {
  const windowed = windowShifts(shifts, fetchedAt);
  const metadata: ScheduleMetadata = {
    shifts: windowed.map((s) => ({
      personKey: s.personKey,
      start: s.start.toISOString(),
      end: s.end.toISOString(),
      ...(s.label ? { label: s.label } : {}),
    })),
    warnings: [...warnings],
    fetchedAt: fetchedAt.toISOString(),
  };

  await prisma.integrationConnection.update({
    where: { provider: PROVIDER },
    data: {
      status: "CONNECTED",
      lastSyncedAt: fetchedAt,
      metadata: metadata as object,
    },
  });
}

export interface LastSyncAttempt {
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "PARTIAL";
  errorMessage: string | null;
  startedAt: Date;
}

/** The most recent sync attempt of any outcome — this is what makes "last attempted sync time" and "last sync result/error" durable across a restart, distinct from `lastSyncedAt` (last SUCCESSFUL sync only, on the connection row itself). */
export async function getLastSyncAttempt(): Promise<LastSyncAttempt | null> {
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: PROVIDER },
    select: { id: true },
  });
  if (!connection) return null;

  const log = await prisma.integrationSyncLog.findFirst({
    where: { integrationConnectionId: connection.id },
    orderBy: { startedAt: "desc" },
  });
  if (!log) return null;

  return {
    status: log.status,
    errorMessage: log.errorMessage,
    startedAt: log.startedAt,
  };
}

/**
 * A RUNNING sync-log row older than this is treated as abandoned by a
 * process that crashed before calling finishScheduleSync() — mirrors
 * integrations.service.ts's own STALE_RUNNING_THRESHOLD_MS reasoning
 * exactly, scaled to this pipeline's own real worst case: one GET with a
 * 15s AbortController timeout (schedule-source.ts), so even a fully-stalled
 * fetch resolves within 15s. 5 minutes leaves generous margin over that
 * worst case while still self-healing well within a single operator's
 * session if a process genuinely died mid-sync.
 */
const STALE_RUNNING_THRESHOLD_MS = 5 * 60 * 1000;

/**
 * Starts a schedule sync attempt — advisory-locked exactly like
 * `beginDeviceSync()` (two-key `pg_try_advisory_xact_lock`, its own
 * namespace, transaction-scoped only around these few fast queries, never
 * held across the slow external Sheet fetch). Returns `alreadyRunning` if
 * another attempt is genuinely in flight right now, so two overlapping
 * triggers (e.g. a cron tick landing during a manual refresh) can't both
 * proceed at once.
 */
export async function beginScheduleSync(): Promise<
  { logId: string; alreadyRunning: false } | { alreadyRunning: true }
> {
  const connection = await ensureConnection();

  return prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext('schedule_sync'), hashtext(${connection.id})) AS locked
    `;
    if (!lockRows[0]?.locked) {
      return { alreadyRunning: true } as const;
    }

    const existingRunning = await tx.integrationSyncLog.findFirst({
      where: { integrationConnectionId: connection.id, status: "RUNNING" },
    });

    if (existingRunning) {
      const ageMs = Date.now() - existingRunning.startedAt.getTime();
      if (ageMs < STALE_RUNNING_THRESHOLD_MS) {
        return { alreadyRunning: true } as const;
      }
      await tx.integrationSyncLog.update({
        where: { id: existingRunning.id },
        data: {
          status: "FAILED",
          errorMessage:
            "Sync timed out or the process terminated unexpectedly.",
          finishedAt: new Date(),
        },
      });
    }

    const log = await tx.integrationSyncLog.create({
      data: {
        integrationConnectionId: connection.id,
        direction: "INBOUND",
        entityType: "team_schedule_shift",
        status: "RUNNING",
      },
    });

    return { logId: log.id, alreadyRunning: false } as const;
  });
}

/** Finishes a sync started by beginScheduleSync() — updates the SAME log row to its terminal status. Never touches the connection's `lastSyncedAt`/`metadata` itself — that only ever happens via writeDurableSnapshot(), called separately, only on real success. */
export async function finishScheduleSync(
  logId: string,
  result:
    | { status: "SUCCEEDED"; recordsProcessed: number }
    | { status: "FAILED"; errorMessage: string },
): Promise<void> {
  await prisma.integrationSyncLog.update({
    where: { id: logId },
    data: {
      status: result.status,
      recordsProcessed:
        result.status === "SUCCEEDED" ? result.recordsProcessed : 0,
      errorMessage: result.status === "FAILED" ? result.errorMessage : null,
      finishedAt: new Date(),
    },
  });
}
