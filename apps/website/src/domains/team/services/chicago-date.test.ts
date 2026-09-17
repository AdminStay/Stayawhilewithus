import { describe, expect, it } from "vitest";

import {
  addCalendarDays,
  calendarDayWindowUtc,
  formatCalendarDateLabel,
  formatChicagoTime,
  formatChicagoTimeRange,
  getCalendarDateInZone,
} from "./chicago-date";

describe("getCalendarDateInZone", () => {
  it("returns the Chicago calendar date, which can differ from the UTC calendar date", () => {
    // 2026-01-06 04:30 UTC = 2026-01-05 10:30 PM CST — still "Jan 5" in Chicago.
    const instant = new Date("2026-01-06T04:30:00.000Z");
    expect(getCalendarDateInZone(instant, "America/Chicago")).toEqual({
      year: 2026,
      month: 1,
      day: 5,
    });
  });
});

describe("addCalendarDays", () => {
  it("adds days, rolling over a month boundary", () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 30 }, 3)).toEqual({
      year: 2026,
      month: 2,
      day: 2,
    });
  });

  it("subtracts days with a negative delta, rolling over a year boundary", () => {
    expect(addCalendarDays({ year: 2026, month: 1, day: 1 }, -1)).toEqual({
      year: 2025,
      month: 12,
      day: 31,
    });
  });
});

describe("calendarDayWindowUtc", () => {
  it("spans exactly 24 hours on an ordinary (non-DST-transition) day", () => {
    const { start, end } = calendarDayWindowUtc(
      { year: 2026, month: 1, day: 15 },
      "America/Chicago",
    );
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000);
  });

  it("spans exactly 23 hours on the spring-forward DST transition day (2026-03-08)", () => {
    const { start, end } = calendarDayWindowUtc(
      { year: 2026, month: 3, day: 8 },
      "America/Chicago",
    );
    expect(end.getTime() - start.getTime()).toBe(23 * 60 * 60 * 1000);
  });

  it("spans exactly 25 hours on the fall-back DST transition day (2026-11-01)", () => {
    const { start, end } = calendarDayWindowUtc(
      { year: 2026, month: 11, day: 1 },
      "America/Chicago",
    );
    expect(end.getTime() - start.getTime()).toBe(25 * 60 * 60 * 1000);
  });

  it("its start exactly equals the previous day's end — no gap, no overlap between consecutive days", () => {
    const day1 = calendarDayWindowUtc(
      { year: 2026, month: 3, day: 8 },
      "America/Chicago",
    );
    const day2 = calendarDayWindowUtc(
      { year: 2026, month: 3, day: 9 },
      "America/Chicago",
    );
    expect(day1.end.getTime()).toBe(day2.start.getTime());
  });
});

describe("formatCalendarDateLabel", () => {
  it("formats a calendar date without re-interpreting it through any real timezone offset", () => {
    expect(formatCalendarDateLabel({ year: 2026, month: 1, day: 15 })).toBe(
      "Thu, Jan 15",
    );
  });
});

describe("formatChicagoTime / formatChicagoTimeRange", () => {
  it("formats an instant as its real Chicago wall-clock time (CST)", () => {
    // 2026-01-15T15:00:00Z = 9:00 AM CST.
    expect(formatChicagoTime(new Date("2026-01-15T15:00:00.000Z"))).toBe(
      "9:00 AM",
    );
  });

  it("formats an instant as its real Chicago wall-clock time (CDT)", () => {
    // 2026-07-15T14:00:00Z = 9:00 AM CDT.
    expect(formatChicagoTime(new Date("2026-07-15T14:00:00.000Z"))).toBe(
      "9:00 AM",
    );
  });

  it("formats a range as 'start – end'", () => {
    expect(
      formatChicagoTimeRange(
        new Date("2026-01-15T12:00:00.000Z"),
        new Date("2026-01-15T20:00:00.000Z"),
      ),
    ).toBe("6:00 AM – 2:00 PM");
  });
});
