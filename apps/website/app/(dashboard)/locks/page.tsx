import { hasPermission } from "@stayw/auth";
import { PageHeader } from "@stayw/ui";

import {
  refreshAugustAction,
  refreshAugustTelemetryBatchAction,
  refreshAugustTelemetrySpotAction,
  clearLockOperationalHoldAction,
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
import { LockVerificationPanel } from "@/domains/smart-devices/components/LockVerificationPanel";
import { LocksList } from "@/domains/smart-devices/components/LocksList";
import { RefreshLocksButton } from "@/domains/smart-devices/components/RefreshLocksButton";
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
import {
  getBatteryLevel,
  isDemoSmartDevice,
  isLockVisible,
  listSmartDevices,
} from "@/domains/smart-devices/services/smart-devices.service";
import { getCurrentUser } from "@/platform/auth/get-current-user";

/**
 * Explicit hosting function limit (seconds) for this route, which also hosts
 * the lock-command server action (sendAugustLockCommandAction). The command
 * path's own time budget (COMMAND_TIME_BUDGET_MS = 45s, august-commands.service.ts)
 * is sized to finish well inside this. 60 is valid on every Vercel plan,
 * with or without Fluid compute.
 */
export const maxDuration = 60;

export default async function LocksPage() {
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
    return {
      ...lock,
      controlEligibility: isAugust ? computeLockControlEligibility(ctx) : null,
      firstTestEligibility: isAugust ? computeFirstTestEligibility(ctx) : null,
      adminResetAvailable: isAugust && isAdminResetAvailable(lastOutcome),
      operationalHoldLabel: hold ? OPERATIONAL_HOLD_LABELS[hold.kind] : null,
      verificationStatus:
        lock.provider === "AUGUST"
          ? deriveLockVerification({
              firstVerifiedAt:
                verificationHistory.get(lock.id)?.firstVerifiedAt ?? null,
              operationalHold: hold,
            }).status
          : null,
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
        <LockControlKillSwitch
          enabled={lockControl.enabled}
          canToggle={canControlLocks}
          action={setLockControlEnabledAction}
        />
      </div>
      <div className="mb-4">
        <LockHealthPanel rows={lockHealthRows} />
      </div>
      <div className="mb-4">
        <LockVerificationPanel
          rows={verificationRows}
          generatedAt={healthNow.toISOString()}
        />
      </div>
      <LocksList
        locks={locksWithEligibility}
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
    </div>
  );
}
