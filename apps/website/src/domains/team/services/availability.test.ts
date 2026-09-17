import { describe, expect, it } from "vitest";

import {
  deriveAvailability,
  isScheduleDataStale,
  mergeContiguousShifts,
  type NormalizedShift,
} from "./availability";

const NOON = new Date("2026-09-16T12:00:00.000Z");

function shift(
  personKey: string,
  startHour: number,
  endHour: number,
): NormalizedShift {
  return {
    personKey,
    start: new Date(
      `2026-09-16T${String(startHour).padStart(2, "0")}:00:00.000Z`,
    ),
    end: new Date(`2026-09-16T${String(endHour).padStart(2, "0")}:00:00.000Z`),
  };
}

describe("deriveAvailability", () => {
  it("returns WORKING_NOW for a person whose shift covers `now`, and includes that shift", () => {
    const result = deriveAvailability(["alice"], [shift("alice", 9, 17)], NOON);
    expect(result).toEqual([
      {
        personKey: "alice",
        status: "WORKING_NOW",
        currentShift: shift("alice", 9, 17),
        nextShift: null,
      },
    ]);
  });

  it("returns SCHEDULED_LATER for a person with a shift starting after `now`, and includes that shift", () => {
    const result = deriveAvailability(["bob"], [shift("bob", 14, 22)], NOON);
    expect(result[0]?.status).toBe("SCHEDULED_LATER");
    expect(result[0]?.nextShift).toEqual(shift("bob", 14, 22));
    expect(result[0]?.currentShift).toBeNull();
  });

  it("returns OFF for a person with shifts today, all already finished, none upcoming", () => {
    const result = deriveAvailability(["carol"], [shift("carol", 6, 10)], NOON);
    expect(result[0]?.status).toBe("OFF");
  });

  it("returns UNKNOWN — never OFF — for a person with zero shift entries at all", () => {
    const result = deriveAvailability(["dave"], [], NOON);
    expect(result[0]).toEqual({
      personKey: "dave",
      status: "UNKNOWN",
      currentShift: null,
      nextShift: null,
    });
  });

  it("picks the earliest upcoming shift as nextShift when multiple exist", () => {
    const shifts = [shift("erin", 18, 22), shift("erin", 14, 16)];
    const result = deriveAvailability(["erin"], shifts, NOON);
    expect(result[0]?.status).toBe("SCHEDULED_LATER");
    expect(result[0]?.nextShift?.start).toEqual(shift("erin", 14, 16).start);
  });

  it("an explicit OFF/UNAVAILABLE override always wins over shift-derived status", () => {
    const result = deriveAvailability(
      ["frank"],
      [shift("frank", 9, 17)], // would otherwise be WORKING_NOW at noon
      NOON,
      [{ personKey: "frank", status: "UNAVAILABLE" }],
    );
    expect(result[0]).toEqual({
      personKey: "frank",
      status: "UNAVAILABLE",
      currentShift: null,
      nextShift: null,
    });
  });

  it("evaluates every requested personKey independently, in the given order, even with no shift data for most of them", () => {
    const result = deriveAvailability(
      ["alice", "dave", "bob"],
      [shift("alice", 9, 17), shift("bob", 14, 22)],
      NOON,
    );
    expect(result.map((r) => r.personKey)).toEqual(["alice", "dave", "bob"]);
    expect(result.map((r) => r.status)).toEqual([
      "WORKING_NOW",
      "UNKNOWN",
      "SCHEDULED_LATER",
    ]);
  });

  it("treats a shift end time as exclusive — a person is not WORKING_NOW at the exact end instant", () => {
    const endOfShift = new Date("2026-09-16T17:00:00.000Z");
    const result = deriveAvailability(
      ["alice"],
      [shift("alice", 9, 17)],
      endOfShift,
    );
    expect(result[0]?.status).toBe("OFF");
  });
});

describe("isScheduleDataStale", () => {
  it("is stale when there has never been a successful sync", () => {
    expect(isScheduleDataStale(null, NOON, 60_000)).toBe(true);
  });

  it("is not stale when the last sync is within the threshold", () => {
    const fiveMinAgo = new Date(NOON.getTime() - 5 * 60_000);
    expect(isScheduleDataStale(fiveMinAgo, NOON, 15 * 60_000)).toBe(false);
  });

  it("is stale once the last sync is older than the threshold", () => {
    const twentyMinAgo = new Date(NOON.getTime() - 20 * 60_000);
    expect(isScheduleDataStale(twentyMinAgo, NOON, 15 * 60_000)).toBe(true);
  });
});

function hourly(
  personKey: string,
  startHour: number,
  endHour: number,
  label?: string,
): NormalizedShift {
  return {
    personKey,
    start: new Date(
      `2026-09-16T${String(startHour).padStart(2, "0")}:00:00.000Z`,
    ),
    end: new Date(`2026-09-16T${String(endHour).padStart(2, "0")}:00:00.000Z`),
    label,
  };
}

describe("mergeContiguousShifts", () => {
  it("merges strictly back-to-back same-person, same-label hourly shifts into one block", () => {
    const shifts = [
      hourly("taylor", 6, 7, "Operations"),
      hourly("taylor", 7, 8, "Operations"),
      hourly("taylor", 8, 9, "Operations"),
    ];
    const result = mergeContiguousShifts(shifts);
    expect(result).toEqual([hourly("taylor", 6, 9, "Operations")]);
  });

  it("does not merge across a gap, even a one-hour one", () => {
    const shifts = [
      hourly("taylor", 6, 7, "Operations"),
      hourly("taylor", 8, 9, "Operations"),
    ];
    const result = mergeContiguousShifts(shifts);
    expect(result).toHaveLength(2);
  });

  it("does not merge contiguous slots with different role labels", () => {
    const shifts = [
      hourly("taylor", 6, 7, "Operations"),
      hourly("taylor", 7, 8, "MOD"),
    ];
    const result = mergeContiguousShifts(shifts);
    expect(result).toHaveLength(2);
  });

  it("never merges across different people, even with identical, contiguous times", () => {
    const shifts = [
      hourly("taylor", 6, 7, "Operations"),
      hourly("jordan", 7, 8, "Operations"),
    ];
    const result = mergeContiguousShifts(shifts);
    expect(result).toHaveLength(2);
  });

  it("is order-independent — merges correctly regardless of input order", () => {
    const shifts = [
      hourly("taylor", 8, 9, "Operations"),
      hourly("taylor", 6, 7, "Operations"),
      hourly("taylor", 7, 8, "Operations"),
    ];
    const result = mergeContiguousShifts(shifts);
    expect(result).toEqual([hourly("taylor", 6, 9, "Operations")]);
  });
});
