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
} from "@stayw/ui";
import { BatteryLow, Lock, WifiOff } from "lucide-react";

import {
  getBatteryLevel,
  isDemoSmartDevice,
  isLowBattery,
  type SmartDevice,
} from "../services/smart-devices.service";

type LockWithProperty = SmartDevice & { property: { name: string } };

function formatLastSynced(date: Date | null): string {
  return date ? new Date(date).toLocaleString() : "—";
}

export function LocksList({ locks }: { locks: LockWithProperty[] }) {
  const total = locks.length;
  const online = locks.filter((l) => l.status === "ONLINE").length;
  const offline = total - online;
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
      <MetricStrip xlColumns={4}>
        <Metric label="Total locks" value={total} icon={Lock} />
        <Metric label="Online" value={online} icon={Lock} />
        <Metric
          label="Offline"
          value={offline}
          icon={WifiOff}
          hint={offline > 0 ? "Needs attention" : undefined}
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
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Battery</TableHeaderCell>
          <TableHeaderCell>Warnings</TableHeaderCell>
          <TableHeaderCell>Provider</TableHeaderCell>
          <TableHeaderCell>Last synced</TableHeaderCell>
        </TableHead>
        <TableBody>
          {locks.map((lock) => {
            const offlineFlag = lock.status !== "ONLINE";
            const lowBatteryFlag = isLowBattery(lock);
            const battery = getBatteryLevel(lock);
            const demo = isDemoSmartDevice(lock);

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
                    label={lock.status === "ONLINE" ? "Online" : "Offline"}
                    tone={lock.status === "ONLINE" ? "success" : "error"}
                  />
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
                    {!offlineFlag && lowBatteryFlag && (
                      <Badge tone="warning">Low battery ({battery}%)</Badge>
                    )}
                    {!offlineFlag && !lowBatteryFlag && (
                      <Badge tone="success">Healthy</Badge>
                    )}
                  </span>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {lock.provider === "AUGUST" ? "August" : lock.provider}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatLastSynced(lock.lastSeenAt)}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
