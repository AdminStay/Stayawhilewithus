// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  cancelCleaningScheduleAction: vi.fn(),
  completeCleaningScheduleAction: vi.fn(),
  markCleaningScheduleMissedAction: vi.fn(),
  rescheduleCleaningScheduleAction: vi.fn(),
}));

import { CleaningScheduleList } from "./CleaningScheduleList";

afterEach(cleanup);

const ALEX = { id: "c-alex", name: "Alex" };

const schedule = (
  id: string,
  status: string,
  cleaner: { id: string; name: string; status: string } | null = {
    ...ALEX,
    status: "ACTIVE",
  },
) => ({
  id,
  status,
  propertyId: "p1",
  property: { name: `Harbor ${id}` },
  reservation: null,
  cleaningType: "TURNOVER",
  scheduledDate: new Date("2026-10-10T00:00:00.000Z"),
  scheduledStartTime: null,
  scheduledEndTime: null,
  originalScheduledDate: null,
  cleanerId: cleaner?.id ?? null,
  cleaner,
});

const adminCleaners = {
  canSeeCleaners: true,
  canChangeCleaner: true,
  propertyCleaners: { p1: { primary: ALEX, teamMembers: [] } },
  activeCleaners: [ALEX],
  assignCleanerAction: vi.fn(),
  notifications: {},
  markNotifiedAction: vi.fn(),
};

function row(propertyName: string) {
  return screen.getByText(propertyName).closest("tr")!;
}

describe("CleaningScheduleList — lifecycle actions (2026-10-07)", () => {
  it("an open job offers Reschedule, Complete, Missed and Cancel", () => {
    render(
      <CleaningScheduleList
        schedules={[schedule("open", "SCHEDULED")] as never}
      />,
    );
    const r = within(row("Harbor open"));
    for (const name of ["Reschedule", "Complete", "Missed", "Cancel"]) {
      expect(r.getByRole("button", { name })).toBeTruthy();
    }
  });

  it("a MISSED job offers only Reopen (a reschedule that reopens it)", () => {
    render(
      <CleaningScheduleList
        schedules={[schedule("missed", "MISSED")] as never}
      />,
    );
    const r = within(row("Harbor missed"));
    expect(r.getByRole("button", { name: "Reopen" })).toBeTruthy();
    expect(r.getByLabelText("Reopen on date")).toBeTruthy();
    for (const name of ["Reschedule", "Complete", "Missed", "Cancel"]) {
      expect(r.queryByRole("button", { name })).toBeNull();
    }
  });

  it.each(["COMPLETED", "CANCELLED"])(
    "a %s job offers no lifecycle actions at all",
    (status) => {
      render(
        <CleaningScheduleList
          schedules={[schedule("closed", status)] as never}
        />,
      );
      const r = within(row("Harbor closed"));
      for (const name of [
        "Reopen",
        "Reschedule",
        "Complete",
        "Missed",
        "Cancel",
      ]) {
        expect(r.queryByRole("button", { name })).toBeNull();
      }
    },
  );
});

describe("CleaningScheduleList — inactive cleaner (2026-10-07)", () => {
  it("an open job with an ACTIVE cleaner offers Copy message and Mark notified (admin)", () => {
    render(
      <CleaningScheduleList
        schedules={[schedule("active", "SCHEDULED")] as never}
        cleaners={adminCleaners as never}
      />,
    );
    const r = within(row("Harbor active"));
    expect(
      r.getByRole("button", { name: "Copy cleaner message" }),
    ).toBeTruthy();
    expect(
      r.getByRole("button", { name: "Mark cleaner notified" }),
    ).toBeTruthy();
  });

  it("an open job whose cleaner is INACTIVE offers neither — it needs a new cleaner", () => {
    render(
      <CleaningScheduleList
        schedules={
          [
            schedule("inactive", "SCHEDULED", { ...ALEX, status: "INACTIVE" }),
          ] as never
        }
        cleaners={adminCleaners as never}
      />,
    );
    const r = within(row("Harbor inactive"));
    expect(r.getByText("Inactive")).toBeTruthy();
    expect(
      r.queryByRole("button", { name: "Copy cleaner message" }),
    ).toBeNull();
    expect(
      r.queryByRole("button", { name: "Mark cleaner notified" }),
    ).toBeNull();
  });
});
