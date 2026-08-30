"use client";

import { computeNestDeviceCapabilities } from "@stayw/integrations/nest/capabilities";
import {
  Badge,
  Button,
  ConfirmButton,
  cx,
  EmptyState,
  Input,
  Select,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Radar, Search } from "lucide-react";
import { useMemo, useState } from "react";

import {
  mapProviderDeviceToPropertyAction,
  setProviderDeviceEnabledAction,
  unmapProviderDeviceAction,
} from "../actions";
import {
  DEFAULT_DEVICE_FILTER_STATE,
  filterDiscoveredDevices,
  type DeviceFilterState,
} from "../lib/device-filter";
import {
  getAugustHouseId,
  type DiscoveredDevice,
  type Property,
} from "../lib/discovered-device";
import { getProviderDisplayName } from "../lib/provider-display-name";

import { CopyableId } from "./CopyableId";
import { CopyInventoryButton } from "./CopyInventoryButton";

export type { DiscoveredDevice, Property };

/**
 * Read-only display only — no control affordance here. Derived from the
 * actual traits a real discovery call captured (device.rawMetadata.rawTraits),
 * never assumed. Only meaningful for Nest today; other providers show "—".
 */
function CapabilitySummary({ device }: { device: DiscoveredDevice }) {
  if (device.integrationConnection.provider !== "NEST") {
    return <span className="text-ink-faint">—</span>;
  }

  const rawMetadata = device.rawMetadata as { rawTraits?: unknown } | null;
  const rawTraits =
    rawMetadata && typeof rawMetadata === "object" && rawMetadata.rawTraits
      ? (rawMetadata.rawTraits as Record<string, Record<string, unknown>>)
      : {};
  const capabilities = computeNestDeviceCapabilities(rawTraits);

  const modeBadges: string[] = [];
  if (capabilities.supportsHeatSetpoint) modeBadges.push("Heat");
  if (capabilities.supportsCoolSetpoint) modeBadges.push("Cool");
  if (capabilities.hasFanTrait) modeBadges.push("Fan");

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap gap-1">
        {modeBadges.length > 0 ? (
          modeBadges.map((label) => (
            <Badge key={label} tone="info">
              {label}
            </Badge>
          ))
        ) : (
          <span className="text-ink-faint">No mode data yet</span>
        )}
        {capabilities.ecoModeActive && <Badge tone="warning">Eco active</Badge>}
      </div>
      {capabilities.restrictions.length > 0 && (
        <p className="text-xs text-ink-faint">
          {capabilities.restrictions.join(" ")}
        </p>
      )}
    </div>
  );
}

// Compact cell/header padding — the default Table styling (px-4 py-3.5) is
// too roomy for a ~76-row, 9-column inventory. Sticky columns need an
// explicit, opaque background (bg-surface/bg-surface-muted) since a
// position:sticky cell renders above whatever scrolls underneath it.
const HEAD_CLASS = "px-2 py-2 text-xs";
const CELL_CLASS = "px-2 py-1.5 text-xs";
const STICKY_LEFT_HEAD = cx(HEAD_CLASS, "sticky left-0 z-10 bg-surface-muted");
const STICKY_LEFT_CELL = cx(CELL_CLASS, "sticky left-0 z-10 bg-surface");
const STICKY_RIGHT_HEAD = cx(
  HEAD_CLASS,
  "sticky right-0 z-10 bg-surface-muted",
);
const STICKY_RIGHT_CELL = cx(CELL_CLASS, "sticky right-0 z-10 bg-surface");

export function DiscoveredDevicesList({
  devices,
  properties,
}: {
  devices: DiscoveredDevice[];
  properties: Property[];
}) {
  const [filters, setFilters] = useState<DeviceFilterState>(
    DEFAULT_DEVICE_FILTER_STATE,
  );

  const providers = useMemo(
    () =>
      Array.from(
        new Set(devices.map((d) => d.integrationConnection.provider)),
      ).sort(),
    [devices],
  );

  const filteredDevices = useMemo(
    () => filterDiscoveredDevices(devices, filters),
    [devices, filters],
  );

  if (devices.length === 0) {
    return (
      <EmptyState
        icon={Radar}
        title="No discovered devices yet"
        description="Run discovery from a connected provider (e.g. Nest) to find devices — nothing is ever mapped or enabled automatically."
      />
    );
  }

  return (
    <>
      <div className="mb-3 flex justify-end">
        <CopyInventoryButton devices={devices} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] max-w-sm flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
          <Input
            type="text"
            placeholder="Search devices…"
            aria-label="Search devices"
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
          aria-label="Filter by mapping"
          value={filters.mapping}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              mapping: e.target.value as DeviceFilterState["mapping"],
            }))
          }
          className="w-auto"
        >
          <option value="ALL">All mapping</option>
          <option value="UNMAPPED">Unmapped</option>
          <option value="MAPPED">Mapped</option>
        </Select>

        <Select
          aria-label="Filter by status"
          value={filters.status}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              status: e.target.value as DeviceFilterState["status"],
            }))
          }
          className="w-auto"
        >
          <option value="ALL">All status</option>
          <option value="DISCOVERED">Discovered</option>
          <option value="ENABLED">Enabled</option>
        </Select>

        <span className="text-xs text-ink-muted">
          {filteredDevices.length} of {devices.length} devices
        </span>
      </div>

      {filteredDevices.length === 0 ? (
        <EmptyState
          icon={Search}
          title="No devices match your search/filters"
          description="Try a different search term, or clear the filters above."
        />
      ) : (
        <Table>
          <TableHead>
            <TableHeaderCell className={cx(STICKY_LEFT_HEAD, "min-w-[140px]")}>
              Device
            </TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Provider</TableHeaderCell>
            <TableHeaderCell className={cx(HEAD_CLASS, "max-w-[130px]")}>
              External ID
            </TableHeaderCell>
            <TableHeaderCell className={cx(HEAD_CLASS, "max-w-[130px]")}>
              House ID
            </TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>
              Connectivity
            </TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Property</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>Status</TableHeaderCell>
            <TableHeaderCell className={HEAD_CLASS}>
              Capabilities (read-only)
            </TableHeaderCell>
            <TableHeaderCell className={cx(STICKY_RIGHT_HEAD, "min-w-[170px]")}>
              Actions
            </TableHeaderCell>
          </TableHead>
          <TableBody>
            {filteredDevices.map((device) => {
              const houseId = getAugustHouseId(device);
              return (
                <TableRow key={device.id}>
                  <TableCell
                    className={cx(STICKY_LEFT_CELL, "font-medium text-ink")}
                  >
                    {device.discoveredName}
                  </TableCell>
                  <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                    {getProviderDisplayName({
                      provider: device.integrationConnection.provider as never,
                    })}
                  </TableCell>
                  <TableCell className={cx(CELL_CLASS, "max-w-[130px]")}>
                    <CopyableId value={device.externalDeviceId} />
                  </TableCell>
                  <TableCell className={cx(CELL_CLASS, "max-w-[130px]")}>
                    {houseId ? (
                      <CopyableId value={houseId} />
                    ) : (
                      <span className="text-ink-muted">—</span>
                    )}
                  </TableCell>
                  <TableCell className={CELL_CLASS}>
                    <StatusIndicator
                      label={device.connectivityStatus}
                      tone={
                        device.connectivityStatus === "ONLINE"
                          ? "success"
                          : "neutral"
                      }
                    />
                  </TableCell>
                  <TableCell className={cx(CELL_CLASS, "text-ink-muted")}>
                    {device.property
                      ? `${device.property.name} (${device.property.internalCode})`
                      : "Unmapped"}
                  </TableCell>
                  <TableCell className={CELL_CLASS}>
                    <Badge tone={device.enabled ? "success" : "neutral"}>
                      {device.enabled ? "Enabled" : "Discovered"}
                    </Badge>
                  </TableCell>
                  <TableCell className={CELL_CLASS}>
                    <CapabilitySummary device={device} />
                  </TableCell>
                  <TableCell className={STICKY_RIGHT_CELL}>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {!device.propertyId && (
                        <form
                          action={mapProviderDeviceToPropertyAction}
                          className="flex items-center gap-1.5"
                        >
                          <input
                            type="hidden"
                            name="providerDeviceId"
                            value={device.id}
                          />
                          <Select
                            name="propertyId"
                            required
                            defaultValue=""
                            className="w-32 text-xs"
                          >
                            <option value="" disabled>
                              Choose property…
                            </option>
                            {properties.map((property) => (
                              <option key={property.id} value={property.id}>
                                {property.name}
                              </option>
                            ))}
                          </Select>
                          <Button type="submit" size="sm" variant="secondary">
                            Map
                          </Button>
                        </form>
                      )}

                      {device.propertyId && !device.enabled && (
                        <form action={setProviderDeviceEnabledAction}>
                          <input
                            type="hidden"
                            name="providerDeviceId"
                            value={device.id}
                          />
                          <input type="hidden" name="enabled" value="true" />
                          <ConfirmButton
                            type="submit"
                            size="sm"
                            variant="primary"
                            confirmMessage={`Enable "${device.discoveredName}"? It will start appearing on the dashboard as a real device.`}
                          >
                            Enable
                          </ConfirmButton>
                        </form>
                      )}

                      {device.propertyId && device.enabled && (
                        <form action={setProviderDeviceEnabledAction}>
                          <input
                            type="hidden"
                            name="providerDeviceId"
                            value={device.id}
                          />
                          <input type="hidden" name="enabled" value="false" />
                          <Button type="submit" size="sm" variant="secondary">
                            Disable
                          </Button>
                        </form>
                      )}

                      {device.propertyId && (
                        <form action={unmapProviderDeviceAction}>
                          <input
                            type="hidden"
                            name="providerDeviceId"
                            value={device.id}
                          />
                          <ConfirmButton
                            type="submit"
                            size="sm"
                            variant="secondary"
                            confirmMessage={`Unmap "${device.discoveredName}" from ${device.property?.name}? This clears its property mapping and disables it.`}
                          >
                            Unmap
                          </ConfirmButton>
                        </form>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}
    </>
  );
}
