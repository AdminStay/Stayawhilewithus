import "server-only";

import { assertPermission, type AuthContext } from "@stayw/auth";
import { prisma, type Prisma } from "@stayw/database";
import { AugustClient, isAugustBrand } from "@stayw/integrations/august";

import {
  refreshAugustSpotSchema,
  type RefreshAugustSpotInput,
} from "../schemas/lock-spot-refresh.schema";

import { recordAudit } from "@/platform/audit/record-audit";

/**
 * Manual, per-device "Refresh telemetry" for a small, explicitly-selected
 * set of existing August SmartDevice rows — the id-scoped counterpart to
 * lock-refresh.service.ts's refreshAugustTelemetry() (which refreshes every
 * ProviderDevice-enabled lock in one pass) and completely separate from
 * smart-devices.service.ts's syncAugustDevices() (the legacy, whole-fleet
 * AUGUST_PROPERTY_MAP sync). Built for exactly one situation: refreshing a
 * specific legacy lock (e.g. Bonjour AMI's) that the newer ProviderDevice
 * pipeline never reaches, without re-running the entire legacy sync.
 *
 * Selection is by exact SmartDevice.id only — never a name, property, or
 * search term. Never discovers, creates, upserts, maps, unmaps, enables, or
 * disables anything; never touches ProviderDevice at all; never changes
 * propertyId, name, or externalDeviceId; never calls a lock/unlock or
 * PIN/access-code endpoint (AugustClient implements no such method — see
 * that client's own doc comment). Only ever writes status/metadata/
 * lastSeenAt on rows that already exist, by their own id.
 *
 * Unlike every other provider-metadata write in this codebase,
 * `metadata` is MERGED with the row's existing value, not replaced — a
 * momentary missing field in one device's API response must not erase a
 * previously-known reading for a hand-picked troubleshooting tool like this
 * one. (refreshAugustTelemetry()/refreshNestTelemetry() intentionally still
 * do a full replace; that's correct for a whole-fleet pass where a provider
 * genuinely stopped reporting a field, and is left unchanged.)
 *
 * Each requested id is resolved and refreshed independently — one device's
 * provider-call failure never affects another's result.
 */

export type SpotRefreshResultCode =
  "success" | "provider_failure" | "not_found" | "invalid_selection";

export interface SpotRefreshOutcome {
  smartDeviceId: string;
  result: SpotRefreshResultCode;
  error?: string;
}

export function logLockSpotRefresh(
  event: string,
  data: Record<string, unknown> = {},
): void {
  console.log(
    "[lock-spot-refresh]",
    JSON.stringify({ event, ...data, timestamp: new Date().toISOString() }),
  );
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

/**
 * Merges only the keys August's response actually included this call on
 * top of the row's existing metadata — an omitted field keeps its last
 * known value instead of being dropped. Deliberately the opposite of
 * toAugustLockMetadata() (lock-refresh.service.ts), which builds a fresh
 * replacement object every time; that difference is the entire reason this
 * function lives in its own file rather than extending that one.
 */
function mergeAugustLockMetadata(
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

export async function refreshAugustTelemetryForSelectedLocks(
  actor: AuthContext,
  rawInput: RefreshAugustSpotInput,
): Promise<SpotRefreshOutcome[]> {
  await assertPermission(actor, "smart_devices:update");
  const input = refreshAugustSpotSchema.parse(rawInput);

  // Configuration is validated unconditionally, before checking any
  // individual row — same discipline as every other provider refresh/sync
  // function in this codebase (a VA should see a clear "not configured"
  // failure, never a silently-misleading per-row result for a credentials
  // problem).
  const client = getAugustClientFromEnv();

  // One batched read for every requested id — a DB read can't fail "per
  // row" the way a provider API call can, so there's no independence
  // concern in fetching them together; independence is enforced below, at
  // the provider-call/write step, which is what actually matters.
  const existingRows = await prisma.smartDevice.findMany({
    where: { id: { in: input.smartDeviceIds } },
    select: {
      id: true,
      provider: true,
      deviceType: true,
      externalDeviceId: true,
      metadata: true,
      status: true,
      lastSeenAt: true,
    },
  });
  const existingById = new Map(existingRows.map((row) => [row.id, row]));

  logLockSpotRefresh("spot_refresh_requested", {
    actorUserId: actor.userId,
    requestedCount: input.smartDeviceIds.length,
  });

  const outcomes = await Promise.all(
    input.smartDeviceIds.map(
      async (smartDeviceId): Promise<SpotRefreshOutcome> => {
        const row = existingById.get(smartDeviceId);
        if (!row) {
          logLockSpotRefresh("not_found", {
            actorUserId: actor.userId,
            smartDeviceId,
          });
          return { smartDeviceId, result: "not_found" };
        }
        if (row.provider !== "AUGUST" || row.deviceType !== "LOCK") {
          // No August API call is made for this id at all — an
          // invalid-selection row is rejected before any provider contact,
          // never coerced into a real call.
          logLockSpotRefresh("invalid_selection", {
            actorUserId: actor.userId,
            smartDeviceId,
            provider: row.provider,
            deviceType: row.deviceType,
          });
          return { smartDeviceId, result: "invalid_selection" };
        }

        try {
          // The one and only real August call this function makes per
          // device — the same already-audited GET-only method every other
          // August refresh path uses (no new endpoint).
          const detail = await client.getLockDetail(row.externalDeviceId);

          const existingMetadata =
            (row.metadata as Record<string, unknown> | null) ?? {};
          const mergedMetadata = mergeAugustLockMetadata(existingMetadata, {
            batteryLevel: detail.batteryLevel,
            lockState: detail.lockState,
            telemetryUpdatedAt: detail.telemetryUpdatedAt,
          });

          const updated = await prisma.smartDevice.update({
            where: { id: row.id },
            data: {
              status: detail.connectivity,
              metadata: mergedMetadata as Prisma.InputJsonValue,
              lastSeenAt: detail.seenAt ? new Date(detail.seenAt) : null,
            },
          });

          await recordAudit({
            actorUserId: actor.userId,
            actorType: "USER",
            action: "smart_device.telemetry_spot_refreshed",
            entityType: "SmartDevice",
            entityId: row.id,
            beforeState: {
              status: row.status,
              lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
            } satisfies Prisma.InputJsonValue,
            afterState: {
              status: updated.status,
              lastSeenAt: updated.lastSeenAt?.toISOString() ?? null,
            } satisfies Prisma.InputJsonValue,
          });

          logLockSpotRefresh("success", {
            actorUserId: actor.userId,
            smartDeviceId,
          });
          return { smartDeviceId, result: "success" };
        } catch (err) {
          // A rejected/thrown getLockDetail() call for this device leaves
          // its row completely untouched — no write of any kind is
          // attempted below this catch, and this catch never affects any
          // other device's own independent outcome.
          const error = err instanceof Error ? err.message : String(err);
          logLockSpotRefresh("provider_failure", {
            actorUserId: actor.userId,
            smartDeviceId,
            error,
          });
          return { smartDeviceId, result: "provider_failure", error };
        }
      },
    ),
  );

  logLockSpotRefresh("spot_refresh_completed", {
    actorUserId: actor.userId,
    successCount: outcomes.filter((o) => o.result === "success").length,
    notFoundCount: outcomes.filter((o) => o.result === "not_found").length,
    invalidSelectionCount: outcomes.filter(
      (o) => o.result === "invalid_selection",
    ).length,
    providerFailureCount: outcomes.filter(
      (o) => o.result === "provider_failure",
    ).length,
  });

  return outcomes;
}
