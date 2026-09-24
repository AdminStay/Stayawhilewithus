import { hasPermission } from "@stayw/auth";
import { PageHeader } from "@stayw/ui";

import {
  refreshAugustAction,
  refreshAugustTelemetryBatchAction,
  refreshAugustTelemetrySpotAction,
  retireSmartDeviceAction,
  sendAugustLockCommandAction,
} from "@/domains/smart-devices/actions";
import { BulkRefreshDialog } from "@/domains/smart-devices/components/BulkRefreshDialog";
import { LocksList } from "@/domains/smart-devices/components/LocksList";
import { RefreshLocksButton } from "@/domains/smart-devices/components/RefreshLocksButton";
import {
  computeFirstTestEligibility,
  computeLockControlEligibility,
  getLatestAugustLockCommandOutcomes,
} from "@/domains/smart-devices/services/august-commands.service";
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

  // Real per-lock eligibility for the Lock/Unlock controls — never "mapped
  // + enabled alone" (see computeLockControlEligibility's own doc comment).
  // Only computed when canControlLocks is true: nobody who can't see the
  // buttons at all needs this, and getLatestAugustLockCommandOutcomes()
  // still independently checks smart_devices:read regardless.
  const augustLockIds = locks
    .filter((lock) => lock.provider === "AUGUST")
    .map((lock) => lock.id);
  const lastCommandOutcomes = canControlLocks
    ? await getLatestAugustLockCommandOutcomes(actor, augustLockIds)
    : new Map();
  const locksWithEligibility = locks.map((lock) => {
    const externalDeviceId = lock.providerDevice?.externalDeviceId ?? null;
    const lastOutcome = lastCommandOutcomes.get(lock.id);
    const isAugust = lock.provider === "AUGUST" && canControlLocks;
    return {
      ...lock,
      controlEligibility: isAugust
        ? computeLockControlEligibility(externalDeviceId, lastOutcome)
        : null,
      // Real per-lock "Test controllability" eligibility (2026-09-24) — the
      // narrowly-scoped first-verification workflow. See
      // computeFirstTestEligibility's own doc comment for why this is a
      // separate function from computeLockControlEligibility above, not a
      // relaxed version of it: this one deliberately never reads the real
      // AUGUST_LOCK_COMMAND_TEST_DEVICE_IDS allowlist, so its true/false
      // value can never let a viewer infer which devices are allowlisted.
      firstTestEligibility: isAugust
        ? computeFirstTestEligibility(externalDeviceId, lastOutcome)
        : null,
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
      <LocksList
        locks={locksWithEligibility}
        canRefresh={canRefresh}
        spotRefreshAction={refreshAugustTelemetrySpotAction}
        canControlLocks={canControlLocks}
        lockCommandAction={sendAugustLockCommandAction}
        retireAction={retireSmartDeviceAction}
      />
    </div>
  );
}
