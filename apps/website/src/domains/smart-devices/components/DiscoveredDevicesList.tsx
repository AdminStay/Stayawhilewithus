import { computeNestDeviceCapabilities } from "@stayw/integrations/nest/capabilities";
import {
  Badge,
  Button,
  ConfirmButton,
  EmptyState,
  Select,
  StatusIndicator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
} from "@stayw/ui";
import { Radar } from "lucide-react";

import {
  mapProviderDeviceToPropertyAction,
  setProviderDeviceEnabledAction,
  unmapProviderDeviceAction,
} from "../actions";
import type { ProviderDevice } from "../services/provider-devices.service";
import { getProviderDisplayName } from "../services/smart-devices.service";

interface Property {
  id: string;
  name: string;
}

type DiscoveredDevice = ProviderDevice & {
  property: Property | null;
  integrationConnection: { provider: string };
};

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

export function DiscoveredDevicesList({
  devices,
  properties,
}: {
  devices: DiscoveredDevice[];
  properties: Property[];
}) {
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
    <Table>
      <TableHead>
        <TableHeaderCell>Device</TableHeaderCell>
        <TableHeaderCell>Provider</TableHeaderCell>
        <TableHeaderCell>Connectivity</TableHeaderCell>
        <TableHeaderCell>Property</TableHeaderCell>
        <TableHeaderCell>Status</TableHeaderCell>
        <TableHeaderCell>Capabilities (read-only)</TableHeaderCell>
        <TableHeaderCell>Actions</TableHeaderCell>
      </TableHead>
      <TableBody>
        {devices.map((device) => (
          <TableRow key={device.id}>
            <TableCell className="font-medium text-ink">
              {device.discoveredName}
            </TableCell>
            <TableCell className="text-ink-muted">
              {getProviderDisplayName({
                provider: device.integrationConnection.provider as never,
              })}
            </TableCell>
            <TableCell>
              <StatusIndicator
                label={device.connectivityStatus}
                tone={
                  device.connectivityStatus === "ONLINE" ? "success" : "neutral"
                }
              />
            </TableCell>
            <TableCell className="text-ink-muted">
              {device.property?.name ?? "Unmapped"}
            </TableCell>
            <TableCell>
              <Badge tone={device.enabled ? "success" : "neutral"}>
                {device.enabled ? "Enabled" : "Discovered"}
              </Badge>
            </TableCell>
            <TableCell>
              <CapabilitySummary device={device} />
            </TableCell>
            <TableCell>
              <div className="flex flex-wrap items-center gap-2">
                {!device.propertyId && (
                  <form
                    action={mapProviderDeviceToPropertyAction}
                    className="flex items-center gap-2"
                  >
                    <input
                      type="hidden"
                      name="providerDeviceId"
                      value={device.id}
                    />
                    <Select name="propertyId" required defaultValue="">
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
        ))}
      </TableBody>
    </Table>
  );
}
