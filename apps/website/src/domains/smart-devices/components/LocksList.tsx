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
import { BatteryLow, HelpCircle, Lock, WifiOff } from "lucide-react";

import {
  getBatteryLevel,
  getLockState,
  getTelemetryUpdatedAt,
  isDemoSmartDevice,
  isLowBattery,
  isTelemetryStale,
  type SmartDevice,
} from "../services/smart-devices.service";

type LockWithProperty = SmartDevice & { property: { name: string } };

function formatTimestamp(date: Date | null): string {
  return date ? new Date(date).toLocaleString() : "—";
}

function formatLockState(state: string | null): string {
  if (!state) return "—";
  return state.charAt(0).toUpperCase() + state.slice(1);
}

const CONNECTIVITY_LABEL: Record<LockWithProperty["status"], string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Connectivity not reported",
  ERROR: "Error",
};

const CONNECTIVITY_TONE: Record<LockWithProperty["status"], Tone> = {
  ONLINE: "success",
  OFFLINE: "error",
  UNKNOWN: "neutral",
  ERROR: "error",
};

export function LocksList({ locks }: { locks: LockWithProperty[] }) {
  const total = locks.length;
  const online = locks.filter((l) => l.status === "ONLINE").length;
  const offline = locks.filter((l) => l.status === "OFFLINE").length;
  const unknown = locks.filter((l) => l.status === "UNKNOWN").length;
  const lowBatteryCount = locks.filter((l) => isLowBattery(l)).length;

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
      <MetricStrip xlColumns={5}>
        <Metric label="Total locks" value={total} icon={Lock} />
        <Metric label="Online" value={online} icon={Lock} />
        <Metric
          label="Offline"
          value={offline}
          icon={WifiOff}
          hint={offline > 0 ? "Needs attention" : undefined}
        />
        <Metric
          label="Unknown"
          value={unknown}
          icon={HelpCircle}
          hint={unknown > 0 ? "Connectivity not reported" : undefined}
        />
        <Metric
          label="Low battery"
          value={lowBatteryCount}
          icon={BatteryLow}
          hint={lowBatteryCount > 0 ? "Needs attention" : undefined}
        />
      </MetricStrip>

      <Table>
        <TableHead>
          <TableHeaderCell>Property</TableHeaderCell>
          <TableHeaderCell>Lock</TableHeaderCell>
          <TableHeaderCell>Connectivity</TableHeaderCell>
          <TableHeaderCell>Lock state</TableHeaderCell>
          <TableHeaderCell>Battery</TableHeaderCell>
          <TableHeaderCell>Warnings</TableHeaderCell>
          <TableHeaderCell>Provider</TableHeaderCell>
          <TableHeaderCell>Last synced</TableHeaderCell>
          <TableHeaderCell>Last telemetry</TableHeaderCell>
        </TableHead>
        <TableBody>
          {locks.map((lock) => {
            const offlineFlag = lock.status === "OFFLINE";
            const unknownFlag = lock.status === "UNKNOWN";
            const lowBatteryFlag = isLowBattery(lock);
            const staleFlag = isTelemetryStale(lock);
            const battery = getBatteryLevel(lock);
            const demo = isDemoSmartDevice(lock);
            const lockState = getLockState(lock);
            const telemetryUpdatedAt = getTelemetryUpdatedAt(lock);

            return (
              <TableRow key={lock.id}>
                <TableCell>
                  <span className="font-medium text-ink">
                    {lock.property.name}
                  </span>
                </TableCell>
                <TableCell className="text-ink-muted">{lock.name}</TableCell>
                <TableCell>
                  <StatusIndicator
                    label={CONNECTIVITY_LABEL[lock.status]}
                    tone={CONNECTIVITY_TONE[lock.status]}
                  />
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatLockState(lockState)}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {battery !== null ? `${battery}%` : "—"}
                </TableCell>
                <TableCell>
                  <span className="flex flex-wrap items-center gap-1.5">
                    {demo && <Badge tone="neutral">Demo data</Badge>}
                    {offlineFlag && lowBatteryFlag && (
                      <Badge tone="error">Offline + low battery</Badge>
                    )}
                    {offlineFlag && !lowBatteryFlag && (
                      <Badge tone="error">Offline</Badge>
                    )}
                    {!offlineFlag && staleFlag && lowBatteryFlag && (
                      <Badge tone="warning">
                        Telemetry stale + low battery ({battery}%)
                      </Badge>
                    )}
                    {!offlineFlag && staleFlag && !lowBatteryFlag && (
                      <Badge tone="warning">
                        Attention needed — telemetry stale
                      </Badge>
                    )}
                    {!offlineFlag && !staleFlag && unknownFlag && (
                      <Badge tone="neutral">Connectivity not reported</Badge>
                    )}
                    {!offlineFlag &&
                      !staleFlag &&
                      !unknownFlag &&
                      lowBatteryFlag && (
                        <Badge tone="warning">Low battery ({battery}%)</Badge>
                      )}
                    {!offlineFlag &&
                      !staleFlag &&
                      !unknownFlag &&
                      !lowBatteryFlag && <Badge tone="success">Healthy</Badge>}
                  </span>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {lock.provider === "AUGUST" ? "August" : lock.provider}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatTimestamp(lock.updatedAt)}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatTimestamp(telemetryUpdatedAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
