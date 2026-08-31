"use client";

import {
  cx,
  EmptyState,
  Input,
  Metric,
  MetricStrip,
  Select,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import {
  ChevronDown,
  ChevronRight,
  Search,
  Thermometer,
  WifiOff,
} from "lucide-react";
import { Fragment, useMemo, useState } from "react";

import {
  DEFAULT_THERMOSTAT_FILTER_STATE,
  filterThermostats,
  type ThermostatFilterState,
} from "../lib/thermostat-filter";
import {
  canRenderNestControls,
  getCurrentTemperature,
  getHumidity,
  getMode,
  getTargetTemperature,
  getTelemetryUpdatedAt,
} from "../lib/thermostat-metadata";
import { getProviderDisplayName } from "../lib/provider-display-name";
import type { SmartDevice } from "../services/smart-devices.service";

import { NestThermostatControls } from "./NestThermostatControls";

type ThermostatWithProperty = SmartDevice & {
  property: { name: string };
  providerDevice: {
    enabled: boolean;
    rawMetadata: unknown;
  } | null;
};

const CONTROLS_COLUMN_COUNT = 10;

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

// Compact cell/header padding, matching the same treatment already applied
// to Discovered Devices — the default Table styling is too roomy once
// dozens of thermostats are mapped.
const HEAD_CLASS = "px-2 py-2 text-xs";
const CELL_CLASS = "px-2 py-1.5 text-xs align-middle";

/** ONLINE/OFFLINE binary display status, matching the existing summary-card convention (anything non-ONLINE and non-UNKNOWN, e.g. ERROR, still reads "Offline" in the badge) — unchanged from before this UI pass. */
function connectivityLabel(status: string): "Online" | "Offline" | "Unknown" {
  if (status === "ONLINE") return "Online";
  if (status === "UNKNOWN") return "Unknown";
  return "Offline";
}

export function ThermostatsList({
  thermostats,
  canManageByPropertyId,
}: {
  thermostats: ThermostatWithProperty[];
  /** Resolved server-side per property — see /thermostats/page.tsx. */
  canManageByPropertyId: Record<string, boolean>;
}) {
  const [filters, setFilters] = useState<ThermostatFilterState>(
    DEFAULT_THERMOSTAT_FILTER_STATE,
  );
  // Which rows currently show their full NestThermostatControls stack below
  // the main row — collapsed by default so a row with 5 possible command
  // forms (mode/heat/cool/range/fan) doesn't force every row to be that
  // tall. Purely local UI state; never affects what data is fetched,
  // what's mapped/enabled, or what RBAC/command logic runs.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(id: string) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  // Always derived from the full, unfiltered inventory — these summary
  // cards intentionally don't move when the user searches/filters below.
  const total = thermostats.length;
  const online = thermostats.filter((t) => t.status === "ONLINE").length;
  const offline = total - online;

  const providers = useMemo(
    () => Array.from(new Set(thermostats.map((t) => t.provider))).sort(),
    [thermostats],
  );

  const filteredThermostats = useMemo(
    () => filterThermostats(thermostats, filters),
    [thermostats, filters],
  );

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

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            placeholder="Search by property or thermostat…"
            aria-label="Search thermostats"
            value={filters.search}
            onChange={(e) =>
              setFilters((f) => ({ ...f, search: e.target.value }))
            }
            className="pl-8"
          />
        </div>

        <Select
          aria-label="Filter by provider"
          value={filters.provider}
          onChange={(e) =>
            setFilters((f) => ({ ...f, provider: e.target.value }))
          }
          className="w-auto"
        >
          <option value="ALL">All providers</option>
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {getProviderDisplayName({ provider: provider as never })}
            </option>
          ))}
        </Select>

        <Select
          aria-label="Filter by status"
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              status: e.target.value as ThermostatFilterState["status"],
            }))
          }
          className="w-auto"
        >
          <option value="ALL">All status</option>
          <option value="ONLINE">Online</option>
          <option value="OFFLINE">Offline</option>
          <option value="UNKNOWN">Unknown</option>
          <option value="NEEDS_ATTENTION">
            Needs attention (Offline + Unknown)
          </option>
        </Select>

        <span className="text-xs text-ink-muted">
          {filteredThermostats.length} of {total} thermostats
        </span>
      </div>

      {filteredThermostats.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No thermostats match your search/filters"
          description="Try a different search term, or clear the filters above."
        />
      ) : (
        <Table>
          <TableHead>
            <TableHeaderCell className={HEAD_CLASS}>Property</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Device</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Provider</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Status</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Current</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Target</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Mode</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Humidity</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>
              Last synced
            </TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Controls</TableHeaderCell>
          </TableHead>
          <TableBody>
            {filteredThermostats.map((thermostat) => {
              const mode = getMode(thermostat);
              const humidity = getHumidity(thermostat);
              const telemetryUpdatedAt = getTelemetryUpdatedAt(thermostat);
              const rawTraits = getRawTraits(thermostat);
              const canManage =
                canManageByPropertyId[thermostat.propertyId] ?? false;
              const label = connectivityLabel(thermostat.status);
              // The only case that ever renders NestThermostatControls' own
              // (potentially 5-form) stack — everything else in this column
              // is already a single short line, so only this case needs a
              // collapse/expand affordance.
              const hasLiveControls =
                Boolean(rawTraits) &&
                canRenderNestControls({ hasRawTraits: true, canManage });
              const isExpanded = expandedIds.has(thermostat.id);
              const lastTelemetryTitle = `Last telemetry: ${formatTimestamp(telemetryUpdatedAt)}`;

              return (
                <Fragment key={thermostat.id}>
                  <TableRow>
                    <TableCell className={CELL_CLASS}>
                      <span
                        className="block max-w-[140px] truncate font-medium text-ink"
                        title={thermostat.property.name}
                      >
                        {thermostat.property.name}
                      </span>
                    </TableCell>
                    <TableCell className={CELL_CLASS}>
                      <span
                        className="block max-w-[140px] truncate text-ink-muted"
                        title={thermostat.name}
                      >
                        {thermostat.name}
                      </span>
                    </TableCell>
                    <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                      {getProviderDisplayName(thermostat)}
                    </TableCell>
                    <TableCell className={CELL_CLASS}>
                      <StatusIndicator
                        label={label}
                        tone={
                          label === "Online"
                            ? "success"
                            : label === "Unknown"
                              ? "neutral"
                              : "error"
                        }
                      />
                    </TableCell>
                    <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                      {formatTemperature(getCurrentTemperature(thermostat))}
                    </TableCell>
                    <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                      {formatTemperature(getTargetTemperature(thermostat))}
                    </TableCell>
                    <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                      {mode ?? "—"}
                    </TableCell>
                    <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                      {humidity !== null ? `${humidity}%` : "—"}
                    </TableCell>
                    <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                      {/* Last telemetry (its own full column before this
                          pass) now rides along as a tooltip here — a
                          non-intrusive secondary detail, not a column that
                          widens every row. */}
                      <span title={lastTelemetryTitle}>
                        {formatTimestamp(thermostat.updatedAt)}
                      </span>
                    </TableCell>
                    <TableCell className={CELL_CLASS}>
                      {hasLiveControls ? (
                        <button
                          type="button"
                          onClick={() => toggleExpanded(thermostat.id)}
                          aria-expanded={isExpanded}
                          aria-label={`${isExpanded ? "Hide" : "Show"} controls for ${thermostat.name}`}
                          className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs text-ink transition-colors hover:bg-surface-muted"
                        >
                          {isExpanded ? (
                            <ChevronDown className="h-3.5 w-3.5" />
                          ) : (
                            <ChevronRight className="h-3.5 w-3.5" />
                          )}
                          Controls
                        </button>
                      ) : rawTraits ? (
                        <span className="text-ink-faint">
                          View only — no permission to control this device
                        </span>
                      ) : (
                        <span className="text-ink-faint">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                  {hasLiveControls && isExpanded && (
                    <TableRow>
                      <TableCell
                        colSpan={CONTROLS_COLUMN_COUNT}
                        className="bg-surface-muted px-4 py-3"
                      >
                        <NestThermostatControls
                          smartDeviceId={thermostat.id}
                          rawTraits={rawTraits!}
                          currentTemperatureLabel={formatTemperature(
                            getCurrentTemperature(thermostat),
                          )}
                          targetTemperatureLabel={formatTemperature(
                            getTargetTemperature(thermostat),
                          )}
                          modeLabel={mode ?? undefined}
                          humidityLabel={
                            humidity !== null ? `${humidity}%` : undefined
                          }
                          onClose={() => toggleExpanded(thermostat.id)}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
