import { hasPermission } from "@stayw/auth";
import { PageHeader } from "@stayw/ui";

import {
  refreshAugustAction,
  refreshAugustTelemetryBatchAction,
  refreshAugustTelemetrySpotAction,
  resetAugustLockAction,
  retireSmartDeviceAction,
  sendAugustLockCommandAction,
  setLockControlEnabledAction,
} from "@/domains/smart-devices/actions";
import { BulkRefreshDialog } from "@/domains/smart-devices/components/BulkRefreshDialog";
import { LockControlKillSwitch } from "@/domains/smart-devices/components/LockControlKillSwitch";
import { LocksList } from "@/domains/smart-devices/components/LocksList";
import { RefreshLocksButton } from "@/domains/smart-devices/components/RefreshLocksButton";
import {
  computeFirstTestEligibility,
  computeLockControlEligibility,
  getLatestAugustLockCommandOutcomes,
  isAdminResetAvailable,
} from "@/domains/smart-devices/services/august-commands.service";
import { getLockControlSetting } from "@/domains/smart-devices/services/lock-control-settings.service";
import {
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

  // Fully dynamic per-lock eligibility (2026-09-25, "enable all locks"):
  // mapped + enabled + ONLINE + verified history + kill switch ON. No env
  // allowlist and nothing per-lock hard-coded. UX only — sendAugustLockCommand()
  // re-checks all of it server-side with a fresh August read.
  const augustLockIds = locks
    .filter((lock) => lock.provider === "AUGUST")
    .map((lock) => lock.id);
  const lastCommandOutcomes = canControlLocks
    ? await getLatestAugustLockCommandOutcomes(actor, augustLockIds)
    : new Map();
  const locksWithEligibility = locks.map((lock) => {
    const mapping = lock.providerDevice;
    // Mirrors sendAugustLockCommand()'s own mapping check exactly.
    const externalDeviceId =
      mapping?.enabled && mapping.propertyId ? mapping.externalDeviceId : null;
    const lastOutcome = lastCommandOutcomes.get(lock.id);
    const isAugust = lock.provider === "AUGUST" && canControlLocks;
    const ctx = {
      externalDeviceId,
      connectivity: lock.status,
      lastOutcome,
      lockControlEnabled: lockControl.enabled,
    };
    return {
      ...lock,
      controlEligibility: isAugust ? computeLockControlEligibility(ctx) : null,
      firstTestEligibility: isAugust ? computeFirstTestEligibility(ctx) : null,
      adminResetAvailable: isAugust && isAdminResetAvailable(lastOutcome),
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
      <div className="mb-4">
        <LockControlKillSwitch
          enabled={lockControl.enabled}
          canToggle={canControlLocks}
          action={setLockControlEnabledAction}
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
      />
    </div>
  );
}
