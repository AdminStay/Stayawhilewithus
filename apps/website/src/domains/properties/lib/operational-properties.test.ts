import { describe, expect, it } from "vitest";

import {
  isOperationalProperty,
  OPERATIONAL_PROPERTY_STATUSES,
  OPERATIONAL_PROPERTY_WHERE,
} from "./operational-properties";

describe("operational properties (Meeting #6, 2026-10-02)", () => {
  it("ACTIVE and ONBOARDING are operational", () => {
    expect(OPERATIONAL_PROPERTY_STATUSES).toEqual(["ACTIVE", "ONBOARDING"]);
    expect(isOperationalProperty({ status: "ACTIVE", deletedAt: null })).toBe(
      true,
    );
    expect(isOperationalProperty({ status: "ONBOARDING" })).toBe(true);
  });

  it.each(["INACTIVE", "OFFBOARDED", "SOMETHING_NEW"])(
    "%s is not",
    (status) => {
      expect(isOperationalProperty({ status, deletedAt: null })).toBe(false);
    },
  );

  it("a soft-deleted property is never operational", () => {
    expect(
      isOperationalProperty({
        status: "ACTIVE",
        deletedAt: new Date("2026-09-01"),
      }),
    ).toBe(false);
  });

  it("the Prisma filter states the same rule", () => {
    expect(OPERATIONAL_PROPERTY_WHERE).toEqual({
      deletedAt: null,
      status: { in: ["ACTIVE", "ONBOARDING"] },
    });
  });
});
