// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  listCleaningSchedules: vi.fn(),
  canChangeCleaningCleaner: vi.fn(),
  listCurrentPropertyCleanerOptions: vi.fn(),
  listActiveCleanerOptions: vi.fn(),
  listLatestCleanerNotifications: vi.fn(),
}));

vi.mock("@stayw/auth", () => ({ hasPermission: m.hasPermission }));
vi.mock("@/platform/auth/get-current-user", () => ({
  getCurrentUser: vi.fn().mockResolvedValue({ userId: "user-1" }),
}));
vi.mock("@/domains/cleaning/services/cleaning.service", () => ({
  listCleaningSchedules: m.listCleaningSchedules,
  canChangeCleaningCleaner: m.canChangeCleaningCleaner,
}));
vi.mock("@/domains/cleaners/services/cleaner-assignments.service", () => ({
  listCurrentPropertyCleanerOptions: m.listCurrentPropertyCleanerOptions,
}));
vi.mock("@/domains/cleaners/services/cleaners.service", () => ({
  listActiveCleanerOptions: m.listActiveCleanerOptions,
}));
vi.mock("@/domains/properties/services/properties.service", () => ({
  listProperties: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/domains/reservations/services/reservations.service", () => ({
  listReservations: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/domains/cleaning/actions", () => ({
  assignCleaningScheduleCleanerAction: vi.fn(),
  createCleaningScheduleAction: vi.fn(),
  completeCleaningScheduleAction: vi.fn(),
  cancelCleaningScheduleAction: vi.fn(),
  markCleaningScheduleMissedAction: vi.fn(),
  rescheduleCleaningScheduleAction: vi.fn(),
  markCleanerNotifiedAction: vi.fn(),
}));
vi.mock("@/domains/cleaning/services/cleaner-notifications.service", () => ({
  listLatestCleanerNotifications: m.listLatestCleanerNotifications,
}));

import CleaningPage from "./page";

afterEach(cleanup);

const schedule = (
  id: string,
  propertyId: string,
  propertyName: string,
  status: string,
  cleaner: { id: string; name: string; status: string } | null,
) => ({
  id,
  propertyId,
  property: { name: propertyName },
  reservation: null,
  cleaningType: "TURNOVER",
  scheduledDate: new Date("2026-10-10T00:00:00Z"),
  originalScheduledDate: null,
  scheduledStartTime: null,
  scheduledEndTime: null,
  status,
  cleanerId: cleaner?.id ?? null,
  cleaner,
});

const ALEX = { id: "c-alex", name: "Alex", status: "ACTIVE" };

/** The default /cleaning view (no ?view= filter). */
const ALL_VIEW = { searchParams: Promise.resolve({}) };

beforeEach(() => {
  m.listLatestCleanerNotifications.mockResolvedValue(new Map());
  m.listCleaningSchedules.mockResolvedValue([
    schedule("s1", "p-harbor", "Harbor House", "SCHEDULED", ALEX),
    schedule("s2", "p-sandy", "Sandy Nudes", "SCHEDULED", null),
    schedule("s3", "p-harbor", "Harbor House", "COMPLETED", ALEX),
  ]);
  m.listCurrentPropertyCleanerOptions.mockResolvedValue({
    "p-harbor": { primary: { id: "c-alex", name: "Alex" }, teamMembers: [] },
    "p-sandy": {
      primary: null,
      teamMembers: [
        { id: "c-kris", name: "Kris" },
        { id: "c-lolis", name: "Lolis" },
      ],
    },
  });
  m.listActiveCleanerOptions.mockResolvedValue([
    { id: "c-alex", name: "Alex" },
    { id: "c-kris", name: "Kris" },
    { id: "c-lolis", name: "Lolis" },
  ]);
});

function rowFor(text: string, index = 0) {
  return screen.getAllByText(text)[index]!.closest("tr")!;
}

describe("/cleaning (Cleaner Phase 4)", () => {
  it("admin: Cleaner column, Needs cleaner + team at Sandy Nudes, picker on open jobs only", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(true);

    render(await CleaningPage(ALL_VIEW));

    expect(screen.getByRole("columnheader", { name: "Cleaner" })).toBeTruthy();
    const sandy = rowFor("Sandy Nudes");
    expect(within(sandy).getByText("Needs cleaner")).toBeTruthy();
    expect(within(sandy).getByText(/Team: Kris, Lolis/)).toBeTruthy();
    expect(within(sandy).getByRole("button", { name: "Assign" })).toBeTruthy();

    // The open Harbor House job can be changed; the completed one can't.
    const rows = screen
      .getAllByText("Harbor House")
      .map((el) => el.closest("tr")!);
    expect(
      within(rows[0]!).getByRole("button", { name: "Change" }),
    ).toBeTruthy();
    expect(
      within(rows[1]!).queryByRole("button", { name: "Change" }),
    ).toBeNull();
    expect(within(rows[1]!).getByText("Alex")).toBeTruthy();
  });

  it.each(["MISSED", "CANCELLED", "COMPLETED"])(
    "admin: a %s job shows its cleaner (or Needs cleaner) but no picker",
    async (status) => {
      m.hasPermission.mockResolvedValue(true);
      m.canChangeCleaningCleaner.mockResolvedValue(true);
      m.listCleaningSchedules.mockResolvedValue([
        schedule("a", "p-harbor", "Harbor House", status, ALEX),
        schedule("b", "p-sandy", "Sandy Nudes", status, null),
      ]);

      render(await CleaningPage(ALL_VIEW));

      expect(within(rowFor("Harbor House")).getByText("Alex")).toBeTruthy();
      expect(
        within(rowFor("Sandy Nudes")).getByText("Needs cleaner"),
      ).toBeTruthy();
      expect(
        screen.queryByRole("combobox", { name: /Cleaner for this cleaning/ }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
      expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    },
  );

  it("cleaners:read without admin: names shown, no picker, active-cleaner list never loaded", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(false);

    render(await CleaningPage(ALL_VIEW));

    expect(screen.getByRole("columnheader", { name: "Cleaner" })).toBeTruthy();
    expect(
      within(rowFor("Sandy Nudes")).getByText("Needs cleaner"),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Assign" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change" })).toBeNull();
    expect(m.listActiveCleanerOptions).not.toHaveBeenCalled();
  });

  it("without cleaners:read: no Cleaner column and no cleaner data loaded", async () => {
    m.hasPermission.mockResolvedValue(false);
    m.canChangeCleaningCleaner.mockResolvedValue(false);

    render(await CleaningPage(ALL_VIEW));

    expect(screen.queryByRole("columnheader", { name: "Cleaner" })).toBeNull();
    expect(screen.queryByText("Needs cleaner")).toBeNull();
    expect(m.listCurrentPropertyCleanerOptions).not.toHaveBeenCalled();
    expect(m.listActiveCleanerOptions).not.toHaveBeenCalled();
  });
});

describe("/cleaning — Copy cleaner message (Cleaner Phase 5.1)", () => {
  const COPY = { name: "Copy cleaner message" };

  it("admin: shown on an open job with a cleaner; Needs cleaner (no action) on an unassigned job", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(true);
    m.listCleaningSchedules.mockResolvedValue([
      schedule("a", "p-harbor", "Harbor House", "SCHEDULED", ALEX),
      schedule("b", "p-sandy", "Sandy Nudes", "SCHEDULED", null),
    ]);

    render(await CleaningPage(ALL_VIEW));

    expect(
      within(rowFor("Harbor House")).getByRole("button", COPY),
    ).toBeTruthy();
    const sandy = rowFor("Sandy Nudes");
    expect(within(sandy).getByText("Needs cleaner")).toBeTruthy();
    expect(within(sandy).queryByRole("button", COPY)).toBeNull();
  });

  it.each(["COMPLETED", "CANCELLED", "MISSED"])(
    "admin: not shown on a %s job",
    async (status) => {
      m.hasPermission.mockResolvedValue(true);
      m.canChangeCleaningCleaner.mockResolvedValue(true);
      m.listCleaningSchedules.mockResolvedValue([
        schedule("a", "p-harbor", "Harbor House", status, ALEX),
      ]);

      render(await CleaningPage(ALL_VIEW));

      expect(screen.queryByRole("button", COPY)).toBeNull();
    },
  );

  it("non-admin with cleaners:read: sees the cleaner's name but no copy action", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(false);
    m.listCleaningSchedules.mockResolvedValue([
      schedule("a", "p-harbor", "Harbor House", "SCHEDULED", ALEX),
    ]);

    render(await CleaningPage(ALL_VIEW));

    expect(within(rowFor("Harbor House")).getByText("Alex")).toBeTruthy();
    expect(screen.queryByRole("button", COPY)).toBeNull();
  });

  it("without cleaners:read: no copy action", async () => {
    m.hasPermission.mockResolvedValue(false);
    m.canChangeCleaningCleaner.mockResolvedValue(false);
    m.listCleaningSchedules.mockResolvedValue([
      schedule("a", "p-harbor", "Harbor House", "SCHEDULED", null),
    ]);

    render(await CleaningPage(ALL_VIEW));

    expect(screen.queryByRole("button", COPY)).toBeNull();
  });

  it("the copied text never includes other property fields (address, codes, notes)", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(true);
    const row = schedule("a", "p-harbor", "Harbor House", "SCHEDULED", ALEX);
    m.listCleaningSchedules.mockResolvedValue([
      {
        ...row,
        scheduledStartTime: "10:00",
        scheduledEndTime: "14:00",
        property: {
          name: "Harbor House",
          addressLine1: "1 Secret Lane",
          internalCode: "HARBOR-LOCKBOX-4321",
          notionPageId: "door-code-9876",
        },
      },
    ]);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    render(await CleaningPage(ALL_VIEW));
    fireEvent.click(screen.getByRole("button", COPY));

    const copied = writeText.mock.calls[0]![0] as string;
    expect(copied).toBe(
      [
        "Hi Alex, cleaning scheduled:",
        "Property: Harbor House",
        "Date: Sat, Oct 10, 2026",
        "Time: 10:00–14:00",
        "Type: Turnover cleaning",
        "Cleaner: Alex",
      ].join("\n"),
    );
    expect(copied).not.toMatch(/Secret Lane|LOCKBOX|4321|9876|door/i);
  });
});

describe("/cleaning — Mark cleaner notified (Cleaner Phase 5.2)", () => {
  const MARK = { name: "Mark cleaner notified" };

  it("admin: shown on an open job with a cleaner, with the latest record; not on an unassigned job", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(true);
    m.listCleaningSchedules.mockResolvedValue([
      schedule("a", "p-harbor", "Harbor House", "SCHEDULED", ALEX),
      schedule("b", "p-sandy", "Sandy Nudes", "SCHEDULED", null),
    ]);
    m.listLatestCleanerNotifications.mockResolvedValue(
      new Map([
        [
          "a",
          {
            cleanerId: "c-alex",
            cleanerName: "Alex",
            notifiedAt: new Date("2026-10-06T15:05:00Z"),
            notifiedByName: "Michelle",
          },
        ],
      ]),
    );

    render(await CleaningPage(ALL_VIEW));

    expect(m.listLatestCleanerNotifications).toHaveBeenCalledWith(
      { userId: "user-1" },
      ["a", "b"],
    );
    const harbor = rowFor("Harbor House");
    // Formatted in America/Chicago like the rest of the dashboard.
    expect(
      within(harbor).getByText(
        /Notified ✓ Oct 6, 2026, 10:05 AM CDT · by Michelle/,
      ),
    ).toBeTruthy();
    expect(
      within(harbor).getByRole("button", { name: "Mark notified again" }),
    ).toBeTruthy();
    expect(
      within(rowFor("Sandy Nudes")).queryByRole("button", MARK),
    ).toBeNull();
  });

  it.each(["COMPLETED", "CANCELLED", "MISSED"])(
    "admin: not shown on a %s job",
    async (status) => {
      m.hasPermission.mockResolvedValue(true);
      m.canChangeCleaningCleaner.mockResolvedValue(true);
      m.listCleaningSchedules.mockResolvedValue([
        schedule("a", "p-harbor", "Harbor House", status, ALEX),
      ]);

      render(await CleaningPage(ALL_VIEW));

      expect(screen.queryByRole("button", MARK)).toBeNull();
      expect(screen.queryByText("Not notified yet")).toBeNull();
    },
  );

  it("non-admin: never shown, and the notification history is never read", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(false);
    m.listCleaningSchedules.mockResolvedValue([
      schedule("a", "p-harbor", "Harbor House", "SCHEDULED", ALEX),
    ]);

    render(await CleaningPage(ALL_VIEW));

    expect(screen.queryByRole("button", MARK)).toBeNull();
    expect(m.listLatestCleanerNotifications).not.toHaveBeenCalled();
  });
});

describe("/cleaning — jobs needing attention (Cleaner Phase 5.3)", () => {
  const MIXED = [
    schedule("open-1", "p-sandy", "Sandy Nudes", "SCHEDULED", null),
    schedule("open-2", "p-roseate", "Roseate Madre", "SCHEDULED", null),
    schedule("assigned", "p-harbor", "Harbor House", "SCHEDULED", ALEX),
    schedule("done", "p-done", "Done Cottage", "COMPLETED", null),
    schedule("cancelled", "p-cancel", "Cancelled Villa", "CANCELLED", null),
    schedule("missed", "p-missed", "Missed Lodge", "MISSED", null),
  ];
  const filteredView = {
    searchParams: Promise.resolve({ view: "needs-cleaner" }),
  };

  it("shows the count and a link to only those jobs (open + unassigned only)", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(false);
    m.listCleaningSchedules.mockResolvedValue(MIXED);

    render(await CleaningPage(ALL_VIEW));

    const notice = screen.getByRole("status");
    expect(
      within(notice).getByText("2 cleaning jobs need attention"),
    ).toBeTruthy();
    expect(
      within(notice).getByText("These jobs don't have a cleaner assigned."),
    ).toBeTruthy();
    expect(
      within(notice)
        .getByRole("link", { name: "Show only these" })
        .getAttribute("href"),
    ).toBe("/cleaning?view=needs-cleaner");
    // The full list is still shown on the default view.
    expect(screen.getByText("Done Cottage")).toBeTruthy();
  });

  it("?view=needs-cleaner lists only open jobs with no cleaner, each marked Needs cleaner", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(false);
    m.listCleaningSchedules.mockResolvedValue(MIXED);

    render(await CleaningPage(filteredView));

    for (const name of ["Sandy Nudes", "Roseate Madre"]) {
      expect(within(rowFor(name)).getByText("Needs cleaner")).toBeTruthy();
    }
    for (const name of [
      "Harbor House",
      "Done Cottage",
      "Cancelled Villa",
      "Missed Lodge",
    ]) {
      expect(screen.queryByText(name)).toBeNull();
    }
    expect(
      screen
        .getByRole("link", { name: "Show all cleanings" })
        .getAttribute("href"),
    ).toBe("/cleaning");
  });

  it("no notice when no open job needs a cleaner; the filtered view says so", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(false);
    m.listCleaningSchedules.mockResolvedValue([
      schedule("assigned", "p-harbor", "Harbor House", "SCHEDULED", ALEX),
      schedule("done", "p-done", "Done Cottage", "COMPLETED", null),
    ]);

    render(await CleaningPage(ALL_VIEW));
    expect(screen.queryByText(/need attention|needs attention/)).toBeNull();
    cleanup();

    render(await CleaningPage(filteredView));
    expect(screen.getByText("No cleaning jobs need attention.")).toBeTruthy();
    expect(screen.queryByText("Harbor House")).toBeNull();
  });

  it("without cleaners:read: no notice, and the filter is ignored (cleaners are hidden, so 'no cleaner' can't be known)", async () => {
    m.hasPermission.mockResolvedValue(false);
    m.canChangeCleaningCleaner.mockResolvedValue(false);
    m.listCleaningSchedules.mockResolvedValue(
      MIXED.map((s) => ({ ...s, cleanerId: null, cleaner: null })),
    );

    render(await CleaningPage(filteredView));

    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByText(/need attention/)).toBeNull();
    // All jobs still listed — nothing filtered out.
    expect(screen.getByText("Harbor House")).toBeTruthy();
    expect(screen.getByText("Done Cottage")).toBeTruthy();
  });

  it("displays only — assigns nothing and calls no cleaner/notification write", async () => {
    m.hasPermission.mockResolvedValue(true);
    m.canChangeCleaningCleaner.mockResolvedValue(true);
    m.listCleaningSchedules.mockResolvedValue(MIXED);

    render(await CleaningPage(filteredView));

    // The page only reads; it never calls an action while rendering.
    const actions = await import("@/domains/cleaning/actions");
    expect(actions.assignCleaningScheduleCleanerAction).not.toHaveBeenCalled();
    expect(actions.markCleanerNotifiedAction).not.toHaveBeenCalled();
  });
});
