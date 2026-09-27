import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  AugustClient,
  isAugustBrand,
  type AugustLockDetail,
} from "@stayw/integrations/august";
import { HttpRequestError } from "@stayw/integrations/core";

import { buildLockHealthUpdate } from "../lib/lock-health";

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
 * Originally exported (2026-09-18) so august-commands.service.ts's
 * post-command confirmation write could reuse this exact telemetry-shaping
 * semantic (proves StayWhile reached August just now, not that August
 * itself has fresh telemetry — the same reasoning as this function's own
 * doc comment above, as opposed to toAugustSmartDeviceMetadata()'s
 * always-stamp variant). As of 2026-09-23's release-review Fix 4, that
 * call site moved to mergeAugustLockMetadata() below instead (a full
 * replace there could silently erase item C's `retiredAt`) — this
 * function itself is unchanged and still correct on its own terms, just
 * no longer called anywhere in this app as of this fix. Kept rather than
 * deleted since removing it wasn't asked for as part of this fix; flagged
 * here so it isn't mistaken for still being load-bearing.
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

/**
 * Merges only the telemetry keys a fresh August read actually included on
 * top of a row's EXISTING metadata — an omitted field keeps its last known
 * value, and any key this refresh doesn't own (2026-09-23, item C's release
 * review: `retiredAt`, the explicit-retirement marker — but written this
 * way generically, not as a `retiredAt` special case, so it also protects
 * any other future non-telemetry key the same way) survives untouched.
 * Moved here (2026-09-23) from lock-spot-refresh.service.ts, which
 * originally kept it private specifically because runAugustTelemetryRefresh()
 * below used to do a full replace via toAugustLockMetadata() instead — that
 * was the real gap: a whole-fleet refresh run (manual "Refresh all" or
 * item B's automatic tick) could silently erase item C's `retiredAt` for any
 * device whose retirement raced with that run. Both refresh entry points
 * now use this same merge function; lock-spot-refresh.service.ts imports it
 * from here rather than keeping its own copy.
 *
 * A distinct function from toAugustLockMetadata() above (kept, not merged
 * into one), since that one's fresh-replacement shape was still a
 * deliberate design choice when it was written and remains a valid choice
 * in general — it's simply not correct for any of the five real August
 * write sites this app currently has, all five of which have since been
 * moved onto this merge function instead: this refresh (Fix 1),
 * lock-spot-refresh.service.ts's spot refresh (already safe before this
 * round), setProviderDeviceEnabled() (Fix 2, provider-devices.service.ts),
 * syncAugustDevices() (Fix 3, smart-devices.service.ts), and
 * sendAugustLockCommand()'s confirmation write (Fix 4,
 * august-commands.service.ts). As of Fix 4, no August SmartDevice write
 * path in this app still uses toAugustLockMetadata() — see this fix's own
 * written report for the complete inventory.
 */
export function mergeAugustLockMetadata(
  existing: Record<string, unknown>,
  fresh: {
    batteryLevel: number | null;
    lockState: string | null;
    telemetryUpdatedAt: string | null;
  },
): Record<string, unknown> {
  return {
    ...existing,
    ...(fresh.batteryLevel != null && { batteryLevel: fresh.batteryLevel }),
    ...(fresh.lockState != null && { lockState: fresh.lockState }),
    ...(fresh.telemetryUpdatedAt != null && {
      telemetryUpdatedAt: fresh.telemetryUpdatedAt,
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
 * Refresh-on-view + rate-limit protection (2026-09-27). n8n Cloud Starter
 * (2,500 executions/month) rules out frequent n8n polling, so /locks asks
 * the server to refresh while someone is viewing it — at most once per
 * LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS globally, however many viewers/tabs.
 *
 * August publishes no rate limit, and the same August account also sends
 * dashboard lock commands, so a 429 stops the run immediately (remaining
 * locks are not requested) and every fleet-refresh entry point — on-view,
 * automatic cron, manual "Refresh all" — then refuses to call August until
 * the cooldown ends. The cooldown is derived from the durable
 * IntegrationSyncLog row (errorMessage starts with the marker below), so it
 * survives serverless instances and needs no schema change.
 */
export const LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS = 10 * 60 * 1000;
export const AUGUST_RATE_LIMIT_COOLDOWN_MS = 30 * 60 * 1000;
export const AUGUST_RATE_LIMITED_MARKER = "AUGUST_RATE_LIMITED";

interface AugustRefreshRunResult extends AugustRefreshResult {
  /** True when August answered 429 and the remaining batches were not requested. */
  rateLimited: boolean;
  /** Eligible locks never requested because the run stopped after a 429. */
  skippedAfterRateLimit: number;
}

function isRateLimitError(reason: unknown): boolean {
  return reason instanceof HttpRequestError && reason.status === 429;
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
async function runAugustTelemetryRefresh(): Promise<AugustRefreshRunResult> {
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
    select: {
      id: true,
      externalDeviceId: true,
      smartDeviceId: true,
      // Existing metadata, so the per-device write below can merge fresh
      // telemetry onto it instead of replacing it wholesale — see
      // mergeAugustLockMetadata()'s own doc comment for why (2026-09-23
      // release-review fix).
      smartDevice: { select: { metadata: true } },
    },
  });
  logLockRefresh("august_eligible_rows", {
    eligibleCount: eligibleDevices.length,
  });

  if (eligibleDevices.length === 0) {
    logLockRefresh("august_no_eligible_rows", {});
    return {
      refreshed: 0,
      notReturnedByProvider: 0,
      rateLimited: false,
      skippedAfterRateLimit: 0,
    };
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
  let rateLimited = false;
  let requested = 0;

  for (const batch of chunk(eligibleDevices, AUGUST_DETAIL_CONCURRENCY)) {
    // 429 breaker: once August has asked us to slow down, no further batch
    // is requested. The batch that saw the 429 still has its successful
    // readings written below.
    if (rateLimited) break;
    requested += batch.length;
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
    let batchRefreshed = 0;

    for (const outcome of settled) {
      if (outcome.status !== "fulfilled") {
        notReturnedByProvider++;
        if (isRateLimitError(outcome.reason)) rateLimited = true;
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
      //
      // metadata is MERGED (mergeAugustLockMetadata), not replaced
      // (2026-09-23 release-review fix) — onto whatever this same query
      // already read for this device, above. A full replace here could
      // silently erase item C's `retiredAt` (or any other non-telemetry
      // key) for a device whose retirement happened after this run's
      // eligibility query but before this specific write — see
      // mergeAugustLockMetadata()'s own doc comment for the full history.
      //
      // Lock-health monitoring (2026-09-25): buildLockHealthUpdate() applies
      // the same merge, stores the lockHealth snapshot, sets lockState to the
      // CURRENT state ("unknown" for an invalid reading, never a stale
      // locked/unlocked), and returns the real transitions to record.
      const health = buildLockHealthUpdate(
        (device.smartDevice?.metadata as Record<string, unknown>) ?? {},
        detail,
        now,
      );
      writes.push(
        prisma.smartDevice.update({
          where: { id: device.smartDeviceId },
          data: {
            status: detail.connectivity,
            metadata: health.metadata as Prisma.InputJsonValue,
            lastSeenAt: detail.seenAt ? new Date(detail.seenAt) : null,
          },
        }),
      );
      if (health.events.length > 0) {
        writes.push(
          prisma.smartDeviceEvent.createMany({
            data: health.events.map((event) => ({
              smartDeviceId: device.smartDeviceId as string,
              eventType: event.eventType,
              payload: event.payload as Prisma.InputJsonValue,
              occurredAt: event.occurredAt,
            })),
          }),
        );
      }
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
      batchRefreshed++;
    }

    if (writes.length > 0) {
      await prisma.$transaction(writes);
      refreshed += batchRefreshed;
    } else {
      logLockRefresh("august_batch_zero_matched", {
        batchSize: batch.length,
      });
    }
  }

  const skippedAfterRateLimit = eligibleDevices.length - requested;
  logLockRefresh("august_refresh_completed", {
    refreshed,
    notReturnedByProvider,
    rateLimited,
    skippedAfterRateLimit,
  });

  return {
    refreshed,
    notReturnedByProvider,
    rateLimited,
    skippedAfterRateLimit,
  };
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
  | { status: "failed"; reason: string }
  /** August answered 429: the run stopped early and the cooldown started. */
  | ({
      status: "rate_limited";
      skippedAfterRateLimit: number;
      cooldownUntil: string;
    } & AugustRefreshResult)
  /** A recent 429 cooldown is active: August was not called. */
  | { status: "cooldown"; cooldownUntil: string }
  /** On-view only: a fleet refresh already started within the minimum interval. */
  | { status: "fresh"; lastStartedAt: string };

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
async function runGuardedAugustTelemetryRefresh(
  options: { minIntervalMs?: number } = {},
): Promise<AugustRefreshOutcome> {
  await ensureConnectionRows();
  const connection = await prisma.integrationConnection.findUniqueOrThrow({
    where: { provider: "AUGUST" },
  });

  type Claim =
    | { proceeding: true; logId: string }
    | { proceeding: false; outcome?: AugustRefreshOutcome };
  const claim = await prisma.$transaction(async (tx): Promise<Claim> => {
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

    // Rate-limit cooldown (every entry point) and the on-view freshness gate
    // are checked inside the same advisory-locked claim, so two viewers
    // arriving together can never both start a run.
    const now = Date.now();
    const rateLimited = await tx.integrationSyncLog.findFirst({
      where: {
        integrationConnectionId: connection.id,
        status: "FAILED",
        errorMessage: { startsWith: AUGUST_RATE_LIMITED_MARKER },
        finishedAt: { gte: new Date(now - AUGUST_RATE_LIMIT_COOLDOWN_MS) },
      },
      orderBy: { finishedAt: "desc" },
    });
    if (rateLimited?.finishedAt) {
      return {
        proceeding: false,
        outcome: {
          status: "cooldown",
          cooldownUntil: new Date(
            rateLimited.finishedAt.getTime() + AUGUST_RATE_LIMIT_COOLDOWN_MS,
          ).toISOString(),
        },
      } as const;
    }
    if (options.minIntervalMs !== undefined) {
      const recent = await tx.integrationSyncLog.findFirst({
        where: {
          integrationConnectionId: connection.id,
          startedAt: { gte: new Date(now - options.minIntervalMs) },
        },
        orderBy: { startedAt: "desc" },
      });
      if (recent) {
        return {
          proceeding: false,
          outcome: {
            status: "fresh",
            lastStartedAt: recent.startedAt.toISOString(),
          },
        } as const;
      }
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
    if (claim.outcome) {
      logLockRefresh(`august_refresh_skipped_${claim.outcome.status}`, {});
      return claim.outcome;
    }
    logLockRefresh("august_refresh_skipped_already_running", {});
    return { status: "already_running" };
  }

  try {
    const { rateLimited, skippedAfterRateLimit, ...result } =
      await runAugustTelemetryRefresh();

    if (rateLimited) {
      // Closed FAILED with the marker so every entry point sees the
      // cooldown; lastSyncedAt is not bumped (the fleet wasn't refreshed).
      const finishedAt = new Date();
      await prisma.integrationSyncLog.update({
        where: { id: claim.logId },
        data: {
          status: "FAILED",
          recordsProcessed: result.refreshed,
          errorMessage: `${AUGUST_RATE_LIMITED_MARKER}: August returned HTTP 429; ${skippedAfterRateLimit} lock(s) not requested. Fleet refresh paused for ${AUGUST_RATE_LIMIT_COOLDOWN_MS / 60_000} min.`,
          finishedAt,
        },
      });
      logLockRefresh("august_guarded_refresh_rate_limited", {
        refreshed: result.refreshed,
        notReturnedByProvider: result.notReturnedByProvider,
        skippedAfterRateLimit,
      });
      return {
        status: "rate_limited",
        ...result,
        skippedAfterRateLimit,
        cooldownUntil: new Date(
          finishedAt.getTime() + AUGUST_RATE_LIMIT_COOLDOWN_MS,
        ).toISOString(),
      };
    }

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

/**
 * Refresh-on-view entry point (2026-09-27), called by /locks while it is
 * open (POST /api/locks/refresh-if-stale) — never from the page render.
 * Any viewer (smart_devices:read) may ask, but the server decides: the
 * shared guarded core only starts a run when no fleet refresh has started
 * in the last LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS, nothing is RUNNING and
 * no 429 cooldown is active. It can therefore never be used to force or
 * multiply August requests, and it runs exactly the same read-only refresh
 * as the automatic cron and manual "Refresh all".
 */
export async function refreshAugustTelemetryIfStale(
  actor: AuthContext,
): Promise<AugustRefreshOutcome> {
  await assertPermission(actor, "smart_devices:read");
  return runGuardedAugustTelemetryRefresh({
    minIntervalMs: LOCK_REFRESH_ON_VIEW_MIN_INTERVAL_MS,
  });
}

export interface AugustRefreshFreshness {
  /** When the last fleet refresh finished successfully (the "Updated X min ago" time). */
  lastSucceededAt: string | null;
  /** End of an active 429 cooldown, or null. */
  cooldownUntil: string | null;
}

/**
 * Read-only fleet-refresh freshness for /locks. Never creates the
 * connection row or any log (safe to call during the page render).
 */
export async function getAugustRefreshFreshness(
  actor: AuthContext,
): Promise<AugustRefreshFreshness> {
  await assertPermission(actor, "smart_devices:read");
  const connection = await prisma.integrationConnection.findUnique({
    where: { provider: "AUGUST" },
    select: { id: true },
  });
  if (!connection) return { lastSucceededAt: null, cooldownUntil: null };

  const [succeeded, rateLimited] = await Promise.all([
    prisma.integrationSyncLog.findFirst({
      where: { integrationConnectionId: connection.id, status: "SUCCEEDED" },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
    prisma.integrationSyncLog.findFirst({
      where: {
        integrationConnectionId: connection.id,
        status: "FAILED",
        errorMessage: { startsWith: AUGUST_RATE_LIMITED_MARKER },
        finishedAt: {
          gte: new Date(Date.now() - AUGUST_RATE_LIMIT_COOLDOWN_MS),
        },
      },
      orderBy: { finishedAt: "desc" },
      select: { finishedAt: true },
    }),
  ]);
  return {
    lastSucceededAt: succeeded?.finishedAt?.toISOString() ?? null,
    cooldownUntil: rateLimited?.finishedAt
      ? new Date(
          rateLimited.finishedAt.getTime() + AUGUST_RATE_LIMIT_COOLDOWN_MS,
        ).toISOString()
      : null,
  };
}
