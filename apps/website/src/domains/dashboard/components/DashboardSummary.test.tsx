// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DashboardSummary } from "./DashboardSummary";

afterEach(cleanup);

type Summary = Parameters<typeof DashboardSummary>[0]["summary"];

const EMPTY_TEAM_AVAILABILITY = {
  lastSyncedAt: null,
  isStale: true,
  lastFetchError: null,
  workingNow: [],
  comingUp: [],
  off: [],
  unmappedCount: 0,
};

/**
 * Minimal but fully-shaped Summary fixture — every field
 * getDashboardSummary() actually returns, defaulted to the "nothing yet"
 * state. Individual tests override only the fields relevant to what
 * they're proving (real reservation consumption + honest empty states),
 * matching the same "construct the full shape once, override narrowly"
 * pattern used elsewhere in this codebase's larger fixtures.
 */
function baseSummary(overrides: Partial<Summary> = {}): Summary {
  return {
    properties: [],
    guests: [],
    reservations: [],
    tasks: [],
    cleaningSchedules: [],
    maintenanceRequests: [],
    notifications: [],
    messageThreads: [],
    pendingAiActions: [],
    integrationConnections: [],
    recentAiConversations: [],
    smartDevices: [],
    locks: [],
    thermostats: [],
    devicesNeedingAttention: [],
    offlineDeviceCount: 0,
    lowBatteryDeviceCount: 0,
    hasLiveDeviceData: false,
    recentlyRescheduledCleanings: [],
    notionHighlights: { configured: false },
    ownerRezHighlights: { configured: false },
    teamAvailability: EMPTY_TEAM_AVAILABILITY,
    openTasks: [],
    upcomingCleaningSchedules: [],
    openMaintenanceRequests: [],
    unreadNotifications: [],
    connectedIntegrations: [],
    arrivalsToday: [],
    departuresToday: [],
    upcomingCheckIns: [],
    upcomingCheckOuts: [],
    occupancyRate: 0,
    occupiedPropertyCount: 0,
    tasksDueToday: [],
    cleaningToday: [],
    ...overrides,
  } as Summary;
}

function reservation(overrides: Record<string, unknown> = {}) {
  return {
    id: "res-1",
    primaryGuest: { firstName: "Jane", lastName: "Doe" },
    property: { name: "Aqua Palm" },
    checkInDate: new Date("2026-09-24T00:00:00.000Z"),
    checkOutDate: new Date("2026-09-27T00:00:00.000Z"),
    ...overrides,
  };
}

describe("DashboardSummary — real reservation data consumption and honest empty states", () => {
  it("always renders Today's Check-ins & Check-outs, with an honest empty state when there is no reservation data at all (the real Production condition this was fixed for)", () => {
    render(<DashboardSummary summary={baseSummary()} />);

    expect(screen.getByText("Today's Check-ins & Check-outs")).toBeTruthy();
    expect(screen.getByText("No arrivals today.")).toBeTruthy();
    expect(screen.getByText("No check-outs today.")).toBeTruthy();
  });

  it("always renders Coming Up, with an honest empty state when there is no upcoming reservation data", () => {
    render(<DashboardSummary summary={baseSummary()} />);

    expect(screen.getByText("Coming Up")).toBeTruthy();
    expect(screen.getByText("No upcoming check-ins.")).toBeTruthy();
    expect(screen.getByText("No upcoming check-outs.")).toBeTruthy();
  });

  it("shows a real arrival and a real departure once the summary actually contains them", () => {
    render(
      <DashboardSummary
        summary={baseSummary({
          arrivalsToday: [reservation({ id: "arr-1" })] as never,
          departuresToday: [
            reservation({
              id: "dep-1",
              primaryGuest: { firstName: "Sam", lastName: "Lee" },
              property: { name: "Bonjour AMI" },
            }),
          ] as never,
        })}
      />,
    );

    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("Aqua Palm")).toBeTruthy();
    expect(screen.getByText("Sam Lee")).toBeTruthy();
    expect(screen.getByText("Bonjour AMI")).toBeTruthy();
    expect(screen.queryByText("No arrivals today.")).toBeNull();
    expect(screen.queryByText("No check-outs today.")).toBeNull();
  });

  it("shows a real upcoming check-in once the summary actually contains one", () => {
    const { container } = render(
      <DashboardSummary
        summary={baseSummary({
          upcomingCheckIns: [
            reservation({ id: "up-1", property: { name: "Ocean Pearl" } }),
          ] as never,
        })}
      />,
    );

    // Property name renders alongside a formatted date in the same <span>
    // (split by a <br />), so this checks substring containment rather than
    // exact getByText matching.
    expect(container.textContent).toContain("Ocean Pearl");
    expect(screen.queryByText("No upcoming check-ins.")).toBeNull();
    // The other column, still genuinely empty, keeps its own honest message.
    expect(screen.getByText("No upcoming check-outs.")).toBeTruthy();
  });

  it("Rescheduled Cleanings stays positioned between Important Tasks and Today's Check-ins & Check-outs", () => {
    const { container } = render(<DashboardSummary summary={baseSummary()} />);
    const text = container.textContent ?? "";
    const importantIdx = text.indexOf("Important Tasks");
    const rescheduledIdx = text.indexOf("Rescheduled Cleanings");
    const checkInsIdx = text.indexOf("Today's Check-ins & Check-outs");
    expect(importantIdx).toBeGreaterThan(-1);
    expect(rescheduledIdx).toBeGreaterThan(importantIdx);
    expect(checkInsIdx).toBeGreaterThan(rescheduledIdx);
  });
});
