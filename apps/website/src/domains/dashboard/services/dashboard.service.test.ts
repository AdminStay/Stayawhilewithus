import { afterEach, describe, expect, it, vi } from "vitest";

// @stayw/auth's rbac.ts imports @stayw/database (server-only) for real
// permission checks; Vitest externalizes that cross-package import so the
// global `server-only` mock in vitest.setup.mts doesn't reach it. Mock the
// whole package at the boundary instead, same pattern as
// domains/properties/ai-tools.test.ts mocking @stayw/ai.
vi.mock("@stayw/auth", () => ({
  ForbiddenError: class ForbiddenError extends Error {},
}));

vi.mock("@/domains/ai/services/ai.service", () => ({
  listAiConversations: vi.fn(),
  listPendingAiActions: vi.fn(),
}));
vi.mock("@/domains/cleaning/services/cleaning.service", () => ({
  listCleaningJobsNeedingCleaner: vi.fn(),
  listCleaningSchedules: vi.fn(),
  listRecentlyRescheduledCleanings: vi.fn(),
}));
vi.mock("@/domains/communications/services/communications.service", () => ({
  listMessageThreads: vi.fn(),
}));
vi.mock("@/domains/guests/services/guests.service", () => ({
  listGuests: vi.fn(),
}));
vi.mock("@/domains/integrations/services/integrations.service", () => ({
  listIntegrationConnections: vi.fn(),
  getNotionHighlights: vi.fn(),
  getOwnerRezHighlights: vi.fn(),
}));
vi.mock("@/domains/smart-devices/services/smart-devices.service", () => ({
  listSmartDevices: vi.fn(),
  isLowBattery: (device: { metadata: Record<string, unknown> | null }) => {
    const level = device.metadata?.batteryLevel;
    return typeof level === "number" && level < 20;
  },
  isDemoSmartDevice: (device: { externalDeviceId: string }) =>
    device.externalDeviceId.startsWith("demo-"),
  isTelemetryStale: (device: { metadata: Record<string, unknown> | null }) => {
    const value = device.metadata?.telemetryUpdatedAt;
    if (typeof value !== "string") return false;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return false;
    return Date.now() - parsed.getTime() > 24 * 60 * 60 * 1000;
  },
}));
vi.mock("@/domains/maintenance/services/maintenance.service", () => ({
  listMaintenanceRequests: vi.fn(),
}));
vi.mock("@/domains/notifications/services/notifications.service", () => ({
  listNotifications: vi.fn(),
}));
vi.mock("@/domains/properties/services/properties.service", () => ({
  listProperties: vi.fn(),
}));
vi.mock("@/domains/reservations/services/reservations.service", () => ({
  listReservations: vi.fn(),
}));
vi.mock("@/domains/tasks/services/tasks.service", () => ({
  listTasks: vi.fn(),
}));
vi.mock("@/domains/team/services/schedule.service", () => ({
  getTeamAvailabilitySnapshot: vi.fn(),
}));

import { ForbiddenError } from "@stayw/auth";

import { getDashboardSummary } from "./dashboard.service";

import {
  listAiConversations,
  listPendingAiActions,
} from "@/domains/ai/services/ai.service";
import {
  listCleaningJobsNeedingCleaner,
  listCleaningSchedules,
  listRecentlyRescheduledCleanings,
} from "@/domains/cleaning/services/cleaning.service";
import { listMessageThreads } from "@/domains/communications/services/communications.service";
import { listGuests } from "@/domains/guests/services/guests.service";
import {
  getNotionHighlights,
  getOwnerRezHighlights,
  listIntegrationConnections,
} from "@/domains/integrations/services/integrations.service";
import { listMaintenanceRequests } from "@/domains/maintenance/services/maintenance.service";
import { listNotifications } from "@/domains/notifications/services/notifications.service";
import { listProperties } from "@/domains/properties/services/properties.service";
import { listReservations } from "@/domains/reservations/services/reservations.service";
import { listSmartDevices } from "@/domains/smart-devices/services/smart-devices.service";
import { listTasks } from "@/domains/tasks/services/tasks.service";
import { getTeamAvailabilitySnapshot } from "@/domains/team/services/schedule.service";

const actor = { userId: "user-1" };

// Reservations are compared against each property's own local today
// (2026-10-02). Fixtures use the test machine's own timezone so "today"
// matches TODAY below, and an operational status.
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
const OPERATIONAL_IN_LOCAL_TZ = {
  timezone: LOCAL_TZ,
  status: "ACTIVE",
  deletedAt: null,
} as const;

const now = new Date();
const TODAY = new Date(
  Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
);
function daysFromToday(n: number): Date {
  const d = new Date(TODAY);
  d.setUTCDate(d.getUTCDate() + n);
  return d;
}

function mockAllLists() {
  vi.mocked(listCleaningJobsNeedingCleaner).mockResolvedValue([] as never);
  vi.mocked(listProperties).mockResolvedValue([
    { id: "p1", status: "ACTIVE", deletedAt: null },
    { id: "p2", status: "ACTIVE", deletedAt: null },
  ] as never);
  vi.mocked(listGuests).mockResolvedValue([] as never);
  vi.mocked(listReservations).mockResolvedValue([
    {
      id: "r1",
      propertyId: "p1",
      status: "CONFIRMED",
      checkInDate: TODAY,
      checkOutDate: daysFromToday(4),
      property: { name: "Cabin on the Ridge", ...OPERATIONAL_IN_LOCAL_TZ },
      primaryGuest: { firstName: "Jordan", lastName: "Rivera" },
    },
    {
      id: "r2",
      propertyId: "p2",
      status: "CHECKED_IN",
      checkInDate: daysFromToday(-3),
      checkOutDate: TODAY,
      property: { name: "Downtown Loft", ...OPERATIONAL_IN_LOCAL_TZ },
      primaryGuest: { firstName: "Casey", lastName: "Nguyen" },
    },
    {
      id: "r3",
      propertyId: "p2",
      status: "CANCELLED",
      checkInDate: TODAY,
      checkOutDate: daysFromToday(2),
      property: { name: "Downtown Loft", ...OPERATIONAL_IN_LOCAL_TZ },
      primaryGuest: { firstName: "Skip", lastName: "Me" },
    },
  ] as never);
  vi.mocked(listTasks).mockResolvedValue([
    { id: "t1", status: "TODO", dueAt: null, property: null },
    {
      id: "t2",
      status: "DONE",
      dueAt: TODAY,
      property: OPERATIONAL_IN_LOCAL_TZ,
    },
    {
      id: "t3",
      status: "TODO",
      dueAt: TODAY,
      property: OPERATIONAL_IN_LOCAL_TZ,
    },
  ] as never);
  vi.mocked(listCleaningSchedules).mockResolvedValue([
    {
      id: "c1",
      status: "SCHEDULED",
      scheduledDate: TODAY,
      property: OPERATIONAL_IN_LOCAL_TZ,
    },
    {
      id: "c2",
      status: "COMPLETED",
      scheduledDate: daysFromToday(-1),
      property: OPERATIONAL_IN_LOCAL_TZ,
    },
  ] as never);
  vi.mocked(listMaintenanceRequests).mockResolvedValue([
    { id: "m1", status: "OPEN" },
    { id: "m2", status: "RESOLVED" },
  ] as never);
  vi.mocked(listNotifications).mockResolvedValue([
    { id: "n1", readAt: null },
    { id: "n2", readAt: new Date() },
  ] as never);
  vi.mocked(listMessageThreads).mockResolvedValue([{ id: "th1" }] as never);
  vi.mocked(listPendingAiActions).mockResolvedValue([{ id: "a1" }] as never);
  vi.mocked(listAiConversations).mockResolvedValue(
    Array.from({ length: 7 }, (_, i) => ({
      id: `conv${i}`,
      subject: `Conversation ${i}`,
      updatedAt: new Date(),
      messages: [{ content: "hi" }],
    })) as never,
  );
  vi.mocked(listIntegrationConnections).mockResolvedValue([
    { id: "ic1", status: "CONNECTED" },
    { id: "ic2", status: "DISCONNECTED" },
  ] as never);
  vi.mocked(listSmartDevices).mockResolvedValue([
    {
      id: "d1",
      provider: "AUGUST",
      deviceType: "LOCK",
      status: "ONLINE",
      metadata: { batteryLevel: 85 },
      externalDeviceId: "demo-august-1",
    },
    {
      id: "d2",
      provider: "AUGUST",
      deviceType: "LOCK",
      status: "OFFLINE",
      metadata: {},
      externalDeviceId: "demo-august-2",
    },
    {
      id: "d3",
      provider: "AUGUST",
      deviceType: "LOCK",
      status: "ONLINE",
      metadata: { batteryLevel: 15 },
      externalDeviceId: "demo-august-3",
    },
    {
      id: "d4",
      provider: "CIELO",
      deviceType: "THERMOSTAT",
      status: "ONLINE",
      metadata: {},
      externalDeviceId: "demo-cielo-4",
    },
    {
      id: "d5",
      provider: "CIELO",
      deviceType: "THERMOSTAT",
      status: "OFFLINE",
      metadata: {},
      externalDeviceId: "demo-cielo-5",
    },
  ] as never);
  vi.mocked(listRecentlyRescheduledCleanings).mockResolvedValue([
    { id: "rc1" },
  ] as never);
  vi.mocked(getNotionHighlights).mockResolvedValue({
    configured: false,
  } as never);
  vi.mocked(getOwnerRezHighlights).mockResolvedValue({
    configured: false,
  } as never);
  vi.mocked(getTeamAvailabilitySnapshot).mockResolvedValue({
    lastSyncedAt: null,
    isStale: true,
    lastFetchError: null,
    workingNow: [],
    comingUp: [],
    off: [],
    unmappedCount: 0,
  } as never);
}

describe("getDashboardSummary", () => {
  it("composes summary data and derived filters from every domain's own service", async () => {
    mockAllLists();

    const summary = await getDashboardSummary(actor);

    expect(summary.properties).toHaveLength(2);
    expect(summary.openTasks.map((t) => t.id)).toEqual(["t1", "t3"]);
    expect(summary.upcomingCleaningSchedules).toEqual([
      expect.objectContaining({ id: "c1", status: "SCHEDULED" }),
    ]);
    expect(summary.openMaintenanceRequests).toEqual([
      { id: "m1", status: "OPEN" },
    ]);
    expect(summary.unreadNotifications).toEqual([{ id: "n1", readAt: null }]);
    expect(summary.messageThreads).toHaveLength(1);
    expect(summary.pendingAiActions).toHaveLength(1);
    expect(summary.connectedIntegrations).toEqual([
      { id: "ic1", status: "CONNECTED" },
    ]);
  });

  it("summarizes device health: offline lock, low-battery lock, and offline thermostat all count as needing attention", async () => {
    mockAllLists();

    const summary = await getDashboardSummary(actor);

    expect(summary.locks).toHaveLength(3);
    expect(summary.thermostats).toHaveLength(2);
    // d2 (offline lock), d3 (low-battery lock), d5 (offline thermostat).
    expect(summary.devicesNeedingAttention.map((d) => d.id)).toEqual([
      "d2",
      "d3",
      "d5",
    ]);
    expect(summary.offlineDeviceCount).toBe(2);
    expect(summary.lowBatteryDeviceCount).toBe(1);
  });

  it("UNKNOWN connectivity is not counted as Offline and does not appear in Needs Attention on its own — but stale telemetry on an UNKNOWN device still does (regression: this was the real production bug)", async () => {
    mockAllLists();
    // Overrides the persistent smart-devices mock above with a one-time
    // return value for this test's single call — mockResolvedValueOnce is
    // always consumed first regardless of setup order.
    vi.mocked(listSmartDevices).mockResolvedValueOnce([
      {
        id: "d1",
        provider: "AUGUST",
        deviceType: "LOCK",
        status: "ONLINE",
        metadata: {},
        externalDeviceId: "lock-1",
      },
      {
        id: "d2",
        provider: "AUGUST",
        deviceType: "LOCK",
        status: "UNKNOWN",
        metadata: { telemetryUpdatedAt: new Date().toISOString() },
        externalDeviceId: "lock-2",
      },
      {
        id: "d3",
        provider: "AUGUST",
        deviceType: "LOCK",
        status: "UNKNOWN",
        metadata: {
          telemetryUpdatedAt: new Date(
            Date.now() - 46 * 60 * 60 * 1000,
          ).toISOString(),
        },
        externalDeviceId: "lock-3",
      },
      {
        id: "d4",
        provider: "AUGUST",
        deviceType: "LOCK",
        status: "OFFLINE",
        metadata: {},
        externalDeviceId: "lock-4",
      },
    ] as never);

    const summary = await getDashboardSummary(actor);

    // d2: UNKNOWN, fresh telemetry — not offline, not needing attention.
    // d3: UNKNOWN, stale telemetry — not offline, but DOES need attention.
    // d4: explicit OFFLINE — counted and needs attention.
    expect(summary.offlineDeviceCount).toBe(1);
    expect(summary.devicesNeedingAttention.map((d) => d.id)).toEqual([
      "d3",
      "d4",
    ]);
  });

  it("reports device data as not live when every device row is still seed data (a demo-prefixed externalDeviceId)", async () => {
    mockAllLists();

    const summary = await getDashboardSummary(actor);

    expect(summary.hasLiveDeviceData).toBe(false);
  });

  it("reports device data as live the moment any row's externalDeviceId isn't demo-prefixed (i.e. came from a real sync)", async () => {
    mockAllLists();
    vi.mocked(listSmartDevices).mockResolvedValueOnce([
      {
        id: "d1",
        provider: "AUGUST",
        deviceType: "LOCK",
        status: "ONLINE",
        metadata: {},
        externalDeviceId: "demo-august-1",
      },
      // A real August lockId — never "demo-"-prefixed — proves
      // hasLiveDeviceData flips true per-row, independent of any other
      // still-seeded rows sitting alongside it.
      {
        id: "d2",
        provider: "AUGUST",
        deviceType: "LOCK",
        status: "ONLINE",
        metadata: {},
        externalDeviceId: "a1b2c3d4-real-lock-id",
      },
    ] as never);

    const summary = await getDashboardSummary(actor);

    expect(summary.hasLiveDeviceData).toBe(true);
  });

  it("passes through recently rescheduled cleanings and not-configured integration highlights", async () => {
    mockAllLists();

    const summary = await getDashboardSummary(actor);

    expect(summary.recentlyRescheduledCleanings).toEqual([{ id: "rc1" }]);
    expect(summary.notionHighlights).toEqual({ configured: false });
    expect(summary.ownerRezHighlights).toEqual({ configured: false });
    expect(summary.teamAvailability.workingNow).toEqual([]);
  });

  it("degrades team availability to the same empty/unstale-free fallback when the actor lacks team:read, instead of failing the whole summary", async () => {
    mockAllLists();
    vi.mocked(getTeamAvailabilitySnapshot).mockRejectedValueOnce(
      new ForbiddenError("team:read"),
    );

    const summary = await getDashboardSummary(actor);

    expect(summary.teamAvailability).toEqual({
      lastSyncedAt: null,
      isStale: true,
      lastFetchError: null,
      workingNow: [],
      comingUp: [],
      off: [],
      unmappedCount: 0,
    });
    expect(summary.properties).toHaveLength(2);
  });

  it("computes today's operational metrics from reservations/tasks/cleaning schedules", async () => {
    mockAllLists();

    const summary = await getDashboardSummary(actor);

    // r1 (CONFIRMED, checks in today) counts as an arrival; the CANCELLED
    // reservation checking in today does not.
    expect(summary.arrivalsToday.map((r) => r.id)).toEqual(["r1"]);
    // r2 (CHECKED_IN, checks out today) counts as a departure.
    expect(summary.departuresToday.map((r) => r.id)).toEqual(["r2"]);
    // Both p1 (via r1, arriving today) and p2 (via r2, still checked in
    // through today) are occupied today — 2 of 2 properties.
    expect(summary.occupiedPropertyCount).toBe(2);
    expect(summary.occupancyRate).toBe(1);
    // t3 is TODO and due today; t2 is DONE (excluded) despite also being
    // due today; t1 has no dueAt at all.
    expect(summary.tasksDueToday.map((t) => t.id)).toEqual(["t3"]);
    expect(summary.cleaningToday.map((c) => c.id)).toEqual(["c1"]);
    // Capped at 5 even though 7 conversations exist.
    expect(summary.recentAiConversations).toHaveLength(5);
  });

  it("surfaces upcoming (not-today) check-ins/check-outs within the lookahead window, chronologically", async () => {
    mockAllLists();
    vi.mocked(listReservations).mockResolvedValueOnce([
      // Arrives in 3 days — within window.
      {
        id: "future-arrival-near",
        propertyId: "p1",
        status: "CONFIRMED",
        checkInDate: daysFromToday(3),
        checkOutDate: daysFromToday(7),
        property: { name: "Cabin on the Ridge", ...OPERATIONAL_IN_LOCAL_TZ },
        primaryGuest: { firstName: "A", lastName: "A" },
      },
      // Arrives in 1 day — within window, and earlier than the one above.
      {
        id: "future-arrival-far",
        propertyId: "p1",
        status: "PENDING",
        checkInDate: daysFromToday(1),
        checkOutDate: daysFromToday(5),
        property: { name: "Cabin on the Ridge", ...OPERATIONAL_IN_LOCAL_TZ },
        primaryGuest: { firstName: "B", lastName: "B" },
      },
      // Arrives in 10 days — outside the 6-day window.
      {
        id: "too-far-out",
        propertyId: "p1",
        status: "CONFIRMED",
        checkInDate: daysFromToday(10),
        checkOutDate: daysFromToday(12),
        property: { name: "Cabin on the Ridge", ...OPERATIONAL_IN_LOCAL_TZ },
        primaryGuest: { firstName: "C", lastName: "C" },
      },
      // Departs in 2 days — within window.
      {
        id: "future-departure",
        propertyId: "p2",
        status: "CHECKED_IN",
        checkInDate: daysFromToday(-1),
        checkOutDate: daysFromToday(2),
        property: { name: "Downtown Loft", ...OPERATIONAL_IN_LOCAL_TZ },
        primaryGuest: { firstName: "D", lastName: "D" },
      },
      // Cancelled, arrives tomorrow — should never appear.
      {
        id: "cancelled-future",
        propertyId: "p1",
        status: "CANCELLED",
        checkInDate: daysFromToday(1),
        checkOutDate: daysFromToday(3),
        property: { name: "Cabin on the Ridge", ...OPERATIONAL_IN_LOCAL_TZ },
        primaryGuest: { firstName: "E", lastName: "E" },
      },
    ] as never);

    const summary = await getDashboardSummary(actor);

    // Sorted soonest-first: arrives in 1 day, then arrives in 3 days.
    // "too-far-out" (10 days) and the cancelled one are excluded.
    expect(summary.upcomingCheckIns.map((r) => r.id)).toEqual([
      "future-arrival-far",
      "future-arrival-near",
    ]);
    // future-departure checks out day 2; future-arrival-far *also* checks
    // out within the window, on day 5 (a distinct future event from its
    // day-1 check-in) — both are genuinely upcoming departures.
    expect(summary.upcomingCheckOuts.map((r) => r.id)).toEqual([
      "future-departure",
      "future-arrival-far",
    ]);
  });

  describe("property-local today + operational properties (2026-10-02)", () => {
    const chicago = (status = "ACTIVE") => ({
      name: "Gulf House",
      timezone: "America/Chicago",
      status,
      deletedAt: null,
    });
    const day = (ymd: string) => new Date(`${ymd}T00:00:00.000Z`);
    const res = (
      id: string,
      checkIn: string,
      checkOut: string,
      property = chicago(),
    ) => ({
      id,
      propertyId: "p1",
      status: "CONFIRMED",
      checkInDate: day(checkIn),
      checkOutDate: day(checkOut),
      property,
      primaryGuest: { firstName: "G", lastName: "G" },
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("9:30 PM Central on Oct 1 is still Oct 1 for a Central property (UTC is already Oct 2)", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T02:30:00Z"));
      mockAllLists();
      vi.mocked(listReservations).mockResolvedValueOnce([
        res("arrives-oct-1", "2026-10-01", "2026-10-04"),
        res("arrives-oct-2", "2026-10-02", "2026-10-05"),
        res("departs-oct-1", "2026-09-28", "2026-10-01"),
      ] as never);

      const summary = await getDashboardSummary(actor);

      expect(summary.arrivalsToday.map((r) => r.id)).toEqual(["arrives-oct-1"]);
      expect(summary.departuresToday.map((r) => r.id)).toEqual([
        "departs-oct-1",
      ]);
      // Oct 2 is tomorrow locally, so it's upcoming, not today.
      expect(summary.upcomingCheckIns.map((r) => r.id)).toEqual([
        "arrives-oct-2",
      ]);
    });

    it("tasks due today and cleaning today use the local date too, not UTC (2026-10-07)", async () => {
      // 9:30 PM Central on Oct 1 — UTC is already Oct 2.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T02:30:00Z"));
      mockAllLists();
      vi.mocked(listTasks).mockResolvedValueOnce([
        {
          id: "oct-1",
          status: "TODO",
          dueAt: day("2026-10-01"),
          property: chicago(),
        },
        {
          id: "oct-2",
          status: "TODO",
          dueAt: day("2026-10-02"),
          property: chicago(),
        },
        // No property → StayWhile's operating timezone (America/Chicago).
        {
          id: "no-property",
          status: "TODO",
          dueAt: day("2026-10-01"),
          property: null,
        },
        // Unresolvable property zone → also the operating timezone.
        {
          id: "bad-tz",
          status: "IN_PROGRESS",
          dueAt: day("2026-10-01"),
          property: { ...chicago(), timezone: "Not/AZone" },
        },
      ] as never);
      vi.mocked(listCleaningSchedules).mockResolvedValueOnce([
        {
          id: "clean-oct-1",
          status: "SCHEDULED",
          scheduledDate: day("2026-10-01"),
          property: chicago(),
        },
        {
          id: "clean-oct-2",
          status: "SCHEDULED",
          scheduledDate: day("2026-10-02"),
          property: chicago(),
        },
        // A cleaning's zone is never guessed: unresolvable → left out.
        {
          id: "clean-bad-tz",
          status: "SCHEDULED",
          scheduledDate: day("2026-10-01"),
          property: { ...chicago(), timezone: "Not/AZone" },
        },
      ] as never);

      const summary = await getDashboardSummary(actor);

      expect(summary.tasksDueToday.map((t) => t.id)).toEqual([
        "oct-1",
        "no-property",
        "bad-tz",
      ]);
      expect(summary.cleaningToday.map((c) => c.id)).toEqual(["clean-oct-1"]);
    });

    it("an Eastern property's cleaning rolls over at Eastern midnight, not UTC", async () => {
      // 11:30 PM Eastern Oct 1 = 03:30 UTC Oct 2.
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-02T03:30:00Z"));
      mockAllLists();
      const eastern = { ...chicago(), timezone: "America/New_York" };
      vi.mocked(listCleaningSchedules).mockResolvedValueOnce([
        {
          id: "e-oct-1",
          status: "SCHEDULED",
          scheduledDate: day("2026-10-01"),
          property: eastern,
        },
        {
          id: "e-oct-2",
          status: "SCHEDULED",
          scheduledDate: day("2026-10-02"),
          property: eastern,
        },
      ] as never);

      const summary = await getDashboardSummary(actor);

      expect(summary.cleaningToday.map((c) => c.id)).toEqual(["e-oct-1"]);
    });

    it("operationalPropertyCount counts ACTIVE + ONBOARDING only (the Properties tile)", async () => {
      mockAllLists();
      vi.mocked(listProperties).mockResolvedValueOnce([
        { id: "a", status: "ACTIVE", deletedAt: null },
        { id: "o", status: "ONBOARDING", deletedAt: null },
        { id: "i", status: "INACTIVE", deletedAt: null },
        { id: "x", status: "OFFBOARDED", deletedAt: null },
      ] as never);

      const summary = await getDashboardSummary(actor);

      expect(summary.operationalPropertyCount).toBe(2);
      expect(summary.properties).toHaveLength(4);
    });

    it("ONBOARDING counts; INACTIVE, OFFBOARDED and deleted properties don't", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T15:00:00Z"));
      mockAllLists();
      vi.mocked(listReservations).mockResolvedValueOnce([
        res("active", "2026-10-01", "2026-10-03", chicago("ACTIVE")),
        res("onboarding", "2026-10-01", "2026-10-03", chicago("ONBOARDING")),
        res("inactive", "2026-10-01", "2026-10-03", chicago("INACTIVE")),
        res("offboarded", "2026-10-01", "2026-10-03", chicago("OFFBOARDED")),
        res("deleted", "2026-10-01", "2026-10-03", {
          ...chicago("ACTIVE"),
          deletedAt: new Date("2026-09-01"),
        } as never),
      ] as never);

      const summary = await getDashboardSummary(actor);

      expect(summary.arrivalsToday.map((r) => r.id).sort()).toEqual([
        "active",
        "onboarding",
      ]);
    });

    it("a property whose timezone can't be resolved is left out of the date lists, not guessed", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-10-01T15:00:00Z"));
      mockAllLists();
      vi.mocked(listReservations).mockResolvedValueOnce([
        res("bad-tz", "2026-10-01", "2026-10-03", {
          ...chicago(),
          timezone: "Not/AZone",
        }),
      ] as never);

      const summary = await getDashboardSummary(actor);

      expect(summary.arrivalsToday).toEqual([]);
    });

    it("maps OwnerRez property ids to StayWhile property names for the OwnerRez card", async () => {
      mockAllLists();
      vi.mocked(listProperties).mockResolvedValueOnce([
        {
          id: "p1",
          name: "Miramar Bliss",
          ownerRezPropertyId: "480401",
          status: "ONBOARDING",
          deletedAt: null,
        },
        {
          id: "p2",
          name: "Manual Only",
          ownerRezPropertyId: null,
          status: "ACTIVE",
          deletedAt: null,
        },
      ] as never);

      const summary = await getDashboardSummary(actor);

      expect(summary.ownerRezPropertyNames).toEqual({
        "480401": "Miramar Bliss",
      });
    });
  });

  it("degrades a permission-denied domain to an empty list instead of failing the whole summary", async () => {
    mockAllLists();
    vi.mocked(listMaintenanceRequests).mockRejectedValueOnce(
      new ForbiddenError("maintenance_requests:read"),
    );

    const summary = await getDashboardSummary(actor);

    expect(summary.maintenanceRequests).toEqual([]);
    expect(summary.openMaintenanceRequests).toEqual([]);
    expect(summary.properties).toHaveLength(2);
  });

  it("propagates a non-permission error instead of swallowing it", async () => {
    mockAllLists();
    vi.mocked(listTasks).mockRejectedValueOnce(new Error("db down"));

    await expect(getDashboardSummary(actor)).rejects.toThrow("db down");
  });
});

describe("getDashboardSummary — cleaning jobs needing a cleaner (Cleaner Phase 5.3)", () => {
  afterEach(() => vi.resetAllMocks());

  it("passes through the open, unassigned cleaning jobs from the cleaning service", async () => {
    mockAllLists();
    const jobs = [
      { id: "cs1", status: "SCHEDULED", cleanerId: null },
      { id: "cs2", status: "SCHEDULED", cleanerId: null },
    ];
    vi.mocked(listCleaningJobsNeedingCleaner).mockResolvedValue(jobs as never);

    const summary = await getDashboardSummary(actor);

    expect(listCleaningJobsNeedingCleaner).toHaveBeenCalledWith(actor);
    expect(summary.cleaningJobsNeedingCleaner).toEqual(jobs);
  });

  it("degrades to an empty list (no attention row) for a viewer without the cleaning/cleaner permissions", async () => {
    mockAllLists();
    vi.mocked(listCleaningJobsNeedingCleaner).mockRejectedValue(
      new ForbiddenError("cleaners:read"),
    );

    const summary = await getDashboardSummary(actor);

    expect(summary.cleaningJobsNeedingCleaner).toEqual([]);
  });
});
