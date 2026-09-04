import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import {
  AugustClient,
  isAugustBrand,
  type AugustLockDetail,
} from "@stayw/integrations/august";

import { AUGUST_DETAIL_CONCURRENCY, chunk } from "./provider-devices.service";

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
 */
function toAugustLockMetadata(lock: AugustLockDetail): Record<string, unknown> {
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
export async function refreshAugustTelemetry(
  actor: AuthContext,
): Promise<AugustRefreshResult> {
  await assertPermission(actor, "smart_devices:update");

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
    actorUserId: actor.userId,
    eligibleCount: eligibleDevices.length,
  });

  if (eligibleDevices.length === 0) {
    logLockRefresh("august_no_eligible_rows", { actorUserId: actor.userId });
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
        actorUserId: actor.userId,
        batchSize: batch.length,
      });
    }
  }

  logLockRefresh("august_refresh_completed", {
    actorUserId: actor.userId,
    refreshed,
    notReturnedByProvider,
  });

  return { refreshed, notReturnedByProvider };
}
