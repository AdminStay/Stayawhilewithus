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

function rowFor(rowName: string): HTMLElement {
  const row = screen.getByText(rowName).closest("tr");
  if (!row) throw new Error(`Row for "${rowName}" not found`);
  return row;
}

// Status is the 2nd cell: Property/Lock, Status, Lock state, Battery, Last
// update — scoped by index because "Unknown" legitimately appears in BOTH
// the Status label and the Lock State badge when neither is reported.
function statusCellFor(rowName: string): HTMLElement {
  const cells = within(rowFor(rowName)).getAllByRole("cell");
  const statusCell = cells[1];
  if (!statusCell) throw new Error(`Status cell for "${rowName}" not found`);
  return statusCell;
}

describe("LocksList — consolidated Status column", () => {
  it("ONLINE + fresh telemetry: dot+label 'Online', no secondary badges", () => {
    renderLocks([
      makeLock({
        name: "Aqua Palm Lock",
        status: "ONLINE",
        metadata: { telemetryUpdatedAt: FRESH_TELEMETRY },
      }),
    ]);
    const row = rowFor("Aqua Palm Lock");
    expect(within(row).getByText("Online")).toBeTruthy();
    expect(within(row).queryByText("Stale telemetry")).toBeNull();
    expect(within(row).queryByText("Low battery")).toBeNull();
  });

  it("UNKNOWN renders the short 'Unknown' label — never implies offline", () => {
    renderLocks([
      makeLock({
        name: "Casa Del Mar Lock",
        status: "UNKNOWN",
        metadata: { telemetryUpdatedAt: FRESH_TELEMETRY },
      }),
    ]);
    const statusCell = statusCellFor("Casa Del Mar Lock");
    expect(within(statusCell).getByText("Unknown")).toBeTruthy();
    expect(
      within(rowFor("Casa Del Mar Lock")).queryByText(/offline/i),
    ).toBeNull();
  });

  it("OFFLINE renders the 'Offline' label", () => {
    renderLocks([
      makeLock({
        name: "Offline Lock",
        status: "OFFLINE",
        metadata: { telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    expect(within(rowFor("Offline Lock")).getByText("Offline")).toBeTruthy();
  });

  it("stale telemetry adds a small 'Stale telemetry' secondary badge, regardless of connectivity", () => {
    renderLocks([
      makeLock({
        name: "Online Stale Lock",
        status: "ONLINE",
        metadata: { telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    const row = rowFor("Online Stale Lock");
    expect(within(row).getByText("Online")).toBeTruthy();
    expect(within(row).getByText("Stale telemetry")).toBeTruthy();
  });

  it("low battery adds a small 'Low battery' secondary badge, regardless of connectivity", () => {
    renderLocks([
      makeLock({
        name: "Las Sirenas - Front Door",
        status: "UNKNOWN",
        metadata: { telemetryUpdatedAt: FRESH_TELEMETRY, batteryLevel: 19 },
      }),
    ]);
    const statusCell = statusCellFor("Las Sirenas - Front Door");
    expect(within(statusCell).getByText("Unknown")).toBeTruthy();
    expect(within(statusCell).getByText("Low battery")).toBeTruthy();
  });

  it("stale + low battery together render both secondary badges at once, never hiding one for the other", () => {
    renderLocks([
      makeLock({
        name: "Unknown Stale Low Battery Lock",
        status: "UNKNOWN",
        metadata: { batteryLevel: 12, telemetryUpdatedAt: STALE_TELEMETRY },
      }),
    ]);
    const row = rowFor("Unknown Stale Low Battery Lock");
    expect(within(row).getByText("Stale telemetry")).toBeTruthy();
    expect(within(row).getByText("Low battery")).toBeTruthy();
  });

  it("demo data still shows its own badge alongside the others", () => {
    renderLocks([
      makeLock({
        name: "Demo Lock",
        externalDeviceId: "demo-1",
        status: "ONLINE",
      }),
    ]);
    expect(within(rowFor("Demo Lock")).getByText("Demo data")).toBeTruthy();
  });
});

describe("LocksList — Lock state column", () => {
  it("renders a Locked badge for lockState 'locked'", () => {
    renderLocks([
      makeLock({ name: "Locked Door", metadata: { lockState: "locked" } }),
    ]);
    expect(within(rowFor("Locked Door")).getByText("Locked")).toBeTruthy();
  });

  it("renders an Unlocked badge for lockState 'unlocked'", () => {
    renderLocks([
      makeLock({ name: "Unlocked Door", metadata: { lockState: "unlocked" } }),
    ]);
    expect(within(rowFor("Unlocked Door")).getByText("Unlocked")).toBeTruthy();
  });

  it("renders an Unknown badge when lockState is not reported — never guessed", () => {
    renderLocks([makeLock({ name: "No State Door", metadata: {} })]);
    expect(within(rowFor("No State Door")).getByText("Unknown")).toBeTruthy();
  });
});

describe("LocksList — Battery column", () => {
  it("shows a quiet percentage for healthy battery", () => {
    renderLocks([
      makeLock({
        name: "Healthy Battery Lock",
        metadata: { batteryLevel: 82 },
      }),
    ]);
    expect(
      within(rowFor("Healthy Battery Lock")).getByText("82%"),
    ).toBeTruthy();
  });

  it("shows the percentage for low battery too (same compact indicator, different styling)", () => {
    renderLocks([
      makeLock({ name: "Low Battery Lock", metadata: { batteryLevel: 13 } }),
    ]);
    expect(within(rowFor("Low Battery Lock")).getByText("13%")).toBeTruthy();
  });

  it("shows a placeholder, never a fabricated value, when no battery data exists", () => {
    renderLocks([makeLock({ name: "No Battery Lock", metadata: {} })]);
    // Battery is the 4th cell: Property/Lock, Status, Lock state, Battery,
    // Last update — scoped by index since "—" also legitimately appears in
    // the Last update cell when there's no telemetry timestamp either.
    const cells = within(rowFor("No Battery Lock")).getAllByRole("cell");
    const batteryCell = cells[3];
    if (!batteryCell) throw new Error("Battery cell not found");
    expect(within(batteryCell).getByText("—")).toBeTruthy();
  });
});

// Metric labels can collide with a row's own Status label text (e.g. both
// a metric and a row can say "Offline") — scope to the one instance that's
// NOT inside a table row, since only the summary metrics live outside the
// <table>.
function metricValue(label: string): string {
  const labelNode = screen.getAllByText(label).find((el) => !el.closest("tr"));
  if (!labelNode) throw new Error(`Metric label "${label}" not found`);
  const card = labelNode.closest("div.bg-surface");
  if (!card) throw new Error(`Metric card for "${label}" not found`);
  const valueNode = card.querySelector(
    "div.font-display",
  ) as HTMLElement | null;
  if (!valueNode) throw new Error(`Metric value for "${label}" not found`);
  return valueNode.textContent ?? "";
}

describe("LocksList — summary metrics (derived, never hard-coded)", () => {
  it("computes Locks/Online/Offline/Unknown/Low battery/Needs attention from the real rows", () => {
    renderLocks([
      makeLock({ id: "a", name: "A", status: "ONLINE" }),
      makeLock({ id: "b", name: "B", status: "OFFLINE" }),
      makeLock({ id: "c", name: "C", status: "UNKNOWN" }),
      makeLock({
        id: "d",
        name: "D",
        status: "UNKNOWN",
        metadata: { batteryLevel: 5 },
      }),
    ]);
    expect(metricValue("Locks")).toBe("4");
    expect(metricValue("Online")).toBe("1");
    expect(metricValue("Offline")).toBe("1");
    expect(metricValue("Unknown")).toBe("2");
    expect(metricValue("Low battery")).toBe("1");
    // Offline(1) + low battery(1, distinct row) = 2 needing attention
    expect(metricValue("Needs attention")).toBe("2");
  });

  it("UNKNOWN connectivity alone does NOT count toward 'Needs attention'", () => {
    renderLocks([
      makeLock({
        name: "Just Unknown",
        status: "UNKNOWN",
        metadata: { telemetryUpdatedAt: FRESH_TELEMETRY },
      }),
    ]);
    // Only this one row, purely UNKNOWN/fresh/healthy-battery — "Needs
    // attention" must read 0.
    expect(metricValue("Needs attention")).toBe("0");
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

    const rowA = rowFor("Row A");
    const rowB = rowFor("Row B");

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

describe("LocksList — per-row physical lock-control gating", () => {
  it("renders no Lock/Unlock buttons when canControlLocks is omitted (default false) — existing behavior unchanged", () => {
    renderLocks([makeLock({ name: "Ungated Lock" })]);
    expect(screen.queryByRole("button", { name: /Lock/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  });

  it("renders no Lock/Unlock buttons when canControlLocks is true but no action is supplied", () => {
    render(
      <LocksList
        locks={[makeLock({ name: "No Command Action Lock" })] as never}
        canControlLocks={true}
      />,
    );
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  });

  it("renders both Lock and Unlock buttons for an August lock when canControlLocks + action are both supplied", () => {
    const action = vi.fn();
    render(
      <LocksList
        locks={
          [makeLock({ id: "lock-abc", name: "Controllable Lock" })] as never
        }
        canControlLocks={true}
        lockCommandAction={action}
      />,
    );
    expect(screen.getByRole("button", { name: "Lock" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  it("each row's controls target that exact row's own SmartDevice.id, never another row's — no fuzzy/derived targeting", () => {
    const action = vi.fn();
    render(
      <LocksList
        locks={
          [
            makeLock({ id: "lock-aaa", name: "Row A" }),
            makeLock({ id: "lock-bbb", name: "Row B" }),
          ] as never
        }
        canControlLocks={true}
        lockCommandAction={action}
      />,
    );

    const rowA = rowFor("Row A");
    const rowB = rowFor("Row B");

    expect(within(rowA).getAllByDisplayValue("lock-aaa")).toHaveLength(2); // one hidden input per control (Lock + Unlock)
    expect(within(rowB).getAllByDisplayValue("lock-bbb")).toHaveLength(2);
  });

  it("Lock/Unlock buttons are never shown for a non-August row even when gated on", () => {
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
        canControlLocks={true}
        lockCommandAction={action}
      />,
    );
    expect(screen.queryByRole("button", { name: "Lock" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Unlock" })).toBeNull();
  });

  it("Refresh and Lock/Unlock controls can both be gated on at once, independently", () => {
    const refreshAction = vi.fn();
    const commandAction = vi.fn();
    render(
      <LocksList
        locks={[makeLock({ name: "Fully Gated Lock" })] as never}
        canRefresh={true}
        spotRefreshAction={refreshAction}
        canControlLocks={true}
        lockCommandAction={commandAction}
      />,
    );
    expect(
      screen.getByRole("button", { name: "Refresh telemetry" }),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Lock" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });
});
