"use client";

import {
  Badge,
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

import type { CieloSetpointActionState } from "../actions";
import { formatTimestamp } from "../lib/format-timestamp";
import { getProviderDisplayName } from "../lib/provider-display-name";
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
import type { SmartDevice } from "../services/smart-devices.service";

import { CieloSetpointControl } from "./CieloSetpointControl";
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

function formatTemperature(value: number | null): string {
  return value !== null ? `${value}°` : "—";
}

// Compact cell/header padding — the default Table styling is too roomy once
// dozens of thermostats are mapped. `!` is required: cx() only joins class
// names, and Tailwind emits px-4/py-3/py-3.5 (the shared Table defaults)
// after px-2/py-2/py-1.5, so without it the defaults silently won and the
// table was ~160px wider than intended (measured 2026-10-24). Header labels
// are 11px: the uppercase, letter-spaced headers ("CURRENT", "HUMIDITY")
// were what set most columns' minimum width, not the readings under them.
const HEAD_CLASS = "!px-2 !py-2 !text-[11px]";
const CELL_CLASS = "!px-2 !py-1.5 text-xs align-middle max-md:!p-0";

// Below md (phones), each row becomes a two-column card instead of a
// 10-column table squeezed into a sideways-scrolling strip. Pure CSS on the
// same DOM: the header row is hidden, and each cell shows its column name
// from data-label (CSS-generated, so it adds no text nodes).
const MOBILE_TABLE_CLASS =
  "max-md:[&_table]:block max-md:[&_tbody]:block max-md:[&_thead]:hidden";
const ROW_CLASS =
  "max-md:grid max-md:grid-cols-2 max-md:gap-x-4 max-md:gap-y-1 max-md:px-3 max-md:py-2.5";
const FULL_WIDTH = "max-md:col-span-2";

// From md up to 1365px (tablets, and laptops up to 1280px wide once the
// 256px sidebar is showing), Device, Provider and Humidity fold into two
// short lines under the property name instead of three columns. 1366px is
// the first width where all ten columns fit with headroom, including the
// Cielo setpoint form (measured 2026-10-27, Plus Jakarta Sans). Also CSS-generated
// (from data-device / data-details), so the DOM — and every test that looks
// for a device name — is unchanged.
const FOLDED = "md:max-[1365px]:hidden";
const FOLDED_DEVICE =
  "md:max-[1365px]:after:block md:max-[1365px]:after:truncate md:max-[1365px]:after:font-normal md:max-[1365px]:after:text-ink-muted md:max-[1365px]:after:content-[attr(data-device)]";
const FOLDED_DETAILS =
  "md:max-[1365px]:after:block md:max-[1365px]:after:text-[11px] md:max-[1365px]:after:text-ink-faint md:max-[1365px]:after:content-[attr(data-details)]";
const LABELLED =
  "max-md:before:mr-1 max-md:before:text-ink-faint max-md:before:content-[attr(data-label)]";

/** ONLINE/OFFLINE binary display status, matching the existing summary-card convention (anything non-ONLINE and non-UNKNOWN, e.g. ERROR, still reads "Offline" in the badge) — unchanged from before this UI pass. */
function connectivityLabel(status: string): "Online" | "Offline" | "Unknown" {
  if (status === "ONLINE") return "Online";
  if (status === "UNKNOWN") return "Unknown";
  return "Offline";
}

export function ThermostatsList({
  thermostats,
  canManageByPropertyId,
  controlEnabled = false,
  staleReadingIds = [],
  cieloControlEnabled = false,
  cieloControllableIds = [],
  cieloSetpointAction,
}: {
  thermostats: ThermostatWithProperty[];
  /** Resolved server-side per property — see /thermostats/page.tsx. */
  canManageByPropertyId: Record<string, boolean>;
  /** Global Nest thermostat-control kill switch (2026-09-27). Defaults to OFF: no controls unless the page explicitly passes true. */
  controlEnabled?: boolean;
  /** Rows whose provider reading is older than 24 h (or missing), computed server-side so server and client render identically. */
  staleReadingIds?: string[];
  /** Cielo-only kill switch (2026-09-30). Defaults to OFF. */
  cieloControlEnabled?: boolean;
  /** Cielo rows on the temporary control allowlist (resolved server-side). */
  cieloControllableIds?: string[];
  cieloSetpointAction?: (
    prevState: CieloSetpointActionState,
    formData: FormData,
  ) => Promise<CieloSetpointActionState>;
}) {
  const cieloControllable = useMemo(
    () => new Set(cieloControllableIds),
    [cieloControllableIds],
  );
  const staleIds = useMemo(() => new Set(staleReadingIds), [staleReadingIds]);
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
        <div className={MOBILE_TABLE_CLASS}>
          <Table>
            <TableHead>
              <TableHeaderCell className={HEAD_CLASS}>Property</TableHeaderCell>
              <TableHeaderCell className={cx(HEAD_CLASS, FOLDED)}>
                Device
              </TableHeaderCell>
              <TableHeaderCell className={cx(HEAD_CLASS, FOLDED)}>
                Provider
              </TableHeaderCell>
              <TableHeaderCell className={HEAD_CLASS}>Status</TableHeaderCell>
              <TableHeaderCell className={HEAD_CLASS}>Current</TableHeaderCell>
              <TableHeaderCell className={HEAD_CLASS}>Target</TableHeaderCell>
              <TableHeaderCell className={HEAD_CLASS}>Mode</TableHeaderCell>
              <TableHeaderCell className={cx(HEAD_CLASS, FOLDED)}>
                Humidity
              </TableHeaderCell>
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
                  canRenderNestControls({
                    hasRawTraits: true,
                    canManage,
                    controlEnabled,
                  });
                const readingStale = staleIds.has(thermostat.id);
                const isExpanded = expandedIds.has(thermostat.id);
                const lastTelemetryTitle = `Last telemetry: ${formatTimestamp(telemetryUpdatedAt)}`;

                return (
                  <Fragment key={thermostat.id}>
                    <TableRow className={ROW_CLASS}>
                      <TableCell
                        data-details={`${getProviderDisplayName(thermostat)} · ${humidity !== null ? `${humidity}%` : "—"} humidity`}
                        className={cx(CELL_CLASS, FULL_WIDTH, FOLDED_DETAILS)}
                      >
                        <span
                          data-device={thermostat.name}
                          className={cx(
                            "block max-w-[128px] truncate font-medium text-ink max-md:max-w-none",
                            FOLDED_DEVICE,
                          )}
                          title={thermostat.property.name}
                        >
                          {thermostat.property.name}
                        </span>
                      </TableCell>
                      <TableCell className={cx(CELL_CLASS, FULL_WIDTH, FOLDED)}>
                        <span
                          className="block max-w-[128px] truncate text-ink-muted max-md:max-w-none"
                          title={thermostat.name}
                        >
                          {thermostat.name}
                        </span>
                      </TableCell>
                      <TableCell
                        data-label="Provider:"
                        className={cx(
                          CELL_CLASS,
                          LABELLED,
                          FOLDED,
                          "text-ink-muted",
                        )}
                      >
                        {getProviderDisplayName(thermostat)}
                      </TableCell>
                      <TableCell
                        data-label="Status:"
                        className={cx(
                          CELL_CLASS,
                          LABELLED,
                          "max-md:flex max-md:items-center",
                        )}
                      >
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
                      <TableCell
                        data-label="Current:"
                        className={cx(CELL_CLASS, LABELLED, "text-ink-muted")}
                      >
                        {formatTemperature(getCurrentTemperature(thermostat))}
                      </TableCell>
                      <TableCell
                        data-label="Target:"
                        className={cx(CELL_CLASS, LABELLED, "text-ink-muted")}
                      >
                        {formatTemperature(getTargetTemperature(thermostat))}
                      </TableCell>
                      <TableCell
                        data-label="Mode:"
                        className={cx(CELL_CLASS, LABELLED, "text-ink-muted")}
                      >
                        {mode ?? "—"}
                      </TableCell>
                      <TableCell
                        data-label="Humidity:"
                        className={cx(
                          CELL_CLASS,
                          LABELLED,
                          FOLDED,
                          "text-ink-muted",
                        )}
                      >
                        {humidity !== null ? `${humidity}%` : "—"}
                      </TableCell>
                      <TableCell
                        data-label="Last synced:"
                        className={cx(
                          CELL_CLASS,
                          LABELLED,
                          FULL_WIDTH,
                          "text-ink-muted",
                        )}
                      >
                        {/* Last telemetry (its own full column before this
                          pass) now rides along as a tooltip here — a
                          non-intrusive secondary detail, not a column that
                          widens every row. */}
                        <span title={lastTelemetryTitle}>
                          {formatTimestamp(thermostat.updatedAt)}
                        </span>
                        {readingStale && (
                          <Badge
                            tone="warning"
                            className="mt-1 block w-fit text-[10px]"
                            title={lastTelemetryTitle}
                          >
                            Stale reading ·{" "}
                            {telemetryUpdatedAt
                              ? formatTimestamp(telemetryUpdatedAt)
                              : "none recorded"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell
                        data-label="Controls:"
                        className={cx(CELL_CLASS, LABELLED, FULL_WIDTH)}
                      >
                        {thermostat.provider === "CIELO" ? (
                          !cieloControllable.has(thermostat.id) ? (
                            <span className="text-ink-faint">
                              {canManage
                                ? "Not on the Cielo control allowlist"
                                : "—"}
                            </span>
                          ) : !canManage ? (
                            <span className="text-ink-faint">
                              View only — no permission to control this device
                            </span>
                          ) : !cieloControlEnabled || !cieloSetpointAction ? (
                            <span className="text-ink-faint">
                              Remote control is OFF
                            </span>
                          ) : (
                            <CieloSetpointControl
                              smartDeviceId={thermostat.id}
                              propertyName={thermostat.property.name}
                              deviceName={thermostat.name}
                              currentTargetF={getTargetTemperature(thermostat)}
                              action={cieloSetpointAction}
                            />
                          )
                        ) : hasLiveControls ? (
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
                        ) : rawTraits && canManage && !controlEnabled ? (
                          <span className="text-ink-faint">
                            Remote control is OFF
                          </span>
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
                      <TableRow className="max-md:block">
                        <TableCell
                          colSpan={CONTROLS_COLUMN_COUNT}
                          className="bg-surface-muted px-4 py-3 max-md:block max-md:px-3"
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
        </div>
      )}
    </div>
  );
}
