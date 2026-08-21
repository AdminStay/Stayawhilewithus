import {
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
import { Thermometer, WifiOff } from "lucide-react";

import {
  canRenderNestControls,
  getCurrentTemperature,
  getHumidity,
  getMode,
  getProviderDisplayName,
  getTargetTemperature,
  getTelemetryUpdatedAt,
  type SmartDevice,
} from "../services/smart-devices.service";

import { NestThermostatControls } from "./NestThermostatControls";

type ThermostatWithProperty = SmartDevice & {
  property: { name: string };
  providerDevice: {
    enabled: boolean;
    rawMetadata: unknown;
  } | null;
};

/**
 * providerDevice.rawMetadata is a generic Prisma Json value — this reads
 * only the already-sanitized rawTraits key NestClient/parseNestDevice
 * populated (see packages/integrations/src/nest/client.ts). Never used for
 * any non-Nest provider (their providerDevice relation is always null).
 */
function getRawTraits(
  thermostat: ThermostatWithProperty,
): Record<string, Record<string, unknown>> | null {
  if (thermostat.provider !== "NEST" || !thermostat.providerDevice?.enabled) {
    return null;
  }
  const rawMetadata = thermostat.providerDevice.rawMetadata;
  if (!rawMetadata || typeof rawMetadata !== "object") return null;
  const rawTraits = (rawMetadata as { rawTraits?: unknown }).rawTraits;
  return rawTraits && typeof rawTraits === "object"
    ? (rawTraits as Record<string, Record<string, unknown>>)
    : null;
}

function formatTimestamp(date: Date | null): string {
  return date ? new Date(date).toLocaleString() : "—";
}

function formatTemperature(value: number | null): string {
  return value !== null ? `${value}°` : "—";
}

export function ThermostatsList({
  thermostats,
  canManageByPropertyId,
}: {
  thermostats: ThermostatWithProperty[];
  /** Resolved server-side per property — see /thermostats/page.tsx. */
  canManageByPropertyId: Record<string, boolean>;
}) {
  const total = thermostats.length;
  const online = thermostats.filter((t) => t.status === "ONLINE").length;
  const offline = total - online;

  if (total === 0) {
    return (
      <EmptyState
        icon={Thermometer}
        title="No thermostats yet"
        description="Cielo, Nest, Honeywell, and Ecobee thermostats will appear here once synced to a property."
      />
    );
  }

  return (
    <div className="space-y-6">
      <MetricStrip xlColumns={3}>
        <Metric label="Total thermostats" value={total} icon={Thermometer} />
        <Metric label="Online" value={online} icon={Thermometer} />
        <Metric
          label="Offline"
          value={offline}
          icon={WifiOff}
          hint={offline > 0 ? "Needs attention" : undefined}
        />
      </MetricStrip>

      <Table>
        <TableHead>
          <TableHeaderCell>Property</TableHeaderCell>
          <TableHeaderCell>Thermostat</TableHeaderCell>
          <TableHeaderCell>Provider</TableHeaderCell>
          <TableHeaderCell>Status</TableHeaderCell>
          <TableHeaderCell>Current temp</TableHeaderCell>
          <TableHeaderCell>Target temp</TableHeaderCell>
          <TableHeaderCell>Mode</TableHeaderCell>
          <TableHeaderCell>Humidity</TableHeaderCell>
          <TableHeaderCell>Last synced</TableHeaderCell>
          <TableHeaderCell>Last telemetry</TableHeaderCell>
          <TableHeaderCell>Controls</TableHeaderCell>
        </TableHead>
        <TableBody>
          {thermostats.map((thermostat) => {
            const mode = getMode(thermostat);
            const humidity = getHumidity(thermostat);
            const telemetryUpdatedAt = getTelemetryUpdatedAt(thermostat);
            const rawTraits = getRawTraits(thermostat);
            const canManage =
              canManageByPropertyId[thermostat.propertyId] ?? false;

            return (
              <TableRow key={thermostat.id}>
                <TableCell>
                  <span className="font-medium text-ink">
                    {thermostat.property.name}
                  </span>
                </TableCell>
                <TableCell className="text-ink-muted">
                  {thermostat.name}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {getProviderDisplayName(thermostat)}
                </TableCell>
                <TableCell>
                  <StatusIndicator
                    label={
                      thermostat.status === "ONLINE" ? "Online" : "Offline"
                    }
                    tone={thermostat.status === "ONLINE" ? "success" : "error"}
                  />
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatTemperature(getCurrentTemperature(thermostat))}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatTemperature(getTargetTemperature(thermostat))}
                </TableCell>
                <TableCell className="text-ink-muted">{mode ?? "—"}</TableCell>
                <TableCell className="text-ink-muted">
                  {humidity !== null ? `${humidity}%` : "—"}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatTimestamp(thermostat.updatedAt)}
                </TableCell>
                <TableCell className="text-ink-muted">
                  {formatTimestamp(telemetryUpdatedAt)}
                </TableCell>
                <TableCell>
                  {rawTraits &&
                  canRenderNestControls({ hasRawTraits: true, canManage }) ? (
                    <NestThermostatControls
                      smartDeviceId={thermostat.id}
                      rawTraits={rawTraits}
                    />
                  ) : rawTraits ? (
                    <span className="text-ink-faint">
                      View only — no permission to control this device
                    </span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
