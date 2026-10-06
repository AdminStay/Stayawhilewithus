// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
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
    cleaningJobsNeedingCleaner: [],
    notionHighlights: { configured: false },
    ownerRezHighlights: { configured: false },
    ownerRezPropertyNames: {},
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

describe("DashboardSummary — OwnerRez card shows property names (2026-10-02)", () => {
  it("names each booking's property from StayWhile's linked properties; unlinked ids stay visibly numbered", () => {
    render(
      <DashboardSummary
        summary={baseSummary({
          ownerRezHighlights: {
            configured: true,
            ok: true,
            items: [
              {
                id: 16148058,
                property_id: 480401,
                status: "active",
                arrival: "2026-10-03",
                departure: "2026-10-06",
              },
              {
                id: 17031650,
                property_id: 389173,
                status: "active",
                arrival: "2026-10-04",
                departure: "2026-10-07",
              },
            ],
          } as never,
          ownerRezPropertyNames: { "480401": "Miramar Bliss" },
        })}
      />,
    );
    expect(screen.getByText("Miramar Bliss")).toBeTruthy();
    expect(screen.getByText("Unlinked OwnerRez property #389173")).toBeTruthy();
    expect(screen.getByText(/Booking #16148058/)).toBeTruthy();
  });
});

describe("DashboardSummary — OwnerRez card booking link (2026-10-03)", () => {
  it("links each booking to OwnerRez by its booking id", () => {
    render(
      <DashboardSummary
        summary={baseSummary({
          ownerRezHighlights: {
            configured: true,
            ok: true,
            items: [
              {
                id: 19458918,
                property_id: 386471,
                status: "active",
                arrival: "2026-10-03",
                departure: "2026-10-06",
              },
            ],
          } as never,
          ownerRezPropertyNames: { "386471": "Miramar Bliss" },
        })}
      />,
    );
    expect(
      screen
        .getByRole("link", { name: "Open booking #19458918 in OwnerRez" })
        .getAttribute("href"),
    ).toBe("https://secure.ownerreservations.com/bookings/19458918");
  });
});

describe("DashboardSummary — cleaning jobs needing attention (Cleaner Phase 5.3)", () => {
  const unassigned = (id: string) =>
    ({
      id,
      status: "SCHEDULED",
      cleanerId: null,
      scheduledDate: new Date("2026-10-10T00:00:00Z"),
      property: { name: "Harbor House" },
    }) as Summary["cleaningJobsNeedingCleaner"][number];

  it("shows ONE aggregated Needs Attention row with the count, reason and Needs cleaner badge", () => {
    render(
      <DashboardSummary
        summary={baseSummary({
          cleaningJobsNeedingCleaner: [
            unassigned("a"),
            unassigned("b"),
            unassigned("c"),
          ],
        })}
      />,
    );

    expect(screen.getAllByText("3 cleaning jobs need attention")).toHaveLength(
      1,
    );
    expect(
      screen.getByText("These jobs don't have a cleaner assigned."),
    ).toBeTruthy();
    expect(screen.getByText("Needs cleaner")).toBeTruthy();
  });

  it("links to the filtered cleaning list", () => {
    render(
      <DashboardSummary
        summary={baseSummary({ cleaningJobsNeedingCleaner: [unassigned("a")] })}
      />,
    );

    const link = screen
      .getByText("1 cleaning job needs attention")
      .closest("a");
    expect(link?.getAttribute("href")).toBe("/cleaning?view=needs-cleaner");
  });

  it("shows no cleaning attention row when no job needs a cleaner (or the viewer can't see cleaners)", () => {
    render(<DashboardSummary summary={baseSummary()} />);

    expect(screen.queryByText(/cleaning jobs? needs? attention/)).toBeNull();
    expect(screen.queryByText("Needs cleaner")).toBeNull();
  });
});

describe("DashboardSummary — reservation summary (Phase 6)", () => {
  const ownerRez = (overrides: Record<string, unknown> = {}) =>
    reservation({
      status: "CONFIRMED",
      source: "OWNERREZ",
      externalReservationId: "777",
      ...overrides,
    });

  it("each arrival/departure row shows property, guest, nights, status and the OwnerRez link", () => {
    render(
      <DashboardSummary
        summary={baseSummary({
          arrivalsToday: [ownerRez({ id: "arr-1" })] as never,
          departuresToday: [
            ownerRez({
              id: "dep-1",
              status: "CHECKED_IN",
              externalReservationId: "888",
              primaryGuest: { firstName: "Sam", lastName: "Lee" },
              property: { name: "Bonjour AMI" },
              checkInDate: new Date("2026-10-01T00:00:00.000Z"),
              checkOutDate: new Date("2026-10-06T00:00:00.000Z"),
            }),
          ] as never,
        })}
      />,
    );

    expect(screen.getByText("Jane Doe")).toBeTruthy();
    expect(screen.getByText("Aqua Palm")).toBeTruthy();
    expect(screen.getByText("3 nights")).toBeTruthy();
    expect(screen.getByText("Confirmed")).toBeTruthy();
    expect(screen.getByText("Sam Lee")).toBeTruthy();
    expect(screen.getByText("Bonjour AMI")).toBeTruthy();
    expect(screen.getByText("5 nights")).toBeTruthy();
    expect(screen.getByText("Checked in")).toBeTruthy();
    const links = screen
      .getAllByRole("link", { name: "Open this booking in OwnerRez" })
      .map((a) => a.getAttribute("href"));
    expect(links).toEqual([
      "https://secure.ownerreservations.com/bookings/777",
      "https://secure.ownerreservations.com/bookings/888",
    ]);
  });

  it('has a "View all" link to /reservations?view=today', () => {
    render(<DashboardSummary summary={baseSummary()} />);

    const section = screen
      .getByText("Today's Check-ins & Check-outs")
      .closest("div")!.parentElement!;
    const viewAll = within(section).getByRole("link", { name: "View all" });
    expect(viewAll.getAttribute("href")).toBe("/reservations?view=today");
  });

  it("keeps the honest empty states (and View all) when there are no reservations today", () => {
    render(<DashboardSummary summary={baseSummary()} />);

    expect(screen.getByText("No arrivals today.")).toBeTruthy();
    expect(screen.getByText("No check-outs today.")).toBeTruthy();
    expect(
      screen.queryByRole("link", { name: "Open this booking in OwnerRez" }),
    ).toBeNull();
    expect(
      document.querySelector('a[href="/reservations?view=today"]'),
    ).toBeTruthy();
  });

  it("offers no reservation status control on the dashboard", () => {
    const { container } = render(
      <DashboardSummary
        summary={baseSummary({
          arrivalsToday: [
            reservation({
              status: "PENDING",
              source: "DIRECT",
              externalReservationId: "x",
            }),
          ] as never,
        })}
      />,
    );

    expect(container.querySelector('select[name="status"]')).toBeNull();
  });
});
