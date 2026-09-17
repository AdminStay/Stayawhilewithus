import {
  Badge,
  EmptyState,
  Metric,
  MetricStrip,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  type Tone,
} from "@stayw/ui";
import {
  Battery,
  BatteryWarning,
  HelpCircle,
  Lock,
  ShieldAlert,
  Unlock,
  WifiOff,
} from "lucide-react";

import type {
  AugustLockCommandActionState,
  RefreshAugustSpotActionState,
} from "../actions";
import { formatTimestamp } from "../lib/format-timestamp";
import {
  getBatteryLevel,
  getLockState,
  getTelemetryUpdatedAt,
  isDemoSmartDevice,
  isLowBattery,
  isTelemetryStale,
  type SmartDevice,
} from "../services/smart-devices.service";

import { AugustLockControlButton } from "./AugustLockControlButton";
import { LockSpotRefreshButton } from "./LockSpotRefreshButton";

type LockWithProperty = SmartDevice & { property: { name: string } };

/**
 * Short label for the compact Status dot (2026-09-18 /locks UI cleanup) —
 * deliberately terser than the old CONNECTIVITY_LABEL's "Connectivity not
 * reported" for UNKNOWN: this is now a scannable dot+word, not a sentence.
 * The full explanation still exists (see the "Unknown" secondary badge/
 * title below) — nothing here changes what UNKNOWN means: never a
 * confirmed-offline signal, only "the provider gave no reliable connectivity
 * read this time."
 */
const CONNECTIVITY_LABEL: Record<LockWithProperty["status"], string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Unknown",
  ERROR: "Error",
};

const CONNECTIVITY_TONE: Record<LockWithProperty["status"], Tone> = {
  ONLINE: "success",
  OFFLINE: "error",
  UNKNOWN: "neutral",
  ERROR: "error",
};

/**
 * Compact Lock State badge — icon + word, never a guess. `null`/anything
 * other than the two states August actually reports renders as "Unknown"
 * with a neutral tone and a help icon, matching this codebase's standing
 * "never fabricate a physical state" rule (see AugustLockDetail's own doc
 * comment in packages/integrations/src/august/types.ts).
 */
function LockStateBadge({ state }: { state: string | null }) {
  const normalized = state?.toLowerCase();
  if (normalized === "locked") {
    return (
      <Badge tone="success">
        <Lock className="h-3 w-3" />
        Locked
      </Badge>
    );
  }
  if (normalized === "unlocked") {
    return (
      <Badge tone="warning">
        <Unlock className="h-3 w-3" />
        Unlocked
      </Badge>
    );
  }
  return (
    <Badge tone="neutral">
      <HelpCircle className="h-3 w-3" />
      Unknown
    </Badge>
  );
}

/**
 * Compact battery indicator — icon + percentage, quiet when healthy so it
 * doesn't compete with the Status column for attention; only draws the eye
 * (warning icon + color) below LOW_BATTERY_THRESHOLD (20%, same threshold
 * getBatteryLevel()/isLowBattery() already use — not redefined here).
 */
function BatteryIndicator({ lock }: { lock: LockWithProperty }) {
  const level = getBatteryLevel(lock);
  if (level === null) {
    return <span className="text-ink-faint">—</span>;
  }
  const low = isLowBattery(lock);
  const Icon = low ? BatteryWarning : Battery;
  return (
    <span
      className={`inline-flex items-center gap-1.5 ${low ? "font-medium text-warning-600" : "text-ink-muted"}`}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      {level}%
    </span>
  );
}

export function LocksList({
  locks,
  canRefresh = false,
  spotRefreshAction,
  canControlLocks = false,
  lockCommandAction,
}: {
  locks: LockWithProperty[];
  /** UX-only gate, matching every other write-capable button in this domain — assertPermission inside the server action remains the real enforcement. */
  canRefresh?: boolean;
  spotRefreshAction?: (
    prevState: RefreshAugustSpotActionState,
    formData: FormData,
  ) => Promise<RefreshAugustSpotActionState>;
  /**
   * UX-only gate for the physical Lock/Unlock controls — deliberately
   * separate from `canRefresh` (`smart_devices:update`, monitoring/mapping)
   * since this one is scoped to `locks:manage`. The real enforcement,
   * including the Production test allowlist, lives entirely in
   * sendAugustLockCommand — this flag only decides whether the button
   * renders at all for an operator who could never succeed anyway.
   */
  canControlLocks?: boolean;
  lockCommandAction?: (
    prevState: AugustLockCommandActionState,
    formData: FormData,
  ) => Promise<AugustLockCommandActionState>;
}) {
  const total = locks.length;
  const online = locks.filter((l) => l.status === "ONLINE").length;
  const offline = locks.filter((l) => l.status === "OFFLINE").length;
  const unknown = locks.filter((l) => l.status === "UNKNOWN").length;
  const lowBatteryCount = locks.filter((l) => isLowBattery(l)).length;
  // Purely derived, never a separate stored flag — "needs a look" is any
  // lock that's confirmed offline, reporting stale telemetry, or low on
  // battery. UNKNOWN connectivity alone does NOT count — per the standing
  // rule, that's not evidence of a problem by itself.
  const needsAttentionCount = locks.filter(
    (l) => l.status === "OFFLINE" || isTelemetryStale(l) || isLowBattery(l),
  ).length;

  if (total === 0) {
    return (
      <EmptyState
        icon={Lock}
        title="No locks yet"
        description="August locks will appear here once synced to a property."
      />
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip xlColumns={6}>
        <Metric label="Locks" value={total} icon={Lock} />
        <Metric label="Online" value={online} icon={Lock} />
        <Metric label="Offline" value={offline} icon={WifiOff} />
        <Metric label="Unknown" value={unknown} icon={HelpCircle} />
        <Metric
          label="Low battery"
          value={lowBatteryCount}
          icon={BatteryWarning}
        />
        <Metric
          label="Needs attention"
          value={needsAttentionCount}
          icon={ShieldAlert}
          hint={
            needsAttentionCount > 0
              ? "Offline, stale, or low battery"
              : "All clear"
          }
        />
      </MetricStrip>

      <Table>
        <TableHead>
          <TableHeaderCell className="w-[26%]">Property / Lock</TableHeaderCell>
          <TableHeaderCell className="w-[16%]">Status</TableHeaderCell>
          <TableHeaderCell className="w-[12%]">Lock state</TableHeaderCell>
          <TableHeaderCell className="w-[10%]">Battery</TableHeaderCell>
          <TableHeaderCell className="w-[16%]">Last update</TableHeaderCell>
          {((canRefresh && spotRefreshAction) ||
            (canControlLocks && lockCommandAction)) && (
            <TableHeaderCell className="w-[20%]">Actions</TableHeaderCell>
          )}
        </TableHead>
        <TableBody>
          {locks.map((lock) => {
            const lowBatteryFlag = isLowBattery(lock);
            const staleFlag = isTelemetryStale(lock);
            const demo = isDemoSmartDevice(lock);
            const lockState = getLockState(lock);
            const normalizedLockState = lockState?.toLowerCase();
            const telemetryUpdatedAt = getTelemetryUpdatedAt(lock);
            const isAugust = lock.provider === "AUGUST";

            return (
              <TableRow key={lock.id}>
                <TableCell className="max-w-0">
                  <div className="flex flex-col">
                    <span className="truncate font-medium text-ink">
                      {lock.property.name}
                    </span>
                    <span className="truncate text-xs text-ink-muted">
                      {lock.name}
                    </span>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex flex-col gap-1">
                    <StatusIndicator
                      label={CONNECTIVITY_LABEL[lock.status]}
                      tone={CONNECTIVITY_TONE[lock.status]}
                    />
                    <div className="flex flex-wrap items-center gap-1">
                      {demo && (
                        <Badge tone="neutral" className="text-[10px]">
                          Demo data
                        </Badge>
                      )}
                      {staleFlag && (
                        <Badge tone="warning" className="text-[10px]">
                          Stale telemetry
                        </Badge>
                      )}
                      {lowBatteryFlag && (
                        <Badge tone="warning" className="text-[10px]">
                          Low battery
                        </Badge>
                      )}
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <LockStateBadge state={lockState} />
                </TableCell>

                <TableCell>
                  <BatteryIndicator lock={lock} />
                </TableCell>

                <TableCell>
                  <div
                    className="flex flex-col"
                    title={`Last synced: ${formatTimestamp(lock.updatedAt)}`}
                  >
                    <span className="text-ink-muted">
                      {formatTimestamp(telemetryUpdatedAt)}
                    </span>
                    <span className="text-xs text-ink-faint">
                      Synced {formatTimestamp(lock.updatedAt)}
                    </span>
                  </div>
                </TableCell>

                {((canRefresh && spotRefreshAction) ||
                  (canControlLocks && lockCommandAction)) && (
                  <TableCell>
                    {isAugust ? (
                      <div className="flex flex-wrap items-center gap-2">
                        {canControlLocks && lockCommandAction && (
                          <>
                            <AugustLockControlButton
                              smartDeviceId={lock.id}
                              operation="LOCK"
                              lockName={lock.name}
                              propertyName={lock.property.name}
                              action={lockCommandAction}
                              emphasis={
                                normalizedLockState === "locked"
                                  ? "subdued"
                                  : "primary"
                              }
                            />
                            <AugustLockControlButton
                              smartDeviceId={lock.id}
                              operation="UNLOCK"
                              lockName={lock.name}
                              propertyName={lock.property.name}
                              action={lockCommandAction}
                              emphasis={
                                normalizedLockState === "unlocked"
                                  ? "subdued"
                                  : "primary"
                              }
                            />
                          </>
                        )}
                        {canRefresh && spotRefreshAction && (
                          <LockSpotRefreshButton
                            smartDeviceId={lock.id}
                            action={spotRefreshAction}
                          />
                        )}
                      </div>
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                )}
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
