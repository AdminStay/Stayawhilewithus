import { describe, expect, it } from "vitest";

import {
  COMPARISON_STATUS_LABEL,
  compareOwnerRezProperty,
  countComparisonStatuses,
  type ComparedField,
  type StayWhileComparableValues,
} from "./ownerrez-property-comparison";

// FABRICATED TEST FIXTURES — not real StayWhile or OwnerRez data. Addresses,
// ids and counts below are invented for these tests only.
function fabricatedStayWhile(
  overrides: Partial<StayWhileComparableValues> = {},
): StayWhileComparableValues {
  return {
    addressLine1: "100 Example Street",
    addressLine2: null,
    city: "Testville",
    state: "FL",
    postalCode: "00001",
    bedroomCount: 3,
    bathroomCount: 2.5,
    maxOccupancy: 8,
    timezone: "America/New_York",
    ...overrides,
  };
}

function fabricatedOwnerRezDetail(overrides: Record<string, unknown> = {}) {
  return {
    id: 900001,
    name: "FABRICATED Test Property A",
    key: "fabricated-a",
    active: true,
    address: {
      street1: "100 Example Street",
      city: "Testville",
      state: "FL",
      postal_code: "00001",
      country: "US",
    },
    bedrooms: 3,
    bathrooms_full: 2,
    bathrooms_half: 1,
    max_guests: 8,
    time_zone: "America/New_York",
    ...overrides,
  };
}

function statusOf(
  fields: ReturnType<typeof compareOwnerRezProperty>,
  field: ComparedField,
) {
  return fields.find((f) => f.field === field)!;
}

describe("compareOwnerRezProperty", () => {
  it("compares exactly the nine approved fields, in order", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile(),
      fabricatedOwnerRezDetail(),
    );
    expect(fields.map((f) => f.field)).toEqual([
      "addressLine1",
      "addressLine2",
      "city",
      "state",
      "postalCode",
      "bedrooms",
      "bathrooms",
      "maxGuests",
      "timezone",
    ]);
  });

  it("reports Match for every field when values agree (empty line 2 on both sides agrees)", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile(),
      fabricatedOwnerRezDetail(),
    );
    expect(fields.every((f) => f.status === "match")).toBe(true);
  });

  it("treats surrounding spaces as Match", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ city: "  Testville " }),
      fabricatedOwnerRezDetail(),
    );
    expect(statusOf(fields, "city").status).toBe("match");
  });

  it("reports Formatting only for letter case or inner spacing differences", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ addressLine1: "100  EXAMPLE street" }),
      fabricatedOwnerRezDetail(),
    );
    expect(statusOf(fields, "addressLine1")).toMatchObject({
      status: "formatting_only",
      stayWhile: "100  EXAMPLE street",
      ownerRez: "100 Example Street",
    });
  });

  it("reports Differs, with both values, for a real difference", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ bedroomCount: 4 }),
      fabricatedOwnerRezDetail(),
    );
    expect(statusOf(fields, "bedrooms")).toMatchObject({
      status: "differs",
      stayWhile: "4",
      ownerRez: "3",
    });
  });

  it("never normalizes state names: FL vs Florida is Differs", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ state: "FL" }),
      fabricatedOwnerRezDetail({
        address: { ...fabricatedOwnerRezDetail().address, state: "Florida" },
      }),
    );
    expect(statusOf(fields, "state").status).toBe("differs");
  });

  it("never normalizes ZIP vs ZIP+4: 00001 vs 00001-2345 is Differs", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ postalCode: "00001" }),
      fabricatedOwnerRezDetail({
        address: {
          ...fabricatedOwnerRezDetail().address,
          postal_code: "00001-2345",
        },
      }),
    );
    expect(statusOf(fields, "postalCode").status).toBe("differs");
  });

  it("reports Missing in OwnerRez and keeps StayWhile's value, with no instruction to clear it", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ timezone: "America/New_York" }),
      fabricatedOwnerRezDetail({ time_zone: undefined }),
    );
    const timezone = statusOf(fields, "timezone");
    expect(timezone).toEqual({
      field: "timezone",
      label: "Timezone",
      stayWhile: "America/New_York",
      ownerRez: null,
      status: "missing_in_ownerrez",
    });
    // The result only describes values: no action/apply/clear field exists.
    for (const f of fields) {
      expect(Object.keys(f).sort()).toEqual(
        ["field", "label", "ownerRez", "stayWhile", "status"].sort(),
      );
    }
  });

  it("treats a blank OwnerRez string as Missing in OwnerRez, not as a value", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile(),
      fabricatedOwnerRezDetail({
        address: { ...fabricatedOwnerRezDetail().address, city: "   " },
      }),
    );
    expect(statusOf(fields, "city")).toMatchObject({
      status: "missing_in_ownerrez",
      stayWhile: "Testville",
      ownerRez: null,
    });
  });

  it("reports Missing in StayWhile when only OwnerRez has a value", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ addressLine2: null }),
      fabricatedOwnerRezDetail({
        address: { ...fabricatedOwnerRezDetail().address, street2: "Unit 2" },
      }),
    );
    expect(statusOf(fields, "addressLine2")).toMatchObject({
      status: "missing_in_staywhile",
      ownerRez: "Unit 2",
    });
  });

  it("derives bathrooms as full + half × 0.5, the same as property creation", () => {
    const match = compareOwnerRezProperty(
      fabricatedStayWhile({ bathroomCount: 2.5 }),
      fabricatedOwnerRezDetail({ bathrooms_full: 2, bathrooms_half: 1 }),
    );
    expect(statusOf(match, "bathrooms")).toMatchObject({
      status: "match",
      ownerRez: "2.5",
    });
    const onlyFull = compareOwnerRezProperty(
      fabricatedStayWhile({ bathroomCount: 2 }),
      fabricatedOwnerRezDetail({
        bathrooms_full: 2,
        bathrooms_half: undefined,
      }),
    );
    expect(statusOf(onlyFull, "bathrooms").status).toBe("match");
    const neither = compareOwnerRezProperty(
      fabricatedStayWhile({ bathroomCount: 2 }),
      fabricatedOwnerRezDetail({
        bathrooms_full: undefined,
        bathrooms_half: undefined,
      }),
    );
    expect(statusOf(neither, "bathrooms").status).toBe("missing_in_ownerrez");
  });

  it("compares bedrooms and maximum guests as numbers", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ maxOccupancy: 10 }),
      fabricatedOwnerRezDetail({ max_guests: 8 }),
    );
    expect(statusOf(fields, "maxGuests").status).toBe("differs");
    expect(statusOf(fields, "bedrooms").status).toBe("match");
  });

  it("uses the OwnerRez timezone exactly as given — never guessed from the address", () => {
    const fields = compareOwnerRezProperty(
      fabricatedStayWhile({ timezone: "America/New_York" }),
      fabricatedOwnerRezDetail({ time_zone: "America/Chicago" }),
    );
    expect(statusOf(fields, "timezone")).toMatchObject({
      status: "differs",
      ownerRez: "America/Chicago",
    });
  });

  it("marks every field OwnerRez data unavailable when OwnerRez's detail couldn't be read, still showing StayWhile's values", () => {
    const fields = compareOwnerRezProperty(fabricatedStayWhile(), null);
    expect(fields.every((f) => f.status === "ownerrez_unavailable")).toBe(true);
    expect(fields.every((f) => f.ownerRez === null)).toBe(true);
    expect(statusOf(fields, "city").stayWhile).toBe("Testville");
  });
});

describe("countComparisonStatuses", () => {
  it("counts every status, including zeros", () => {
    const counts = countComparisonStatuses(
      compareOwnerRezProperty(
        fabricatedStayWhile({ bedroomCount: 4 }),
        fabricatedOwnerRezDetail({ time_zone: undefined }),
      ),
    );
    expect(counts).toEqual({
      match: 7,
      formatting_only: 0,
      differs: 1,
      missing_in_ownerrez: 1,
      missing_in_staywhile: 0,
      ownerrez_unavailable: 0,
    });
  });

  it("has exactly the six approved status labels", () => {
    expect(Object.values(COMPARISON_STATUS_LABEL)).toEqual([
      "Match",
      "Formatting only",
      "Differs",
      "Missing in OwnerRez",
      "Missing in StayWhile",
      "OwnerRez data unavailable",
    ]);
  });
});
