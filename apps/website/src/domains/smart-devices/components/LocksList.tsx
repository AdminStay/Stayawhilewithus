import {
  Badge,
  ConfirmButton,
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
  ResetAugustLockActionState,
} from "../actions";
import { formatTimestamp } from "../lib/format-timestamp";
import type {
  FirstTestEligibility,
  LockControlEligibility,
} from "../services/august-commands.service";
import {
  getBatteryLevel,
  getLockState,
  getTelemetryUpdatedAt,
  isDemoSmartDevice,
  isLowBattery,
  isTelemetryStale,
  type SmartDevice,
} from "../services/smart-devices.service";

import { AdminResetLockButton } from "./AdminResetLockButton";
import { AugustFirstTestButton } from "./AugustFirstTestButton";
import { AugustLockControlButton } from "./AugustLockControlButton";
import { LockSpotRefreshButton } from "./LockSpotRefreshButton";
import { RelockPrompt } from "./RelockPrompt";

type LockWithProperty = SmartDevice & {
  property: { name: string };
  /** Real per-lock Lock/Unlock eligibility (see computeLockControlEligibility) — null for a non-August device, or when the viewer can't control locks at all (canControlLocks is false, so it's never rendered anyway). */
  controlEligibility: LockControlEligibility | null;
  /** Real per-lock "Test controllability" eligibility (see computeFirstTestEligibility) — null under the same conditions as controlEligibility above. Mutually exclusive with controlEligibility.eligible by construction: a device is never eligible for both at once. */
  firstTestEligibility: FirstTestEligibility | null;
  /** True when the lock is blocked by a FAILED/AMBIGUOUS outcome, so an admin may reset it after an in-person check. */
  adminResetAvailable: boolean;
};

/**
 * Short label for the compact Status dot (2026-09-18 /locks UI cleanup) —
 * deliberately terser than the old CONNECTIVITY_LABEL's "Connectivity not
 * reported" for UNKNOWN: this is now a scannable dot+word, not a sentence.
 * Nothing here changes what UNKNOWN means: never a confirmed-offline
 * signal, only "the provider gave no reliable connectivity read this
 * time." (2026-09-23, item A) — the Sep 18 cleanup's own comment claimed a
 * "secondary badge/title" already carried the full explanation, but no
 * such affordance actually existed; AUGUST_UNKNOWN_CONNECTIVITY_EXPLANATION
 * below, rendered as a hover title on the Status cell, is that promised
 * explanation, now real.
 */
const CONNECTIVITY_LABEL: Record<LockWithProperty["status"], string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Unknown",
  ERROR: "Error",
};

/**
 * Hover-title text for UNKNOWN connectivity, August locks only (2026-09-23,
 * item A) — Michelle's report that "most locks show Unknown" traced to a
 * real provider fact, not a bug: deriveConnectivity() (august/client.ts)
 * correctly returns UNKNOWN whenever August's API omits the `Bridge` object
 * entirely, which a live fleet audit found several real lock hardware/
 * firmware generations simply never send — while still reporting battery
 * telemetry. UNKNOWN is the deliberately honest result of that, not a
 * defect to hide. This copy exists so an operator hovering "Unknown"
 * understands why, without this file (or anyone reading it) claiming any
 * of the things that would NOT be true: that the lock is offline, broken,
 * missing its bridge as a diagnosis, a specific hardware generation, or
 * that it can't be remotely controlled — Lock/Unlock eligibility
 * (computeLockControlEligibility, item E) is entirely independent of this
 * connectivity read.
 */
const AUGUST_UNKNOWN_CONNECTIVITY_EXPLANATION =
  "August isn't reporting live status for this lock (no WiFi bridge connection is reported for it), so its online status and lock state are unknown and it can't be controlled remotely.";

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
  retireAction,
  resetAction,
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
   * since this one is scoped to `locks:manage`. The real enforcement
   * (kill switch, online check, verified history) lives entirely in
   * sendAugustLockCommand — this flag only decides whether the button
   * renders at all for an operator who could never succeed anyway.
   */
  canControlLocks?: boolean;
  lockCommandAction?: (
    prevState: AugustLockCommandActionState,
    formData: FormData,
  ) => Promise<AugustLockCommandActionState>;
  /**
   * "Retire this lock" (2026-09-23, item C) — gated on `canRefresh`
   * (`smart_devices:update`), the same permission retireSmartDevice()
   * itself requires; deliberately reuses that flag rather than adding a
   * third one, since retirement is a monitoring/mapping-adjacent action,
   * never a physical command. Rendered only when both this prop and
   * `canRefresh` are true — never rendered at all when absent, same
   * "action prop presence gates the button" convention as
   * spotRefreshAction/lockCommandAction above.
   */
  retireAction?: (formData: FormData) => void | Promise<void>;
  /** Admin "reset after physical check" — shown only with canControlLocks, for a lock whose adminResetAvailable is true. */
  resetAction?: (
    prevState: ResetAugustLockActionState,
    formData: FormData,
  ) => Promise<ResetAugustLockActionState>;
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
            (canControlLocks && lockCommandAction) ||
            (canRefresh && retireAction)) && (
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
                    <span
                      className="inline-flex items-center gap-1"
                      title={
                        isAugust && lock.status === "UNKNOWN"
                          ? AUGUST_UNKNOWN_CONNECTIVITY_EXPLANATION
                          : undefined
                      }
                    >
                      <StatusIndicator
                        label={CONNECTIVITY_LABEL[lock.status]}
                        tone={CONNECTIVITY_TONE[lock.status]}
                      />
                      {isAugust && lock.status === "UNKNOWN" && (
                        <HelpCircle className="h-3 w-3 shrink-0 text-ink-faint" />
                      )}
                    </span>
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
                  (canControlLocks && lockCommandAction) ||
                  (canRefresh && retireAction)) && (
                  <TableCell>
                    {isAugust ? (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                          {canControlLocks &&
                            lockCommandAction &&
                            (lock.firstTestEligibility?.eligible ? (
                              // Deliberately the ONLY control shown for a
                              // not-yet-verified device — never alongside
                              // the disabled routine Lock/Unlock buttons,
                              // so this never looks like ordinary control.
                              <AugustFirstTestButton
                                smartDeviceId={lock.id}
                                lockName={lock.name}
                                propertyName={lock.property.name}
                                currentLockState={lockState}
                                action={lockCommandAction}
                              />
                            ) : (
                              <>
                                <AugustLockControlButton
                                  smartDeviceId={lock.id}
                                  operation="LOCK"
                                  lockName={lock.name}
                                  propertyName={lock.property.name}
                                  action={lockCommandAction}
                                  disabled={!lock.controlEligibility?.eligible}
                                  disabledReason={
                                    lock.controlEligibility?.reason ?? undefined
                                  }
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
                                  disabled={!lock.controlEligibility?.eligible}
                                  disabledReason={
                                    lock.controlEligibility?.reason ?? undefined
                                  }
                                  emphasis={
                                    normalizedLockState === "unlocked"
                                      ? "subdued"
                                      : "primary"
                                  }
                                />
                              </>
                            ))}
                          {canControlLocks &&
                            resetAction &&
                            lock.adminResetAvailable && (
                              <AdminResetLockButton
                                smartDeviceId={lock.id}
                                lockName={lock.name}
                                propertyName={lock.property.name}
                                action={resetAction}
                              />
                            )}
                          {canRefresh && spotRefreshAction && (
                            <LockSpotRefreshButton
                              smartDeviceId={lock.id}
                              action={spotRefreshAction}
                            />
                          )}
                          {canRefresh && retireAction && (
                            <form action={retireAction}>
                              <input
                                type="hidden"
                                name="smartDeviceId"
                                value={lock.id}
                              />
                              <ConfirmButton
                                type="submit"
                                size="sm"
                                variant="secondary"
                                confirmMessage={`Retire "${lock.name}" at ${lock.property.name}? This removes it from the normal Locks view. It does NOT delete any historical record, and does NOT send any command to the physical lock.`}
                              >
                                Retire
                              </ConfirmButton>
                            </form>
                          )}
                        </div>
                        {canControlLocks &&
                          lockCommandAction &&
                          lock.controlEligibility?.eligible &&
                          normalizedLockState === "unlocked" && (
                            <RelockPrompt
                              variant="row"
                              smartDeviceId={lock.id}
                              action={lockCommandAction}
                            />
                          )}
                        {canControlLocks &&
                          lockCommandAction &&
                          !lock.firstTestEligibility?.eligible &&
                          lock.controlEligibility &&
                          !lock.controlEligibility.eligible && (
                            <p className="text-[10px] text-ink-faint">
                              {lock.controlEligibility.reason}
                            </p>
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
