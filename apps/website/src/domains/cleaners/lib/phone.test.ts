import { describe, expect, it } from "vitest";

import { formatPhone, maskPhone, normalizePhone, phoneLast4 } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["3055550123", "+13055550123"],
    ["(305) 555-0123", "+13055550123"],
    ["305.555.0123", "+13055550123"],
    ["1 305 555 0123", "+13055550123"],
    ["+1 305-555-0123", "+13055550123"],
    ["+44 20 7946 0958", "+442079460958"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each([
    ["", "empty"],
    ["555-0123", "too short for US without a country code"],
    ["305555012", "9 digits"],
    ["23055550123", "11 digits not starting with 1"],
    ["305-555-0123 ext 4", "letters"],
    ["+0 305 555 0123", "country code can't start with 0"],
    ["+1234567", "under 8 digits with +"],
    ["+1234567890123456", "over 15 digits"],
    ["305+5550123", "+ in the middle"],
  ])("rejects %s (%s)", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });
});

describe("masking and display", () => {
  it("phoneLast4 / maskPhone expose only the last 4 digits", () => {
    expect(phoneLast4("+13055550123")).toBe("0123");
    expect(maskPhone("+13055550123")).toBe("•••• 0123");
    expect(maskPhone("+13055550123")).not.toContain("305");
  });

  it("formatPhone formats US numbers and leaves others in E.164", () => {
    expect(formatPhone("+13055550123")).toBe("(305) 555-0123");
    expect(formatPhone("+442079460958")).toBe("+442079460958");
  });
});
