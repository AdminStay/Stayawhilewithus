import {
  Badge,
  Card,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Unplug } from "lucide-react";

import { formatTimestamp } from "../lib/format-timestamp";
import { LOCK_HEALTH_THRESHOLDS } from "../lib/lock-health";
import {
  UNMAPPED_MAPPING_STATUS_LABELS,
  type UnmappedAugustDevice,
} from "../lib/unmapped-august-devices";

const CONNECTIVITY_TEXT: Record<string, string> = {
  ONLINE: "Online",
  OFFLINE: "Offline",
  UNKNOWN: "Connectivity unknown",
  ERROR: "Error",
};

const when = (iso: string | null) =>
  iso ? formatTimestamp(new Date(iso)) : "—";

/**
 * Read-only list of discovered August locks that are not on Fleet Status
 * (2026-09-30), e.g. MJ Side Door. No controls and no mapping action here:
 * mapping stays an explicit admin step in Discovered Devices. Readings come
 * from the last Discovery run, not the regular lock refresh.
 */
export function UnmappedAugustDevicesPanel({
  devices,
  retiredCount,
}: {
  devices: UnmappedAugustDevice[];
  retiredCount: number;
}) {
  return (
    <Card>
      <div className="flex items-center gap-2">
        <Unplug className="h-4 w-4 text-ink-muted" />
        <h2 className="text-sm font-semibold text-ink">
          Unmapped August devices ({devices.length})
        </h2>
      </div>
      <p className="mt-1 text-xs text-ink-muted">
        August locks StayWhile has discovered but that aren&apos;t on Fleet
        Status. Read-only: they have no controls and aren&apos;t in the lock
        counts or the daily report. Readings are from the last Discovery run.
        {retiredCount > 0 &&
          ` ${retiredCount} retired device${retiredCount > 1 ? "s are" : " is"} not shown.`}
      </p>
      {devices.length === 0 ? (
        <p className="mt-3 text-xs text-ink-faint">
          Every discovered August lock is on Fleet Status.
        </p>
      ) : (
        <div className="mt-3 overflow-x-auto">
          <Table>
            <TableHead>
              <TableHeaderCell>August device</TableHeaderCell>
              <TableHeaderCell>Mapping</TableHeaderCell>
              <TableHeaderCell>Connectivity</TableHeaderCell>
              <TableHeaderCell>Battery</TableHeaderCell>
              <TableHeaderCell>Reported / seen</TableHeaderCell>
            </TableHead>
            <TableBody>
              {devices.map((d) => (
                <TableRow key={d.providerDeviceId}>
                  <TableCell className="font-medium text-ink">
                    {d.name}
                  </TableCell>
                  <TableCell>
                    <Badge tone="neutral" className="text-[10px]">
                      {UNMAPPED_MAPPING_STATUS_LABELS[d.mappingStatus]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-xs text-ink-muted">
                    {CONNECTIVITY_TEXT[d.connectivity] ??
                      "Connectivity unknown"}
                  </TableCell>
                  <TableCell className="text-xs">
                    {d.batteryLevel === null ? (
                      <span className="text-ink-faint">—</span>
                    ) : (
                      <span
                        className={
                          d.batteryLevel <
                          LOCK_HEALTH_THRESHOLDS.batteryWarningPercent
                            ? "font-medium text-warning-600"
                            : "text-ink-muted"
                        }
                      >
                        {d.batteryLevel}%
                      </span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-col text-xs text-ink-muted">
                      <span>
                        <span className="text-ink-faint">
                          Status reported by August:{" "}
                        </span>
                        {when(d.statusReportedAt)}
                      </span>
                      <span>
                        <span className="text-ink-faint">
                          Battery reading time:{" "}
                        </span>
                        {when(d.batteryReadingAt)}
                      </span>
                      <span>
                        <span className="text-ink-faint">
                          Last seen by StayWhile (discovery):{" "}
                        </span>
                        {when(d.lastSeenAt)}
                      </span>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}
