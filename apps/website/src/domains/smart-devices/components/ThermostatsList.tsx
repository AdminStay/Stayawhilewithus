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
  getCurrentTemperature,
  getHumidity,
  getMode,
  getProviderDisplayName,
  getTargetTemperature,
  getTelemetryUpdatedAt,
  type SmartDevice,
} from "../services/smart-devices.service";

type ThermostatWithProperty = SmartDevice & { property: { name: string } };

function formatTimestamp(date: Date | null): string {
  return date ? new Date(date).toLocaleString() : "—";
}

function formatTemperature(value: number | null): string {
  return value !== null ? `${value}°` : "—";
}

export function ThermostatsList({
  thermostats,
}: {
  thermostats: ThermostatWithProperty[];
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
        </TableHead>
        <TableBody>
          {thermostats.map((thermostat) => {
            const mode = getMode(thermostat);
            const humidity = getHumidity(thermostat);
            const telemetryUpdatedAt = getTelemetryUpdatedAt(thermostat);

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
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </div>
  );
}
