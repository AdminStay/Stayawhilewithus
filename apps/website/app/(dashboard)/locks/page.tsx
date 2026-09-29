import { hasPermission } from "@stayw/auth";
import { PageHeader } from "@stayw/ui";

import {
  refreshAugustAction,
  refreshAugustTelemetryBatchAction,
  refreshAugustTelemetrySpotAction,
  clearLockOperationalHoldAction,
  recordLockVerificationEvidenceAction,
  resetAugustLockAction,
  retireSmartDeviceAction,
  sendAugustLockCommandAction,
  setLockControlEnabledAction,
  setLockOperationalHoldAction,
} from "@/domains/smart-devices/actions";
import { BulkRefreshDialog } from "@/domains/smart-devices/components/BulkRefreshDialog";
import { LockAutoRefresh } from "@/domains/smart-devices/components/LockAutoRefresh";
import { LockControlKillSwitch } from "@/domains/smart-devices/components/LockControlKillSwitch";
import { LockHealthPanel } from "@/domains/smart-devices/components/LockHealthPanel";
import { LockVerificationTracker } from "@/domains/smart-devices/components/LockVerificationTracker";
import { LocksList } from "@/domains/smart-devices/components/LocksList";
import {
  LocksTabs,
  parseLocksTab,
} from "@/domains/smart-devices/components/LocksTabs";
import { RefreshLocksButton } from "@/domains/smart-devices/components/RefreshLocksButton";
import { UnmappedAugustDevicesPanel } from "@/domains/smart-devices/components/UnmappedAugustDevicesPanel";
import { countLocksNeedingAttention } from "@/domains/smart-devices/lib/lock-daily-report";
import {
  classifyLockHealth,
  getLockHealthSnapshot,
  OPERATIONAL_HOLD_LABELS,
} from "@/domains/smart-devices/lib/lock-health";
import {
  deriveLockCondition,
  deriveLockVerification,
  describeDoorCondition,
  type LockVerificationRow,
} from "@/domains/smart-devices/lib/lock-verification";
import { buildVerificationTrackerRow } from "@/domains/smart-devices/lib/lock-verification-tracker";
import {
  describeRemoteControlAvailability,
  REMOTE_CONTROL_AVAILABILITY_LABELS,
} from "@/domains/smart-devices/lib/remote-control-availability";
import {
  computeFirstTestEligibility,
  computeLockControlEligibility,
  getAugustLockVerificationHistory,
  getLatestAugustLockCommandOutcomes,
  isAdminResetAvailable,
} from "@/domains/smart-devices/services/august-commands.service";
import { getLockControlSetting } from "@/domains/smart-devices/services/lock-control-settings.service";
import { getRecentUnknownTransitionCounts } from "@/domains/smart-devices/services/lock-health.service";
import { getActiveOperationalHolds } from "@/domains/smart-devices/services/lock-operational-hold.service";
import { getAugustRefreshFreshness } from "@/domains/smart-devices/services/lock-refresh.service";
import { getLockVerificationEvidence } from "@/domains/smart-devices/services/lock-verification-evidence.service";
import {
  getBatteryLevel,
  isDemoSmartDevice,
  isLockVisible,
  listSmartDevices,
} from "@/domains/smart-devices/services/smart-devices.service";
import { listUnmappedAugustDevices } from "@/domains/smart-devices/services/unmapped-august-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Explicit hosting function limit (seconds) for this route, which also hosts
 * the lock-command server action (sendAugustLockCommandAction). The command
 * path's own time budget (COMMAND_TIME_BUDGET_MS = 45s, august-commands.service.ts)
 * is sized to finish well inside this. 60 is valid on every Vercel plan,
 * with or without Fluid compute.
 */
export const maxDuration = 60;

/**
 * /locks has three tabs (2026-09-30, three-way separation), each its own
 * server render at `?tab=…`: Fleet Status (default) — current state and
 * controls; Daily Lock Report — the accepted report, unchanged; and
 * Remote-Control Verification — historical evidence. All three read the
 * same data below, so their numbers can't drift apart.
 */
export default async function LocksPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string | string[] }>;
}) {
  const tab = parseLocksTab((await searchParams).tab);
  const actor = await getCurrentUser();
  const devices = await listSmartDevices(actor);
  // isLockVisible() is the one centralized rule for this normal operational
  // view (2026-09-23, item C) — an explicitly-retired August lock (see
  // retireSmartDevice()) is excluded here, and only here; its SmartDevice
  // row, ProviderDevice row (if any), and full AuditLog history are all
  // still fully intact in the database, untouched by this filter.
  const locks = devices.filter(
    (d) => d.deviceType === "LOCK" && isLockVisible(d),
  );

  // UX-side eligibility filter for the bulk panel's checklist only —
  // refreshAugustTelemetryForSelectedLocks() re-checks provider/deviceType/
  // demo itself for every id regardless of what this list contains, so this
  // narrows what an operator sees to what could ever succeed, it doesn't
  // relax or replace the real enforcement.
  const eligibleAugustLocks = locks
    .filter((lock) => lock.provider === "AUGUST" && !isDemoSmartDevice(lock))
    .map((lock) => ({
      id: lock.id,
      propertyName: lock.property.name,
      name: lock.name,
      // Same field LocksList's own "Last synced" column already renders
      // (lock.updatedAt) — reused as-is, no second query.
      lastSyncedAt: lock.updatedAt,
    }));

  // Global (not property-scoped) — refreshAugustTelemetry()/refreshAugustAction
  // both still call assertPermission(actor, "smart_devices:update") themselves,
  // so this check is UX-only: it stops a read-only user from ever seeing a
  // button that would just fail with "ForbiddenError" on click, it doesn't
  // relax or replace the real server-side enforcement. Same pattern as
  // /thermostats' canRefresh.
  const canRefresh = await hasPermission(actor, "smart_devices:update");
  // Deliberately separate from canRefresh above — see LocksList's own doc
  // comment on canControlLocks for why. sendAugustLockCommand itself
  // re-checks locks:manage server-side regardless of what this decides.
  const canControlLocks = await hasPermission(actor, "locks:manage");

  // Global kill switch — shown to everyone who can see /locks; only an admin
  // (global locks:manage) can toggle it.
  const lockControl = await getLockControlSetting(actor);

  // Refresh-on-view (2026-09-27): read-only freshness for "Updated X min
  // ago". The render never starts a refresh; LockAutoRefresh asks the
  // gated /api/locks/refresh-if-stale endpoint after the page loads.
  const refreshFreshness = await getAugustRefreshFreshness(actor);

  // Fully dynamic per-lock eligibility (2026-09-25, "enable all locks"):
  // mapped + enabled + ONLINE + verified history + kill switch ON. No env
  // allowlist and nothing per-lock hard-coded. UX only — sendAugustLockCommand()
  // re-checks all of it server-side with a fresh August read.
  const augustLockIds = locks
    .filter((lock) => lock.provider === "AUGUST")
    .map((lock) => lock.id);
  // Read for every viewer (smart_devices:read): the lock-health list shows
  // command blocks and admin holds to everyone, not only to admins.
  const lastCommandOutcomes = await getLatestAugustLockCommandOutcomes(
    actor,
    augustLockIds,
  );
  const operationalHolds = await getActiveOperationalHolds(
    actor,
    augustLockIds,
  );
  // Historical verification (display-only, 2026-09-29): first SUCCEEDED
  // command per lock. Never used for eligibility below.
  const verificationHistory = await getAugustLockVerificationHistory(
    actor,
    augustLockIds,
  );
  const locksWithEligibility = locks.map((lock) => {
    const mapping = lock.providerDevice;
    // Mirrors sendAugustLockCommand()'s own mapping check exactly.
    const externalDeviceId =
      mapping?.enabled && mapping.propertyId ? mapping.externalDeviceId : null;
    const lastOutcome = lastCommandOutcomes.get(lock.id);
    const isAugust = lock.provider === "AUGUST" && canControlLocks;
    const hold = operationalHolds.get(lock.id) ?? null;
    const ctx = {
      externalDeviceId,
      connectivity: lock.status,
      lastOutcome,
      lockControlEnabled: lockControl.enabled,
      operationalHold: hold
        ? { label: OPERATIONAL_HOLD_LABELS[hold.kind], note: hold.note }
        : null,
    };
    // Shown to every viewer (2026-09-30); same rule as the eligibility
    // below, display-only. The controls themselves stay locks:manage-only.
    const availability =
      lock.provider === "AUGUST"
        ? describeRemoteControlAvailability(ctx)
        : null;
    return {
      ...lock,
      remoteControlCode: availability,
      remoteControl: availability
        ? {
            available: availability === "AVAILABLE",
            label: REMOTE_CONTROL_AVAILABILITY_LABELS[availability],
          }
        : null,
      controlEligibility: isAugust ? computeLockControlEligibility(ctx) : null,
      firstTestEligibility: isAugust ? computeFirstTestEligibility(ctx) : null,
      adminResetAvailable: isAugust && isAdminResetAvailable(lastOutcome),
      operationalHoldLabel: hold ? OPERATIONAL_HOLD_LABELS[hold.kind] : null,
    };
  });

  // Lock-health "needs attention" (2026-09-25): deterministic flags from the
  // stored read-only refresh snapshot. Real August locks only (no demo rows).
  const healthLocks = locks.filter(
    (lock) => lock.provider === "AUGUST" && !isDemoSmartDevice(lock),
  );
  const unknownCounts = await getRecentUnknownTransitionCounts(
    actor,
    healthLocks.map((lock) => lock.id),
  );
  const healthNow = new Date();
  const lockHealthRows = healthLocks.map((lock) => ({
    smartDeviceId: lock.id,
    propertyName: lock.property.name,
    lockName: lock.name,
    flags: classifyLockHealth({
      metadata: lock.metadata,
      connectivity: lock.status,
      now: healthNow,
      recentUnknownTransitions: unknownCounts.get(lock.id) ?? 0,
      lastCommandOutcome: lastCommandOutcomes.get(lock.id) ?? null,
      operationalHold: operationalHolds.get(lock.id) ?? null,
    }),
  }));

  // Ops verification visibility (2026-09-29): verification history and
  // current condition as two separate axes, from data already loaded above.
  const verificationRows: LockVerificationRow[] = healthLocks.map((lock, i) => {
    const hold = operationalHolds.get(lock.id) ?? null;
    return {
      smartDeviceId: lock.id,
      propertyName: lock.property.name,
      lockName: lock.name,
      verification: deriveLockVerification({
        firstVerifiedAt:
          verificationHistory.get(lock.id)?.firstVerifiedAt ?? null,
        operationalHold: hold,
      }),
      condition: deriveLockCondition({
        flags: lockHealthRows[i]!.flags,
        operationalHold: hold,
        lastCommandOutcome: lastCommandOutcomes.get(lock.id) ?? null,
      }),
      connectivity: lock.status,
      batteryLevel: getBatteryLevel(lock),
      doorCondition: describeDoorCondition(
        getLockHealthSnapshot(lock.metadata)?.doorState,
      ),
    };
  });

  // Remote-Control Verification (2026-09-30): per-step evidence from the
  // append-only AuditLog (StayWhile commands + Ops evidence). Read-only.
  const evidence = await getLockVerificationEvidence(
    actor,
    healthLocks.map((lock) => lock.id),
  );
  const trackerRows = verificationRows.map((base, i) => {
    const lock = healthLocks[i]!;
    const withEligibility = locksWithEligibility.find((l) => l.id === lock.id)!;
    const mapping = lock.providerDevice;
    return buildVerificationTrackerRow({
      base,
      firstVerifiedAt:
        verificationHistory.get(lock.id)?.firstVerifiedAt ?? null,
      operationalHold: operationalHolds.get(lock.id) ?? null,
      lastCommandOutcome: lastCommandOutcomes.get(lock.id) ?? null,
      mapped: Boolean(mapping?.enabled && mapping.propertyId),
      lockState: getLockHealthSnapshot(lock.metadata)?.lockState ?? "unknown",
      commands: evidence.get(lock.id)?.commands ?? [],
      ops: evidence.get(lock.id)?.ops ?? [],
      availability: withEligibility.remoteControlCode ?? "NOT_MAPPED",
    });
  });
  const trackerById = new Map(trackerRows.map((r) => [r.smartDeviceId, r]));
  const flagsById = new Map(
    lockHealthRows.map((r) => [r.smartDeviceId, r.flags]),
  );

  // Fleet Status rows: the verification badge is the tracker's overall
  // status, and badges/metrics use the report's own classifier flags.
  const fleetRows = locksWithEligibility.map((lock) => ({
    ...lock,
    healthFlags: flagsById.get(lock.id) ?? null,
    verificationStatus:
      lock.provider === "AUGUST"
        ? (trackerById.get(lock.id)?.verification.status ??
          deriveLockVerification({
            firstVerifiedAt:
              verificationHistory.get(lock.id)?.firstVerifiedAt ?? null,
            operationalHold: operationalHolds.get(lock.id) ?? null,
            lastCommandOutcome: lastCommandOutcomes.get(lock.id) ?? null,
          }).status)
        : null,
  }));

  const unmapped =
    tab === "fleet" ? await listUnmappedAugustDevices(actor) : null;
  const needsAttentionCount = countLocksNeedingAttention(lockHealthRows);

  return (
    <div>
      {/* 2026-09-18 UI cleanup: Refresh all / Bulk refresh now live in the
          header's actions slot instead of the page body — the bulk-refresh
          checklist (up to 42 rows) no longer permanently occupies page
          space; it only appears inside BulkRefreshDialog's modal, opened on
          demand. No functional change to either refresh path. */}
      <PageHeader
        title="Locks"
        subtitle="Monitor and manage connected property locks."
        actions={
          <>
            {canRefresh && <RefreshLocksButton action={refreshAugustAction} />}
            {canRefresh && eligibleAugustLocks.length > 0 && (
              <BulkRefreshDialog
                rows={eligibleAugustLocks}
                action={refreshAugustTelemetryBatchAction}
              />
            )}
          </>
        }
      />
      <div className="mb-3">
        <LockAutoRefresh
          initialLastSucceededAt={refreshFreshness.lastSucceededAt}
          initialCooldownUntil={refreshFreshness.cooldownUntil}
        />
      </div>
      <div className="mb-4">
        <LocksTabs active={tab} counts={{ report: needsAttentionCount }} />
      </div>

      {tab === "fleet" && (
        <>
          <div className="mb-4">
            <LockControlKillSwitch
              enabled={lockControl.enabled}
              canToggle={canControlLocks}
              action={setLockControlEnabledAction}
            />
          </div>
          <LocksList
            locks={fleetRows}
            needsAttentionCount={needsAttentionCount}
            canRefresh={canRefresh}
            spotRefreshAction={refreshAugustTelemetrySpotAction}
            canControlLocks={canControlLocks}
            lockCommandAction={sendAugustLockCommandAction}
            retireAction={retireSmartDeviceAction}
            resetAction={resetAugustLockAction}
            holdActions={{
              set: setLockOperationalHoldAction,
              clear: clearLockOperationalHoldAction,
            }}
          />
          {unmapped && (
            <div className="mt-6">
              <UnmappedAugustDevicesPanel
                devices={unmapped.devices}
                retiredCount={unmapped.retiredCount}
              />
            </div>
          )}
        </>
      )}

      {tab === "report" && (
        <LockHealthPanel rows={lockHealthRows} now={healthNow.toISOString()} />
      )}

      {tab === "verification" && (
        <LockVerificationTracker
          rows={trackerRows}
          generatedAt={healthNow.toISOString()}
          recordAction={
            canControlLocks ? recordLockVerificationEvidenceAction : undefined
          }
        />
      )}
    </div>
  );
}
