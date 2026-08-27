"use client";

import { Button } from "@stayw/ui";
import { useState } from "react";

import {
  getAugustHouseId,
  type DiscoveredDevice,
} from "../lib/discovered-device";
import { getProviderDisplayName } from "../lib/provider-display-name";

const CSV_HEADER = [
  "Provider",
  "Device/Lock Name",
  "External Device ID",
  "House ID",
  "Connectivity",
  "Mapped Property",
  "Property Internal Code",
  "Enabled/Disabled",
];

/**
 * RFC 4180-style escaping: a value is wrapped in double quotes whenever it
 * contains a comma, a double quote, or a newline, and any double quote it
 * contains is doubled. Every other value is left bare — this keeps the
 * common case (plain names/IDs) readable while still being correct for the
 * rare device/property name with a comma or quote in it.
 */
function escapeCsvValue(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/**
 * Builds the CSV entirely from the devices already loaded onto this page
 * (the same list DiscoveredDevicesList renders) — no server fetch, no
 * database read of its own. Deliberately includes only the 8 named,
 * non-sensitive fields below; never serializes rawMetadata itself, so
 * nothing beyond the single whitelisted houseId field (via
 * getAugustHouseId, August-only) ever reaches this export. No credentials,
 * tokens, or provider secrets exist in this data at all — ProviderDevice
 * rawMetadata is already sanitized to safe device fields at discovery time
 * (see provider-devices.service.ts).
 */
function buildInventoryCsv(devices: DiscoveredDevice[]): string {
  const rows = devices.map((device) => {
    const provider = getProviderDisplayName({
      provider: device.integrationConnection.provider as never,
    });
    const houseId = getAugustHouseId(device) ?? "—";
    const mappedProperty = device.property?.name ?? "Unmapped";
    const internalCode = device.property?.internalCode ?? "";
    const enabled = device.enabled ? "Enabled" : "Disabled";

    return [
      provider,
      device.discoveredName,
      device.externalDeviceId,
      houseId,
      device.connectivityStatus,
      mappedProperty,
      internalCode,
      enabled,
    ];
  });

  return [CSV_HEADER, ...rows]
    .map((row) => row.map(escapeCsvValue).join(","))
    .join("\n");
}

/**
 * Copies the currently-loaded discovered-device inventory to the
 * clipboard as CSV, so an admin can paste it into a spreadsheet while
 * reviewing/mapping the full August (or Nest) inventory. Purely a
 * client-side transform of props already fetched by the server page —
 * clicking this never triggers a network request, a discovery run, or any
 * write. No new permission is needed: this data has already been sent to
 * the browser by the page's own smart_devices:read-gated fetch.
 */
export function CopyInventoryButton({
  devices,
}: {
  devices: DiscoveredDevice[];
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function handleCopy() {
    const csv = buildInventoryCsv(devices);
    try {
      await navigator.clipboard.writeText(csv);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <div className="flex items-center gap-2">
      <Button type="button" variant="secondary" size="sm" onClick={handleCopy}>
        Copy inventory as CSV
      </Button>
      {copyState === "copied" && (
        <span className="text-xs text-success-600">Copied.</span>
      )}
      {copyState === "failed" && (
        <span className="text-xs text-error-500">
          Couldn&apos;t copy — try selecting the table instead.
        </span>
      )}
    </div>
  );
}
