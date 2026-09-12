// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mocked to avoid pulling in the real smart-devices.service.ts, which
// imports "server-only" and @stayw/database — same reason
// DiscoveredDevicesList.test.tsx mocks "../actions" instead of importing
// it for real. These are faithful, minimal reimplementations of exactly
// the pure functions LocksList.tsx uses, mirroring the real
// smart-devices.service.ts/thermostat-metadata.ts logic.
vi.mock("../services/smart-devices.service", () => {
  const LOW_BATTERY_THRESHOLD = 20;
  const TELEMETRY_STALE_THRESHOLD_MS = 24 * 60 * 60 * 1000;

  function getBatteryLevel(device: {
    metadata: Record<string, unknown> | null;
  }) {
    const level = device.metadata?.batteryLevel;
    return typeof level === "number" ? level : null;
  }

  function isLowBattery(device: { metadata: Record<string, unknown> | null }) {
    const level = getBatteryLevel(device);
    return level !== null && level < LOW_BATTERY_THRESHOLD;
  }

  function getLockState(device: { metadata: Record<string, unknown> | null }) {
    const value = device.metadata?.lockState;
    return typeof value === "string" ? value : null;
  }

  function getTelemetryUpdatedAt(device: {
    metadata: Record<string, unknown> | null;
  }) {
    const value = device.metadata?.telemetryUpdatedAt;
    if (typeof value !== "string") return null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  function isTelemetryStale(device: {
    metadata: Record<string, unknown> | null;
  }) {
    const telemetryUpdatedAt = getTelemetryUpdatedAt(device);
    if (!telemetryUpdatedAt) return false;
    return (
      Date.now() - telemetryUpdatedAt.getTime() > TELEMETRY_STALE_THRESHOLD_MS
    );
  }

  function isDemoSmartDevice(device: { externalDeviceId: string }) {
    return device.externalDeviceId.startsWith("demo-");
  }

  return {
    getBatteryLevel,
    getLockState,
    getTelemetryUpdatedAt,
    isDemoSmartDevice,
    isLowBattery,
    isTelemetryStale,
  };
});

import { LocksList } from "./LocksList";

afterEach(cleanup);

const FRESH_TELEMETRY = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
const STALE_TELEMETRY = new Date(
  Date.now() - 30 * 60 * 60 * 1000,
).toISOString(); // 30h ago

type LockFixture = {
  id: string;
  name: string;
  provider: "AUGUST";
  deviceType: "LOCK";
  externalDeviceId: string;
  status: "ONLINE" | "OFFLINE" | "UNKNOWN" | "ERROR";
  metadata: Record<string, unknown>;
  updatedAt: Date;
  property: { name: string };
};

function makeLock(overrides: Partial<LockFixture> = {}): LockFixture {
  return {
    id: "lock-1",
    name: "Front Door",
    provider: "AUGUST",
    deviceType: "LOCK",
    externalDeviceId: "real-ext-1",
    status: "ONLINE",
    metadata: {},
    updatedAt: new Date("2026-09-01T00:00:00.000Z"),
    property: { name: "Test Property" },
    ...overrides,
  };
}

function renderLocks(locks: LockFixture[]) {
  return render(<LocksList locks={locks as never} />);
}

function warningsCellFor(rowName: string) {
  const row = screen.getByText(rowName).closest("tr");
  if (!row) throw new Error(`Row for "${rowName}" not found`);
  // Warnings is the 6th column: Property, Lock, Connectivity, Lock state, Battery, Warnings
  const cells = within(row).getAllByRole("cell");
  const warningsCell = cells[5];
  if (!warningsCell)
    throw new Error(`Warnings cell not found for "${rowName}"`);
  return warningsCell;
}

describe("LocksList — connectivity/telemetry Warnings wording", () => {
  it("ONLINE + fresh telemetry renders Healthy", () => {
    renderLocks([
      makeLock({
        name: "Aqua Palm Lock",
        status: "ONLINE",
        metadata: { telemetryUpdatedAt: FRESH_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Aqua Palm Lock")).getByText("Healthy"),
    ).toBeTruthy();
  });

  it("UNKNOWN + fresh telemetry + normal battery renders 'Connectivity not reported' (unchanged)", () => {
    renderLocks([
      makeLock({
        name: "Casa Del Mar Lock",
        status: "UNKNOWN",
        metadata: { telemetryUpdatedAt: FRESH_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Casa Del Mar Lock")).getByText(
        "Connectivity not reported",
      ),
    ).toBeTruthy();
  });

  it("UNKNOWN + fresh telemetry + low battery renders the combined connectivity+battery message (regression: previously hid the low battery entirely)", () => {
    renderLocks([
      makeLock({
        name: "Las Sirenas - Front Door",
        status: "UNKNOWN",
        metadata: { telemetryUpdatedAt: FRESH_TELEMETRY, batteryLevel: 19 },
      }),
    ]);
    expect(
      within(warningsCellFor("Las Sirenas - Front Door")).getByText(
        "Connectivity not reported + low battery (19%)",
      ),
    ).toBeTruthy();
  });

  it("UNKNOWN + stale telemetry renders the new precise combined message", () => {
    renderLocks([
      makeLock({
        name: "Dolphin - Front Door",
        status: "UNKNOWN",
        metadata: { telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Dolphin - Front Door")).getByText(
        "Connectivity not reported — no telemetry in 24h+",
      ),
    ).toBeTruthy();
  });

  it("ONLINE + stale telemetry still renders the original 'Attention needed' message", () => {
    renderLocks([
      makeLock({
        name: "Online Stale Lock",
        status: "ONLINE",
        metadata: { telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Online Stale Lock")).getByText(
        "Attention needed — telemetry stale",
      ),
    ).toBeTruthy();
  });

  it("OFFLINE renders 'Offline', unaffected by telemetry staleness or connectivity wording changes", () => {
    renderLocks([
      makeLock({
        name: "Offline Lock",
        status: "OFFLINE",
        metadata: { telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Offline Lock")).getByText("Offline"),
    ).toBeTruthy();
  });

  it("OFFLINE + low battery renders 'Offline + low battery', unchanged", () => {
    renderLocks([
      makeLock({
        name: "Offline Low Battery Lock",
        status: "OFFLINE",
        metadata: { batteryLevel: 10, telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Offline Low Battery Lock")).getByText(
        "Offline + low battery",
      ),
    ).toBeTruthy();
  });

  it("low battery alone (ONLINE, fresh telemetry) renders 'Low battery (X%)', unchanged", () => {
    renderLocks([
      makeLock({
        name: "Low Battery Lock",
        status: "ONLINE",
        metadata: { batteryLevel: 15, telemetryUpdatedAt: FRESH_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Low Battery Lock")).getByText(
        "Low battery (15%)",
      ),
    ).toBeTruthy();
  });

  it("stale + low battery renders the combined stale+battery message regardless of connectivity (UNKNOWN case), unchanged", () => {
    renderLocks([
      makeLock({
        name: "Unknown Stale Low Battery Lock",
        status: "UNKNOWN",
        metadata: { batteryLevel: 12, telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Unknown Stale Low Battery Lock")).getByText(
        "Telemetry stale + low battery (12%)",
      ),
    ).toBeTruthy();
  });

  it("stale + low battery renders the combined message for ONLINE too, unchanged", () => {
    renderLocks([
      makeLock({
        name: "Online Stale Low Battery Lock",
        status: "ONLINE",
        metadata: { batteryLevel: 12, telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    expect(
      within(warningsCellFor("Online Stale Low Battery Lock")).getByText(
        "Telemetry stale + low battery (12%)",
      ),
    ).toBeTruthy();
  });
});

describe("LocksList — per-row spot-refresh action gating", () => {
  it("renders no Actions column and no per-row button when canRefresh is omitted (default false) — existing behavior unchanged", () => {
    renderLocks([makeLock({ name: "Ungated Lock" })]);
    expect(screen.queryByText("Actions")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Refresh telemetry" }),
    ).toBeNull();
  });

  it("renders no Actions column when canRefresh is true but no action is supplied", () => {
    render(
      <LocksList
        locks={[makeLock({ name: "No Action Lock" })] as never}
        canRefresh={true}
      />,
    );
    expect(screen.queryByText("Actions")).toBeNull();
  });

  it("renders a per-row 'Refresh telemetry' button for an August lock when canRefresh + action are both supplied", () => {
    const action = vi.fn();
    render(
      <LocksList
        locks={[makeLock({ id: "lock-abc", name: "Gated Lock" })] as never}
        canRefresh={true}
        spotRefreshAction={action}
      />,
    );
    expect(screen.getByText("Actions")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Refresh telemetry" }),
    ).toBeTruthy();
  });

  it("each row's button submits that exact row's own SmartDevice.id, never another row's", () => {
    const action = vi.fn();
    render(
      <LocksList
        locks={
          [
            makeLock({ id: "lock-aaa", name: "Row A" }),
            makeLock({ id: "lock-bbb", name: "Row B" }),
          ] as never
        }
        canRefresh={true}
        spotRefreshAction={action}
      />,
    );

    const rowA = screen.getByText("Row A").closest("tr");
    const rowB = screen.getByText("Row B").closest("tr");
    if (!rowA || !rowB) throw new Error("Expected rows not found");

    expect(within(rowA).getByDisplayValue("lock-aaa")).toBeTruthy();
    expect(within(rowB).getByDisplayValue("lock-bbb")).toBeTruthy();
  });

  it("shows a placeholder, not a button, for a non-August row even when gated on", () => {
    const action = vi.fn();
    render(
      <LocksList
        locks={
          [
            makeLock({
              id: "lock-nest",
              name: "Not August",
              provider: "CIELO" as never,
            }),
          ] as never
        }
        canRefresh={true}
        spotRefreshAction={action}
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Refresh telemetry" }),
    ).toBeNull();
  });
});
