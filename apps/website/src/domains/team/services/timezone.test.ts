import { describe, expect, it } from "vitest";

import { zonedTimeToUtc } from "./timezone";

describe("zonedTimeToUtc", () => {
  it("converts a standard-time wall clock reading to the correct UTC instant (America/Chicago, CST = UTC-6)", () => {
    const result = zonedTimeToUtc(
      { year: 2026, month: 1, day: 15, hour: 9, minute: 0 },
      "America/Chicago",
    );
    expect(result.toISOString()).toBe("2026-01-15T15:00:00.000Z");
  });

  it("converts a daylight-time wall clock reading to the correct UTC instant (America/Chicago, CDT = UTC-5)", () => {
    const result = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 9, minute: 0 },
      "America/Chicago",
    );
    expect(result.toISOString()).toBe("2026-07-15T14:00:00.000Z");
  });

  it("gives a different real instant for the same wall-clock time in a different timezone", () => {
    const chicago = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 9, minute: 0 },
      "America/Chicago",
    );
    const newYork = zonedTimeToUtc(
      { year: 2026, month: 7, day: 15, hour: 9, minute: 0 },
      "America/New_York",
    );
    expect(chicago.getTime()).not.toBe(newYork.getTime());
  });

  it("handles the UTC timezone itself as a no-op offset", () => {
    const result = zonedTimeToUtc(
      { year: 2026, month: 3, day: 1, hour: 12, minute: 30 },
      "UTC",
    );
    expect(result.toISOString()).toBe("2026-03-01T12:30:00.000Z");
  });
});
