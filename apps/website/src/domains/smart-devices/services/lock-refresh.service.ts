import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  AugustClient,
  isAugustBrand,
  type AugustLockDetail,
} from "@stayw/integrations/august";

import { AUGUST_DETAIL_CONCURRENCY, chunk } from "./provider-devices.service";

import {
  ensureConnectionRows,
  STALE_RUNNING_THRESHOLD_MS,
} from "@/domains/integrations/services/integrations.service";

/**
 * Manual telemetry refresh for August locks already onboarded through the
 * ProviderDevice Map -> Enable pipeline — the read-from-provider,
 * write-telemetry-to-StayWhile-DB counterpart to
 * thermostat-refresh.service.ts's refreshNestTelemetry()/
 * refreshCieloTelemetry(), same file-level guarantees: never creates, maps,
 * unmaps, enables, disables, or deletes a device, and never calls a
 * lock/unlock or PIN/access-code endpoint (AugustClient itself implements
 * no such method — see packages/integrations/src/august/client.ts's own
 * doc comment, "does not implement lock/unlock").
 *
 * Deliberately does NOT reuse syncAugustDevices() (smart-devices.service.ts)
 * — that function is a real upsert keyed on AUGUST_PROPERTY_MAP, and it
 * never touches the ProviderDevice table at all, so it can't be narrowed to
 * "already-enabled devices only" the way this file's query is. It also
 * deliberately does NOT expand or read AUGUST_PROPERTY_MAP — eligibility
 * here comes exclusively from ProviderDevice.enabled/.smartDeviceId, which
 * is how the newer Map -> Enable fleet is represented.
 *
 * Known, deliberately-accepted overlap: Island Tides' 2 locks are covered
 * by BOTH this function (their ProviderDevice rows are enabled=true with a
 * live smartDeviceId, unlike the rest of the legacy 4-house/7-lock set,
 * which is unlinked) AND the legacy AUGUST_PROPERTY_MAP-driven Sync Now.
 * Both paths only ever write read-only telemetry derived from the same
 * August API fields (deriveConnectivity/parseBatteryLevel in
 * AugustClient), so this is a recency/ownership overlap, not a
 * correctness or safety conflict — see HANDOFF for the full reconciliation
 * this was verified against before this file was written.
 */

/**
 * Every diagnostic line this file emits goes through this one function,
 * always under the `[lock-refresh]` prefix, mirroring
 * thermostat-refresh.service.ts's logThermostatRefresh() exactly — same
 * hard rule: only non-secret operational facts (actor id, counts, status
 * strings), never a credential, env value, token, or raw provider payload.
 */
export function logLockRefresh(
  event: string,
  data: Record<string, unknown> = {},
): void {
  console.log(
    "[lock-refresh]",
    JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }),
  );
}

/**
 * Field-for-field identical to syncAugustDevices()'s own inline metadata
 * object (smart-devices.service.ts) — deliberately NOT
 * provider-devices.service.ts's toAugustSmartDeviceMetadata(), which always
 * stamps its `observedAt` parameter as `telemetryUpdatedAt` unconditionally.
 * That's the correct contract for setProviderDeviceEnabled()'s one call
 * site (copying a stored discovery snapshot's own confirmed time forward),
 * but wrong here: a successful getLockDetail() call proves StayWhile
 * reached August's API just now, not that August's lock itself reported
 * fresh telemetry just now — those are different facts, and only
 * `detail.telemetryUpdatedAt` (August's own batteryInfo.infoUpdatedDate)
 * honestly represents the second one. Matching the legacy sync path exactly:
 * telemetryUpdatedAt is included only when August actually reported one,
 * using that exact value — never fabricated from this refresh's own
 * execution time. A device August reports no telemetry timestamp for
 * simply keeps whatever telemetryUpdatedAt (or absence of one) it already
 * had, exactly like every other field this function doesn't touch.
 *
 * Exported (2026-09-18) so august-commands.service.ts's post-command
 * confirmation read reuses this exact same semantic — a real physical
 * command's own confirmation read is the same kind of fact as a refresh's
 * read (proves StayWhile reached August just now, not that August itself
 * has fresh telemetry), so it needs this function, not
 * toAugustSmartDeviceMetadata()'s always-stamp variant.
 */
export function toAugustLockMetadata(
  lock: AugustLockDetail,
): Record<string, unknown> {
  return {
    ...(lock.batteryLevel != null && { batteryLevel: lock.batteryLevel }),
    ...(lock.lockState != null && { lockState: lock.lockState }),
    ...(lock.telemetryUpdatedAt != null && {
      telemetryUpdatedAt: lock.telemetryUpdatedAt,
    }),
  };
}

function getAugustClientFromEnv(): AugustClient {
  const identifier = process.env.AUGUST_IDENTIFIER;
  const installId = process.env.AUGUST_INSTALL_ID;
  const accessToken = process.env.AUGUST_ACCESS_TOKEN;
  const brand = process.env.AUGUST_BRAND;
  if (!identifier || !installId || !accessToken) {
    throw new Error(
      "August isn't configured — set AUGUST_IDENTIFIER/AUGUST_INSTALL_ID/AUGUST_ACCESS_TOKEN.",
    );
  }
  return new AugustClient({
    identifier,
    installId,
    accessToken,
    brand: brand && isAugustBrand(brand) ? brand : "august",
  });
}

export interface AugustRefreshResult {
  /** Already-enabled/mapped August locks whose SmartDevice/ProviderDevice telemetry was updated from a fresh read. */
  refreshed: number;
  /** Enabled devices whose getLockDetail() call failed or rejected this run — left completely untouched, never pruned/disabled/reclassified. */
  notReturnedByProvider: number;
}

/**
 * Refreshes telemetry for August locks that are ALREADY enabled/mapped via
 * ProviderDevice — never discovers, maps, unmaps, enables, disables, or
 * creates anything, and never calls a lock/unlock or PIN/access-code
 * endpoint (no such method is imported into this file at all — see
 * lock-refresh.service.test.ts's dedicated source-level guarantee test).
 *
 * This is the shared core both the human-triggered refreshAugustTelemetry()
 * (below — RBAC-gated) and the automatic, scheduler-triggered
 * refreshAugustTelemetryAutomatic() (further below — actor-agnostic, no
 * RBAC, no human involved) call — identical read/write behavior either way,
 * so a manual click and an automatic tick can never diverge in what they
 * actually do to a device's data.
 *
 * Unlike Nest/Cielo, August has no single bulk "give me every device's full
 * detail" call — listLocks() returns identity only, and
 * battery/connectivity/lock-state require one getLockDetail() call per
 * lock. Reuses the exact bounded-concurrency batching
 * (AUGUST_DETAIL_CONCURRENCY, chunk()) discoverAugustDevices() already
 * established in provider-devices.service.ts specifically to avoid the
 * real Production P2024/pool-timeout incident a naive per-lock loop caused
 * before (see that constant's own doc comment) — this file imports and
 * reuses those exact values rather than redefining its own.
 *
 * Each batch's HTTP calls fully settle (Promise.allSettled) before any DB
 * write for that batch, and only that batch's successful details are
 * written in one further batched prisma.$transaction — a failed
 * getLockDetail() call for one lock never blocks or fails any other lock's
 * refresh, in the same batch or a different one.
 */
async function runAugustTelemetryRefresh(): Promise<AugustRefreshResult> {
  // Configuration is validated unconditionally, before checking whether
  // there's anything to refresh — same discipline as every other provider
  // refresh/sync function in this codebase.
  const client = getAugustClientFromEnv();

  const eligibleDevices = await prisma.providerDevice.findMany({
    where: {
      enabled: true,
      smartDeviceId: { not: null },
      integrationConnection: { provider: "AUGUST" },
    },
    select: { id: true, externalDeviceId: true, smartDeviceId: true },
  });
  logLockRefresh("august_eligible_rows", {
    eligibleCount: eligibleDevices.length,
  });

  if (eligibleDevices.length === 0) {
    logLockRefresh("august_no_eligible_rows", {});
    return { refreshed: 0, notReturnedByProvider: 0 };
  }

  // `now` is only ever used for ProviderDevice.lastSeenAt below — StayWhile's
  // own "we last successfully contacted the provider for this row" fact,
  // exactly matching discoverAugustDevices()'s Phase 2 and
  // refreshNestTelemetry()'s identical use of `now` for the same field. It
  // must NEVER be used to represent August's own telemetry timestamp — see
  // toAugustLockMetadata() below for why.
  const now = new Date();
  let refreshed = 0;
  let notReturnedByProvider = 0;

  for (const batch of chunk(eligibleDevices, AUGUST_DETAIL_CONCURRENCY)) {
    // Each settled outcome carries its own `device` reference (captured
    // before the awaited call, inside the same async arrow) rather than
    // being paired up afterward by array index — avoids ever indexing
    // `results[i]`/`batch[i]` separately, which under this project's
    // noUncheckedIndexedAccess tsconfig setting would type as possibly
    // `undefined` despite the two arrays always being the same length.
    const settled = await Promise.allSettled(
      batch.map(async (device) => ({
        device,
        detail: await client.getLockDetail(device.externalDeviceId),
      })),
    );

    const writes: Prisma.PrismaPromise<unknown>[] = [];

    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") {
        notReturnedByProvider++;
        continue;
      }
      const {
        device,
        detail,
      }: {
        device: (typeof eligibleDevices)[number];
        detail: AugustLockDetail;
      } = outcome.value;

      // Defensive — the query above already filters on this, but never
      // trust an assumed invariant blindly (same discipline as elsewhere
      // in this codebase, e.g. refreshNestTelemetry()'s matching check).
      if (!device.smartDeviceId) {
        notReturnedByProvider++;
        continue;
      }

      // Existing rows only, by their own real id/unique key — never an
      // upsert, so this can never create a SmartDevice or ProviderDevice
      // row. detail.connectivity is already August's own tri-state
      // signal (deriveConnectivity() in AugustClient) — UNKNOWN when no
      // Bridge object is present, never manufactured here. lastSeenAt
      // mirrors syncAugustDevices()'s own field exactly: August's real
      // LockStatus.dateTime when validly reported, null otherwise — never
      // this refresh's own execution time.
      writes.push(
        prisma.smartDevice.update({
          where: { id: device.smartDeviceId },
          data: {
            status: detail.connectivity,
            metadata: toAugustLockMetadata(detail) as Prisma.InputJsonValue,
            lastSeenAt: detail.seenAt ? new Date(detail.seenAt) : null,
          },
        }),
      );
      writes.push(
        prisma.providerDevice.update({
          where: { id: device.id },
          data: {
            connectivityStatus: detail.connectivity,
            rawMetadata: detail as unknown as Prisma.InputJsonValue,
            lastSeenAt: now,
          },
        }),
      );
    }

    if (writes.length > 0) {
      await prisma.$transaction(writes);
      refreshed += writes.length / 2;
    } else {
      logLockRefresh("august_batch_zero_matched", {
        batchSize: batch.length,
      });
    }
  }

  logLockRefresh("august_refresh_completed", {
    refreshed,
    notReturnedByProvider,
  });

  return { refreshed, notReturnedByProvider };
}

/**
 * Every real outcome any guarded (RBAC-gated OR automatic) August refresh
 * entry point can produce. `already_running` covers every source of
 * contention this mechanism protects against — another automatic tick,
 * another manual Refresh All, or a manual Sync Now/Discover — the caller
 * never needs to know or care which one is holding the row.
 */
export type AugustRefreshOutcome =
  | ({ status: "completed" } & AugustRefreshResult)
  | { status: "already_running" }
  | { status: "failed"; reason: string };

/**
 * The one lock name every August-connection sync/refresh path shares —
 * reused verbatim from beginDeviceSync() (integrations.service.ts) so
 * every one of them (automatic refresh, manual Refresh All, manual Sync
 * Now/Discover) can never run concurrently against the same AUGUST
 * IntegrationConnection, regardless of which claims the advisory lock
 * first.
 */
const INTEGRATION_SYNC_LOCK_NAME = "integration_sync";

/**
 * The single, shared claim-run-finish implementation behind EVERY August
 * telemetry refresh entry point — human-clicked (refreshAugustTelemetry)
 * and scheduler-triggered (refreshAugustTelemetryAutomatic) alike. Neither
 * public function duplicates any of this logic; they differ only in
 * whether they run an RBAC check first. This is deliberate: the whole
 * point of this review was to close the gap where the manual "Refresh all"
 * button could run concurrently with the automatic job (or with itself, or
 * with a manual Sync Now/Discover) — a second, differently-written
 * implementation here would just be a second place for that gap to
 * reappear.
 *
 * Mechanism (identical to beginDeviceSync()'s own, integrations.service.ts):
 *   1. `pg_try_advisory_xact_lock('integration_sync', <connectionId>)` —
 *      transaction-scoped, released the instant the claim transaction
 *      below commits. This makes the "is there already a RUNNING row?
 *      if not, create one" check atomic against a simultaneous race at the
 *      same instant — it is NOT what protects the actual refresh work
 *      below, which runs after the lock is already released.
 *   2. The real protection during that (potentially slow) work is the
 *      durable `RUNNING` IntegrationSyncLog row itself, checked against
 *      the exact same STALE_RUNNING_THRESHOLD_MS beginDeviceSync() uses
 *      (imported, never redefined — see that constant's own doc comment
 *      for why a mismatched threshold here would be a real cross-path
 *      mutual-exclusion bug, not a cosmetic inconsistency). Any other
 *      caller — automatic or manual, this function or beginDeviceSync() —
 *      checking the same connection's RUNNING row while it's still fresh
 *      correctly refuses to start.
 *   3. `IntegrationSyncLog` is closed out `SUCCEEDED` (with the real
 *      `recordsProcessed`) or `FAILED` (with a sanitized message — the
 *      only errors that can reach this catch are getAugustClientFromEnv()'s
 *      static "isn't configured" message, or a genuinely unexpected
 *      Prisma/network failure; every per-device provider failure is
 *      already isolated and swallowed inside runAugustTelemetryRefresh()
 *      itself). `IntegrationConnection.lastSyncedAt`/`status` is bumped
 *      only on success, mirroring finishDeviceSync()'s own documented
 *      convention ("preserve the last good data when a new sync fails").
 *
 * Never creates, maps, unmaps, enables, disables, or deletes anything —
 * inherits every one of the shared core's guarantees unchanged, including
 * the structural impossibility of reaching a lock/unlock/PIN endpoint from
 * this file (see this file's own dedicated source-level test).
 */
async function runGuardedAugustTelemetryRefresh(): Promise<AugustRefreshOutcome> {
  await ensureConnectionRows();
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { provider: "AUGUST" },
  });

  const claim = await prisma.$transaction(async (tx) => {
    const lockRows = await tx.$queryRaw<{ locked: boolean }[]>`
      SELECT pg_try_advisory_xact_lock(hashtext(${INTEGRATION_SYNC_LOCK_NAME}), hashtext(${connection.id})) AS locked
    `;
    if (!lockRows[0]?.locked) {
      return { proceeding: false } as const;
    }

    const existingRunning = await tx.integrationSyncLog.findFirst({
      where: { integrationConnectionId: connection.id, status: "RUNNING" },
    });
    if (existingRunning) {
      const ageMs = Date.now() - existingRunning.startedAt.getTime();
      if (ageMs < STALE_RUNNING_THRESHOLD_MS) {
        return { proceeding: false } as const;
      }
      await tx.integrationSyncLog.update({
        where: { id: existingRunning.id },
        data: {
          status: "FAILED",
          errorMessage:
            "August refresh timed out or the process terminated unexpectedly.",
          finishedAt: new Date(),
        },
      });
    }

    const log = await tx.integrationSyncLog.create({
      data: {
        integrationConnectionId: connection.id,
        direction: "INBOUND",
        entityType: "SmartDevice",
        status: "RUNNING",
      },
    });
    return { proceeding: true, logId: log.id } as const;
  });

  if (!claim.proceeding) {
    logLockRefresh("august_refresh_skipped_already_running", {});
    return { status: "already_running" };
  }

  try {
    const result = await runAugustTelemetryRefresh();

    await prisma.integrationSyncLog.update({
      where: { id: claim.logId },
      data: {
        status: "SUCCEEDED",
        recordsProcessed: result.refreshed,
        finishedAt: new Date(),
      },
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { status: "CONNECTED", lastSyncedAt: new Date() },
    });

    logLockRefresh("august_guarded_refresh_completed", {
      refreshed: result.refreshed,
      notReturnedByProvider: result.notReturnedByProvider,
    });
    return { status: "completed", ...result };
  } catch (err) {
    // Same convention as finishDeviceSync()'s real caller today
    // (actions.ts): the caught error's own message is stored — never a
    // second, separately-serialized raw provider payload or credential.
    const message = err instanceof Error ? err.message : "Unknown error";
    await prisma.integrationSyncLog.update({
      where: { id: claim.logId },
      data: { status: "FAILED", errorMessage: message, finishedAt: new Date() },
    });
    logLockRefresh("august_guarded_refresh_failed", { error: message });
    return { status: "failed", reason: message };
  }
}

/**
 * Human-triggered entry point — the existing "Refresh all" dashboard
 * action. RBAC-gated exactly as before, then delegates entirely to the
 * shared guarded core above — this is what closes the gap this review
 * found: before this change, "Refresh all" bypassed the mutual-exclusion
 * mechanism entirely (no advisory lock, no IntegrationSyncLog row) and
 * could run concurrently with the automatic refresh, with a manual Sync
 * Now/Discover, or with itself (e.g. a double submission). It now
 * participates in exactly the same protection those already had.
 */
export async function refreshAugustTelemetry(
  actor: AuthContext,
): Promise<AugustRefreshOutcome> {
  await assertPermission(actor, "smart_devices:update");
  return runGuardedAugustTelemetryRefresh();
}

/**
 * Actor-agnostic automatic refresh — the scheduler-triggered counterpart to
 * refreshAugustTelemetry() above, called only from
 * app/api/cron/august-lock-refresh/route.ts (itself authenticated via its
 * own dedicated AUGUST_REFRESH_CRON_SECRET check, never a signed-in
 * StayWhile user). No `assertPermission` call here is correct, not an
 * oversight: there is no human actor to check a permission against, exactly
 * like runScheduleSync()'s own documented reasoning. Otherwise identical to
 * the human-triggered path above — same shared guarded core, same
 * protection against every other August refresh/sync path.
 */
export async function refreshAugustTelemetryAutomatic(): Promise<AugustRefreshOutcome> {
  return runGuardedAugustTelemetryRefresh();
}
