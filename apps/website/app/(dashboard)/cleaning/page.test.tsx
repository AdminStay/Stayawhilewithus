// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  hasPermission: vi.fn(),
  listCleaningSchedules: vi.fn(),
  canChangeCleaningCleaner: vi.fn(),
  listCurrentPropertyCleanerOptions: vi.fn(),
  listActiveCleanerOptions: vi.fn(),
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

beforeEach(() => {
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

    render(await CleaningPage());

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

      render(await CleaningPage());

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

    render(await CleaningPage());

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

    render(await CleaningPage());

    expect(screen.queryByRole("columnheader", { name: "Cleaner" })).toBeNull();
    expect(screen.queryByText("Needs cleaner")).toBeNull();
    expect(m.listCurrentPropertyCleanerOptions).not.toHaveBeenCalled();
    expect(m.listActiveCleanerOptions).not.toHaveBeenCalled();
  });
});
