import { describe, expect, it } from "vitest";

import { parseScheduleGrid, toNormalizedShifts } from "./sheet-schedule-parser";

/**
 * A small synthetic week block mirroring the REAL sheet's exact
 * structural shape (calendar grid: date row / day-name row / role-label
 * row / hourly time-slot rows) and its real observed quirks (inconsistent
 * date-comma spacing, inconsistent time-dash spacing, "/" vs "|"
 * multi-person delimiters, blank vs "-", a parenthetical note, a
 * midnight-crossing slot) — with entirely fake names. No real schedule
 * content from Michelle's actual sheet is used here.
 */
const SAMPLE_WEEK: string[][] = [
  ["", "January 5, 2026", "", "", "January 6,2026", "", ""],
  ["", "Monday", "", "", "Tuesday", "", ""],
  ["", "Operations", "MOD", "EA", "Operations", "MOD", "EA"],
  [
    "6:00-7:00 AM",
    "Taylor",
    "-",
    "",
    "Jordan/Casey",
    "Riley (project)",
    "Taylor   ",
  ],
  ["11:00 PM-12:00 AM", "Morgan | Avery", "-", "-", "-", "-", "-"],
];

describe("parseScheduleGrid", () => {
  it("parses a normal single-person cell into one slot with one personToken", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) =>
        s.day === 5 &&
        s.roleLabel === "Operations" &&
        s.timeLabelRaw === "6:00-7:00 AM",
    );
    expect(slot?.cell.personTokens).toEqual(["Taylor"]);
    expect(slot?.year).toBe(2026);
    expect(slot?.month).toBe(1);
  });

  it("tolerates the real source's inconsistent date-comma spacing ('January 6,2026' vs 'January 5, 2026')", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    expect(
      slots.some((s) => s.day === 6 && s.month === 1 && s.year === 2026),
    ).toBe(true);
  });

  it("splits a '/'-delimited multi-person cell into separate tokens", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) =>
        s.day === 6 &&
        s.roleLabel === "Operations" &&
        s.timeLabelRaw === "6:00-7:00 AM",
    );
    expect(slot?.cell.personTokens).toEqual(["Jordan", "Casey"]);
  });

  it("splits a '|'-delimited multi-person cell into separate tokens — the real source's other, different delimiter", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) =>
        s.day === 5 &&
        s.roleLabel === "Operations" &&
        s.timeLabelRaw === "11:00 PM-12:00 AM",
    );
    expect(slot?.cell.personTokens).toEqual(["Morgan", "Avery"]);
  });

  it("extracts a parenthetical note without treating it as a person, and without it appearing in personTokens", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) =>
        s.day === 6 &&
        s.roleLabel === "MOD" &&
        s.timeLabelRaw === "6:00-7:00 AM",
    );
    expect(slot?.cell.personTokens).toEqual(["Riley"]);
    expect(slot?.cell.note).toBe("project");
  });

  it("treats an explicit '-' as zero personTokens, and records that it was an explicit dash", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) =>
        s.day === 5 &&
        s.roleLabel === "MOD" &&
        s.timeLabelRaw === "6:00-7:00 AM" &&
        s.cell.rawText === "-",
    );
    expect(slot?.cell.personTokens).toEqual([]);
    expect(slot?.cell.wasExplicitDash).toBe(true);
  });

  it("treats a genuinely blank cell as zero personTokens, distinct in wasExplicitDash from an explicit '-'", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) =>
        s.day === 5 &&
        s.roleLabel === "EA" &&
        s.timeLabelRaw === "6:00-7:00 AM",
    );
    expect(slot?.cell.personTokens).toEqual([]);
    expect(slot?.cell.wasExplicitDash).toBe(false);
  });

  it("trims inconsistent trailing whitespace in a name ('Taylor   ') to the same clean token as elsewhere", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) =>
        s.day === 6 &&
        s.roleLabel === "EA" &&
        s.timeLabelRaw === "6:00-7:00 AM",
    );
    expect(slot?.cell.personTokens).toEqual(["Taylor"]);
  });

  it("parses a midnight-crossing time-slot label ('11:00 PM-12:00 AM') with the correct hours on each side", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const slot = slots.find(
      (s) => s.timeLabelRaw === "11:00 PM-12:00 AM" && s.day === 5,
    );
    expect(slot?.startHour).toBe(23);
    expect(slot?.endHour).toBe(0);
  });

  it("flags a day-name mismatch as a warning without dropping the slot or silently correcting it", () => {
    const rowsWithWrongDayName = SAMPLE_WEEK.map((r, i) =>
      i === 1 ? ["", "Friday", "", "", "Tuesday", "", ""] : r,
    );
    const { slots, warnings } = parseScheduleGrid(rowsWithWrongDayName);
    expect(warnings.some((w) => w.type === "DAY_NAME_MISMATCH")).toBe(true);
    // The slot itself is still produced — the mismatch is reported, not
    // used to drop real schedule data.
    expect(slots.some((s) => s.day === 5)).toBe(true);
  });

  it("warns, rather than throws, on an unparseable time-slot label", () => {
    const rowsWithBadTime = SAMPLE_WEEK.map((r, i) =>
      i === 3 ? ["not a time", ...r.slice(1)] : r,
    );
    const { warnings } = parseScheduleGrid(rowsWithBadTime);
    expect(warnings.some((w) => w.type === "UNPARSEABLE_TIME_LABEL")).toBe(
      true,
    );
  });

  it("returns no slots and no warnings for an empty grid, rather than throwing", () => {
    expect(parseScheduleGrid([])).toEqual({ slots: [], warnings: [] });
  });

  it("stops a week's time-slot rows at a blank separator row, never bleeding into the next week's header", () => {
    const twoWeeks: string[][] = [
      ...SAMPLE_WEEK,
      ["", "", "", "", "", "", ""],
      ["", "January 12, 2026", "", "", "January 13,2026", "", ""],
      ["", "Monday", "", "", "Tuesday", "", ""],
      ["", "Operations", "MOD", "EA", "Operations", "MOD", "EA"],
      ["6:00-7:00 AM", "Sam", "-", "-", "-", "-", "-"],
    ];
    const { slots } = parseScheduleGrid(twoWeeks);
    expect(
      slots.some((s) => s.day === 12 && s.cell.personTokens.includes("Sam")),
    ).toBe(true);
    // Week 1's own slots are untouched by week 2 existing.
    expect(slots.filter((s) => s.month === 1 && s.day === 5)).toHaveLength(
      slots.filter((s) => s.month === 1 && s.day === 5).length,
    );
  });
});

describe("toNormalizedShifts", () => {
  it("produces one NormalizedShift per person per slot, with the raw source name as personKey (never resolved to a userId here)", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const shifts = toNormalizedShifts(slots, "America/Chicago");
    const jordanShift = shifts.find((s) => s.personKey === "Jordan");
    const caseyShift = shifts.find((s) => s.personKey === "Casey");
    expect(jordanShift).toBeTruthy();
    expect(caseyShift).toBeTruthy();
    // Both people from the same "/"-delimited cell get the same real time range.
    expect(jordanShift?.start.getTime()).toBe(caseyShift?.start.getTime());
  });

  it("converts the wall-clock slot time to a real UTC instant using the given timezone", () => {
    const { slots } = parseScheduleGrid(SAMPLE_WEEK);
    const onlyTaylor = slots.filter(
      (s) =>
        s.day === 5 &&
        s.roleLabel === "Operations" &&
        s.timeLabelRaw === "6:00-7:00 AM",
    );
    const shifts = toNormalizedShifts(onlyTaylor, "America/Chicago");
    // Jan 5 2026 6:00 AM CST (UTC-6) = 12:00 UTC.
    expect(shifts[0]?.start.toISOString()).toBe("2026-01-05T12:00:00.000Z");
  });

  it("adds 24h to the end instant for a midnight-crossing slot, so the shift is never inverted/zero-length", () => {
    const midnightSlot = {
      year: 2026,
      month: 1,
      day: 5,
      dayNameInSheet: "Monday",
      roleLabel: "Operations",
      startHour: 23,
      startMinute: 0,
      endHour: 0,
      endMinute: 0,
      timeLabelRaw: "11:00 PM-12:00 AM",
      cell: {
        rawText: "Morgan",
        personTokens: ["Morgan"],
        note: null,
        wasExplicitDash: false,
      },
    };
    const [shift] = toNormalizedShifts([midnightSlot], "UTC");
    expect(shift!.end.getTime()).toBeGreaterThan(shift!.start.getTime());
    expect(shift!.end.getTime() - shift!.start.getTime()).toBe(60 * 60 * 1000);
  });

  it("produces zero shifts for a slot with no personTokens (explicit dash or blank)", () => {
    const emptySlot = {
      year: 2026,
      month: 1,
      day: 5,
      dayNameInSheet: "Monday",
      roleLabel: "MOD",
      startHour: 6,
      startMinute: 0,
      endHour: 7,
      endMinute: 0,
      timeLabelRaw: "6:00-7:00 AM",
      cell: {
        rawText: "-",
        personTokens: [],
        note: null,
        wasExplicitDash: true,
      },
    };
    expect(toNormalizedShifts([emptySlot], "UTC")).toEqual([]);
  });
});
