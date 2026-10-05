import { describe, expect, it } from "vitest";

import {
  buildCleanerMessage,
  type CleanerMessageInput,
} from "./cleaner-message";

const base: CleanerMessageInput = {
  propertyName: "Harbor House",
  scheduledDate: new Date("2026-10-10T00:00:00Z"),
  scheduledStartTime: "10:00",
  scheduledEndTime: "14:00",
  cleaningType: "TURNOVER",
  cleanerName: "Alex",
};

describe("buildCleanerMessage (Cleaner Phase 5.1)", () => {
  it("contains exactly property, date, time, type and cleaner", () => {
    expect(buildCleanerMessage(base)).toBe(
      [
        "Hi Alex, cleaning scheduled:",
        "Property: Harbor House",
        "Date: Sat, Oct 10, 2026",
        "Time: 10:00–14:00",
        "Type: Turnover cleaning",
        "Cleaner: Alex",
      ].join("\n"),
    );
  });

  it("formats the date in UTC so a @db.Date never shifts to the previous day", () => {
    // Midnight UTC is still Oct 9 in US time zones; the message must say Oct 10.
    expect(buildCleanerMessage(base)).toContain("Date: Sat, Oct 10, 2026");
  });

  it.each([
    ["10:00", "14:00", "Time: 10:00–14:00"],
    ["10:00", null, "Time: from 10:00"],
    [null, "14:00", "Time: by 14:00"],
    [null, null, "Time: Time not set"],
  ])("time %s / %s → %s", (start, end, expected) => {
    expect(
      buildCleanerMessage({
        ...base,
        scheduledStartTime: start,
        scheduledEndTime: end,
      }),
    ).toContain(expected);
  });

  it.each([
    ["TURNOVER", "Turnover cleaning"],
    ["DEEP_CLEAN", "Deep clean"],
    ["INSPECTION_CLEAN", "Inspection clean"],
    ["MAINTENANCE_CLEAN", "Maintenance clean"],
    ["SOMETHING_NEW", "Cleaning"],
  ])("labels cleaning type %s as %s", (cleaningType, label) => {
    expect(buildCleanerMessage({ ...base, cleaningType })).toContain(
      `Type: ${label}`,
    );
  });

  it("never includes anything beyond the five fields, even if a caller passes a whole row", () => {
    // Simulates a careless caller spreading a full property/cleaner row in.
    const rowLike = {
      ...base,
      addressLine1: "1 Secret Lane",
      lockboxCode: "4321",
      doorCode: "#9876",
      phone: "+13055550123",
      notes: "WiFi password: hunter2",
    } as CleanerMessageInput;

    const message = buildCleanerMessage(rowLike);

    for (const sensitive of [
      "Secret Lane",
      "4321",
      "9876",
      "3055550123",
      "hunter2",
      "password",
      "code",
      "lock",
    ]) {
      expect(message.toLowerCase()).not.toContain(sensitive.toLowerCase());
    }
    expect(message.split("\n")).toHaveLength(6);
  });
});
